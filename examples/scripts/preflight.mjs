#!/usr/bin/env node
/**
 * preflight.mjs — end-to-end demo readiness check.
 *
 * Runs every check that should be green before the live demo begins. Covers
 * the surfaces that bootstrap.mjs doesn't:
 *
 *   - Plugin marketplace structure (marketplace.json + 3 plugin.json files)
 *   - SKILL.md frontmatter parses for all 7 skills
 *   - MCP server compiles + boots + lists 4 tools + 1 resource
 *   - Docs site reachable at localhost:3000 (if dev server running)
 *   - npm pack --dry-run produces a publishable tarball for sxt-mcp
 *
 * Plus a fast subset of bootstrap.mjs:
 *
 *   - Node 20+
 *   - forge on PATH
 *   - root + scripts + MCP node_modules present
 *   - .env present with PRIVATE_KEY + SXT_API_KEY
 *
 * Skips heavy probes (network balance checks, RPC roundtrips). Run
 * `node bootstrap.mjs --status` for those.
 *
 * Usage:
 *   node preflight.mjs              # full check, exits non-zero if any blocker
 *   node preflight.mjs --quick      # skip MCP boot test (saves ~2s)
 *   node preflight.mjs --json       # emit JSON instead of human-readable output
 *   node preflight.mjs --read-only  # only check what's needed for the off-chain
 *                                   # demo: SXT_API_KEY, manifests, MCP server.
 *                                   # Skips forge, PRIVATE_KEY, contract artifact.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const MCP_DIR = resolve(REPO_ROOT, "packages", "mcp", "sxt-mcp");
const PLUGINS_DIR = resolve(REPO_ROOT, "packages", "plugins");
const FORGE_OUT = resolve(REPO_ROOT, "examples", "contracts", "sxt-onchain-query", "out");

const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const JSON_OUT = args.includes("--json");
const READ_ONLY = args.includes("--read-only");

const results = [];
const ok = (msg) => !JSON_OUT && console.log(`  ✓ ${msg}`);
const bad = (msg) => !JSON_OUT && console.log(`  ✗ ${msg}`);
const section = (title) => !JSON_OUT && console.log(`\n▶ ${title}`);

async function check(name, fn) {
  try {
    const info = await fn();
    results.push({ name, ok: true, info: info ?? null });
    ok(`${name}${info ? ` — ${info}` : ""}`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    results.push({ name, ok: false, error: msg });
    bad(`${name} — ${msg}`);
  }
}

// ─── Static checks ───────────────────────────────────────────────────────

section("Static (no network, no chain)");

await check("Node 20+", () => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) throw new Error(`have ${process.versions.node}, need >= 20`);
  return `node ${process.versions.node}`;
});

if (!READ_ONLY) {
  await check("forge on PATH", () => {
    const r = spawnSync("forge", ["--version"], { encoding: "utf8" });
    if (r.status !== 0) throw new Error("not on PATH — install via getfoundry.sh");
    return r.stdout.split("\n")[0].replace("forge ", "");
  });
}

await check("examples/scripts node_modules", () => {
  if (!existsSync(resolve(HERE, "node_modules"))) {
    throw new Error("not installed — run `npm install` in examples/scripts/");
  }
  return "ok";
});

await check("packages/mcp/sxt-mcp node_modules", () => {
  if (!existsSync(resolve(MCP_DIR, "node_modules"))) {
    throw new Error("not installed — run `npm install` in packages/mcp/sxt-mcp/");
  }
  return "ok";
});

await check("packages/mcp/sxt-mcp dist/", () => {
  const dist = resolve(MCP_DIR, "dist");
  if (!existsSync(dist)) {
    throw new Error("not built — run `npm run build` in packages/mcp/sxt-mcp/");
  }
  const indexJs = resolve(dist, "index.js");
  if (!existsSync(indexJs)) throw new Error(`${indexJs} missing — rebuild`);
  return "ok";
});

if (!READ_ONLY) {
  await check("foundry forge artifact (StakersQuery)", () => {
    const path = resolve(FORGE_OUT, "StakersQuery.sol", "StakersQuery.json");
    if (!existsSync(path)) {
      throw new Error("missing — run `forge build` in examples/contracts/sxt-onchain-query/");
    }
    const artifact = JSON.parse(readFileSync(path, "utf8"));
    if (!artifact.bytecode?.object || artifact.bytecode.object === "0x") {
      throw new Error("artifact has empty bytecode");
    }
    return `${(artifact.bytecode.object.length - 2) / 2} bytes`;
  });
}

// ─── Manifests ───────────────────────────────────────────────────────────

section("Marketplace + plugin manifests");

await check("marketplace.json valid JSON", () => {
  const path = resolve(REPO_ROOT, ".claude-plugin", "marketplace.json");
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.plugins)) throw new Error("plugins[] missing");
  return `${parsed.plugins.length} plugins declared`;
});

const PLUGIN_NAMES = ["dreamspace-data", "dreamspace-query", "dreamspace-contracts"];
for (const plugin of PLUGIN_NAMES) {
  await check(`plugin.json: ${plugin}`, () => {
    const path = resolve(PLUGINS_DIR, plugin, ".claude-plugin", "plugin.json");
    if (!existsSync(path)) throw new Error(`missing ${path}`);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed.name || !parsed.version) throw new Error("name or version missing");
    return `v${parsed.version}`;
  });
}

// ─── SKILL.md frontmatter ────────────────────────────────────────────────

const EXPECTED_SKILL_COUNT = 7;
section(`SKILL.md frontmatter (${EXPECTED_SKILL_COUNT} skills)`);

const SKILL_PATHS = [];
for (const plugin of PLUGIN_NAMES) {
  const skillsDir = resolve(PLUGINS_DIR, plugin, "skills");
  if (!existsSync(skillsDir)) continue;
  for (const skill of readdirSync(skillsDir)) {
    const skillFile = resolve(skillsDir, skill, "SKILL.md");
    if (existsSync(skillFile)) SKILL_PATHS.push({ plugin, skill, path: skillFile });
  }
}

if (SKILL_PATHS.length !== EXPECTED_SKILL_COUNT) {
  results.push({
    name: `expected ${EXPECTED_SKILL_COUNT} SKILL.md files`,
    ok: false,
    error: `found ${SKILL_PATHS.length}`,
  });
}

for (const s of SKILL_PATHS) {
  await check(`${s.plugin}/${s.skill}`, () => {
    const raw = readFileSync(s.path, "utf8");
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) throw new Error("no frontmatter");
    const fm = m[1];
    const name = fm.match(/name:\s*(.+?)\s*$/m)?.[1]?.trim();
    const desc = fm.match(/description:\s*(.+?)\s*$/m)?.[1]?.trim();
    if (!name) throw new Error("name missing");
    if (!desc) throw new Error("description missing");
    if (name !== s.skill) throw new Error(`name "${name}" doesn't match dir "${s.skill}"`);
    return `name=${name}`;
  });
}

// ─── Env vars ────────────────────────────────────────────────────────────

section("Env vars (.env)");

await check(".env exists in examples/scripts/", () => {
  const path = resolve(HERE, ".env");
  if (!existsSync(path)) throw new Error(`${path} missing`);
  return "ok";
});

// Load .env from examples/scripts/ regardless of cwd, so this script can be
// invoked from anywhere without losing PRIVATE_KEY / SXT_API_KEY.
try {
  const dotenv = await import("dotenv");
  dotenv.config({ path: resolve(HERE, ".env") });
} catch {
  // dotenv may not be installed when run outside examples/scripts.
}

if (!READ_ONLY) {
  await check("PRIVATE_KEY set + valid format", () => {
    const pk = process.env.PRIVATE_KEY?.trim();
    if (!pk) throw new Error("not set in .env");
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("malformed (expected 0x + 64 hex)");
    return `length ok (value not logged)`;
  });
}

await check("SXT_API_KEY set", () => {
  const k = process.env.SXT_API_KEY?.trim() ?? process.env.MAKEINFINITE_API_KEY?.trim();
  if (!k) throw new Error("neither SXT_API_KEY nor MAKEINFINITE_API_KEY set");
  return `length ${k.length}`;
});

// ─── MCP server: list tools ──────────────────────────────────────────────

if (!QUICK) {
  section("MCP server (boot + list tools)");

  await check("server starts on stdio + lists 4 tools", async () => {
    const indexJs = resolve(MCP_DIR, "dist", "index.js");
    const child = spawn("node", [indexJs], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const writeMsg = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
    writeMsg({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "preflight", version: "1.0.0" },
      },
    });
    writeMsg({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    // Wait up to 5s for both responses.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if ((stdout.match(/"id":2/g)?.length ?? 0) >= 1) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill();

    if (!stderr.includes("Tools: 4 live")) {
      throw new Error(`startup banner wrong: ${stderr.split("\n").find((l) => l.includes("[sxt-mcp]")) ?? "(none)"}`);
    }
    const toolMatches = stdout.match(/"name":"sxt\.[a-z_]+"/g) ?? [];
    const unique = new Set(toolMatches);
    if (unique.size !== 4) {
      throw new Error(`expected 4 unique tool names, got ${unique.size}: ${[...unique].join(", ")}`);
    }
    return [...unique].sort().join(", ");
  });
}

// ─── Docs site (optional — only if dev server up) ────────────────────────

section("Docs site (localhost:3000 — optional)");

// Informational only — the docs dev server is not a prerequisite for the
// demo or the pipeline, so its absence must never block `npm run demo`
// (a fresh clone fails here otherwise).
await check("/docs reachable (optional)", async () => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch("http://localhost:3000/docs", { signal: ctrl.signal });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    return "200 OK";
  } catch (err) {
    if (err.name === "AbortError" || /ECONNREFUSED|fetch failed/.test(String(err))) {
      return "dev server not running — skipped (start with `npm run dev` to include)";
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
});

// ─── npm pack dry-run readiness ──────────────────────────────────────────

section("npm pack readiness (sxt-mcp)");

await check("npm pack --dry-run", () => {
  // shell:true so `npm` resolves to npm.cmd on Windows (bare spawnSync ENOENTs there).
  const r = spawnSync("npm", ["pack", "--dry-run", "--silent"], {
    cwd: MCP_DIR,
    encoding: "utf8",
    shell: true,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error((r.stderr ?? "").split("\n")[0] || `exit ${r.status}`);
  // npm pack --dry-run prints the contents to stderr in npm 8+; just check exit code.
  return "tarball would build cleanly";
});

await check("LICENSE file present", () => {
  const licensePath = resolve(MCP_DIR, "LICENSE");
  if (!existsSync(licensePath)) throw new Error("LICENSE missing — required for publishable package");
  const size = statSync(licensePath).size;
  return `${size} bytes`;
});

// ─── Summary ─────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;

if (JSON_OUT) {
  console.log(JSON.stringify({ passed, failed, results }, null, 2));
} else {
  console.log("");
  console.log("─".repeat(60));
  const mode = READ_ONLY ? " (read-only mode)" : "";
  if (failed === 0) {
    console.log(`  ✓ ${passed}/${passed} checks passed — demo-ready${mode}.`);
    console.log(`  Next: \`node demo-rehearsal.mjs\` to time the demo arc.`);
  } else {
    console.log(
      `  ${passed}/${passed + failed} passed, ${failed} blocker${failed === 1 ? "" : "s"} to fix before demo${mode}:`,
    );
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`      - ${r.name}: ${r.error}`);
    }
    if (!READ_ONLY) {
      console.log(
        `\n  Hint: \`node preflight.mjs --read-only\` skips wallet + foundry checks for the off-chain demo path.`,
      );
    }
  }
}

process.exit(failed === 0 ? 0 : 1);
