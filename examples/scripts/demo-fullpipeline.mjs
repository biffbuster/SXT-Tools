#!/usr/bin/env node
/**
 * demo-fullpipeline.mjs — full publish-and-prove pipeline orchestrator.
 *
 * Runs the 7-step demo end-to-end against mainnet. Each step:
 *   - Prints a banner with name, cost, and budget
 *   - Streams the underlying script's output live (audience sees the work)
 *   - Measures wall-clock + warns if over budget
 *   - Prompts before each paid step (unless --auto)
 *
 * Steps:
 *   1. Publish CSV to SXT chain          (~$0.50 in SXT credits)
 *   2. Generate EVM proof plan           (free)
 *   3. Render OnchainQuery.sol           (free)
 *   4. forge build (audit / compile)     (free)
 *   5. Deploy to Base mainnet            (~$0.50 ETH)
 *   6. Off-chain Proof of SQL pre-flight (free, API quota)
 *   7. On-chain proven query — CLIMAX    (100 SXT + gas, ~$5–10)
 *
 * Total mainnet cost: ~$10–15. Total wall-clock: ~3–5 min.
 *
 * Usage:
 *   node demo-fullpipeline.mjs                    # interactive, prompts before paid steps
 *   node demo-fullpipeline.mjs --auto             # skip prompts (for screen recording)
 *   node demo-fullpipeline.mjs --skip-onchain     # steps 1–6 only (no 100 SXT spend)
 *   node demo-fullpipeline.mjs --from=5 --to=7    # resume from step 5 onward
 *   node demo-fullpipeline.mjs --fresh            # auto-timestamp the table ref AND
 *                                                 # clear .deploy-state.json so each
 *                                                 # run is genuinely fresh (recommended
 *                                                 # for rehearsals so deploy actually
 *                                                 # runs every time)
 *
 * Required env (in examples/scripts/.env):
 *   PRIVATE_KEY        Funded on SXT chain + Base mainnet + 100 SXT (Base ERC-20)
 *   SXT_API_KEY        Studio API key from chain.spaceandtime.io
 *
 * Optional env:
 *   DEMO_TABLE_REF     PREFIX.TABLE (default: DEMO_PITCH.MEMBERS, address-suffixed)
 *   DEMO_CSV           Path to CSV (default: examples/data/sxt_stakers.csv)
 *
 * Rehearsal tip: use a fresh table name per rehearsal so re-running publish
 * doesn't duplicate rows. Quick recipe:
 *   DEMO_TABLE_REF="DEMO_PITCH.MEMBERS_$(date +%s)" node demo-fullpipeline.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import readline from "node:readline/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const FORGE_PROJECT = resolve(REPO_ROOT, "examples", "contracts", "sxt-onchain-query");

// Load .env from examples/scripts/ explicitly.
const dotenv = await import("dotenv");
dotenv.config({ path: resolve(HERE, ".env") });

// Auto-detect Foundry on canonical install paths if `forge` isn't on PATH.
// Community users typically install via `curl -L https://foundry.paradigm.xyz | bash`
// which drops binaries in ~/.foundry/bin but doesn't always update shell rc.
// Prepending here lets `spawn("forge", …)` succeed inside step 4 without
// the user having to fix their shell first.
(function ensureForgeOnPath() {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["forge"], { stdio: "ignore" });
  if (probe.status === 0) return;
  const candidates = [
    join(homedir(), ".foundry", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, process.platform === "win32" ? "forge.exe" : "forge"))) {
      process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
      console.log(`  \x1b[2m[forge auto-PATH] prepended ${dir}\x1b[0m`);
      return;
    }
  }
})();

// ─── CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const AUTO = args.includes("--auto") || args.includes("--yes");
const SKIP_ONCHAIN = args.includes("--skip-onchain");
const FRESH = args.includes("--fresh");
const FROM_ARG = args.find((a) => a.startsWith("--from="));
const TO_ARG = args.find((a) => a.startsWith("--to="));
const FROM = FROM_ARG ? Number(FROM_ARG.split("=")[1]) : 1;
const TO = TO_ARG ? Number(TO_ARG.split("=")[1]) : 7;

// --fresh: each rehearsal publishes a brand-new table + deploys a brand-new
// contract. Mechanics:
//   1. Auto-timestamp the table ref (unless caller already set DEMO_TABLE_REF
//      explicitly). This avoids the duplicate-rows problem when re-publishing
//      to the same namespace.
//   2. Clear .deploy-state.json so the deploy step actually runs instead of
//      being skipped by the idempotency guard.
if (FRESH) {
  const stamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
  if (!process.env.DEMO_TABLE_REF) {
    process.env.DEMO_TABLE_REF = `DEMO_PITCH.MEMBERS_${stamp}`;
    console.log(`  \x1b[2m--fresh\x1b[0m: auto-set DEMO_TABLE_REF=${process.env.DEMO_TABLE_REF}`);
  } else {
    // Caller provided a base table ref. Append a timestamp to the TABLE part
    // so each --fresh run is genuinely unique even with a fixed namespace.
    const parts = process.env.DEMO_TABLE_REF.split(".");
    if (parts.length === 2 && !/_\d{14}$/.test(parts[1])) {
      process.env.DEMO_TABLE_REF = `${parts[0]}.${parts[1]}_${stamp}`;
      console.log(
        `  \x1b[2m--fresh\x1b[0m: appended timestamp → DEMO_TABLE_REF=${process.env.DEMO_TABLE_REF}`,
      );
    } else {
      console.log(
        `  \x1b[2m--fresh\x1b[0m: keeping caller-provided DEMO_TABLE_REF=${process.env.DEMO_TABLE_REF}`,
      );
    }
  }
  const fs = await import("node:fs");
  const stateFile = resolve(REPO_ROOT, "examples", "contracts", "sxt-onchain-query", ".deploy-state.json");
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
    console.log(`  \x1b[2m--fresh\x1b[0m: deleted .deploy-state.json (deploy step will run)`);
  }
}

// ─── Validate prereqs ───────────────────────────────────────────────────

const privateKey = process.env.PRIVATE_KEY?.trim();
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error(
    "✗ PRIVATE_KEY not set or malformed in examples/scripts/.env. " +
      "Run `cp examples/scripts/.env.example examples/scripts/.env` and fill it in.",
  );
  process.exit(1);
}
if (!process.env.SXT_API_KEY?.trim() && !process.env.MAKEINFINITE_API_KEY?.trim()) {
  console.error("✗ SXT_API_KEY (or MAKEINFINITE_API_KEY) not set in .env.");
  process.exit(1);
}

// Lazy-load ethers so the script fails fast on missing env before pulling deps.
const { Wallet } = await import("ethers");
const wallet = new Wallet(privateKey);

// Compute the suffixed table reference per the SXT chain rule.
const RAW_TABLE_REF = process.env.DEMO_TABLE_REF ?? "DEMO_PITCH.MEMBERS";
const [tablePrefix, tableName] = RAW_TABLE_REF.split(".");
if (!tablePrefix || !tableName) {
  console.error(`✗ DEMO_TABLE_REF must be PREFIX.TABLE form. Got: "${RAW_TABLE_REF}"`);
  process.exit(1);
}
const ADDR_SUFFIX = wallet.address.slice(2).toUpperCase();
const FULL_TABLE_REF = `${tablePrefix}_${ADDR_SUFFIX}.${tableName}`;

// Propagate to subprocess scripts that read SXT_TABLE.
process.env.SXT_TABLE = FULL_TABLE_REF;

const CSV_PATH = process.env.DEMO_CSV ?? resolve(REPO_ROOT, "examples", "data", "sxt_stakers.csv");
if (!existsSync(CSV_PATH)) {
  console.error(`✗ CSV not found at ${CSV_PATH}. Set DEMO_CSV to override.`);
  process.exit(1);
}

// publish-dataset-cli writes the inferred schema next to the CSV. Pass that
// path to save-proof-plans (so it discovers the lookup column from your
// schema) and to render-onchain-query (so the contract has correct event
// types for your columns). Hand-curated <basename>.schema.json files still
// take precedence if present — only fall back to .inferred-schema.json.
const SCHEMA_PATH = (() => {
  const base = CSV_PATH.replace(/\.csv$/i, "");
  const handCurated = `${base}.schema.json`;
  const inferred = `${base}.inferred-schema.json`;
  if (existsSync(handCurated)) return handCurated;
  return inferred; // may not exist yet — publish step will create it
})();

// ─── Helpers ────────────────────────────────────────────────────────────

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

async function confirm(prompt) {
  if (AUTO) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function spawnStreamed(cmd, cmdArgs, opts = {}) {
  return new Promise((resolveProm, rejectProm) => {
    // Destructure env out of opts so the spread doesn't clobber our computed env.
    // The bug we're avoiding: `{stdio, env: merged, ...opts}` would let opts.env
    // overwrite the merged env, dropping process.env (including PATH) entirely.
    const { env: optsEnv, ...restOpts } = opts;
    const child = spawn(cmd, cmdArgs, {
      stdio: "inherit",
      ...restOpts,
      env: { ...process.env, ...(optsEnv ?? {}) },
    });
    child.on("error", rejectProm);
    child.on("close", (code) => {
      if (code === 0) resolveProm();
      else rejectProm(new Error(`${cmd} ${cmdArgs.join(" ")} exited with code ${code}`));
    });
  });
}

function banner(stepNum, total, name, cost, budget) {
  const sep = "━".repeat(72);
  console.log(`\n${dim(sep)}`);
  console.log(`  ${cyan(`[${stepNum}/${total}]`)} ${bold(name)}`);
  console.log(`  ${dim("Cost:")} ${cost}    ${dim("Budget:")} ${(budget / 1000).toFixed(0)}s`);
  console.log(`${dim(sep)}\n`);
}

// ─── Steps ──────────────────────────────────────────────────────────────

const STEPS = [
  {
    name: "Publish CSV to SXT chain",
    cost: "SXT chain credits (~$0.50)",
    budget: 60_000,
    confirm: true,
    fn: () =>
      spawnStreamed("node", ["publish-dataset-cli.mjs", CSV_PATH, RAW_TABLE_REF], {
        cwd: HERE,
      }),
  },
  {
    name: "Generate EVM proof plan",
    cost: "free (free Substrate RPC call)",
    budget: 10_000,
    fn: () =>
      spawnStreamed("node", ["save-proof-plans.mjs"], {
        cwd: HERE,
        env: { SXT_SCHEMA_PATH: SCHEMA_PATH },
      }),
  },
  {
    name: "Render OnchainQuery.sol from proof plan",
    cost: "free (local template render)",
    budget: 5_000,
    fn: () =>
      spawnStreamed(
        "node",
        ["render-onchain-query.mjs", "--name", "DemoQuery", "--schema", SCHEMA_PATH],
        { cwd: HERE },
      ),
  },
  {
    name: "Audit + build (forge build + slither + AUDIT_REPORT.md)",
    cost: "free (local Solidity compile + static analysis)",
    budget: 180_000,
    fn: async () => {
      // Build first so audit-rendered.mjs has a fresh artifact to read.
      await spawnStreamed("forge", ["build"], { cwd: FORGE_PROJECT });
      // Then run severity-classified audit + write AUDIT_REPORT.md.
      // Exit codes: 0 PASS, 1 WARN (moderate findings), 2 FAIL (critical findings).
      // The orchestrator aborts if audit-rendered.mjs returns non-zero, so a
      // critical finding refuses deployment automatically.
      await spawnStreamed("node", ["audit-rendered.mjs"], { cwd: HERE });
    },
  },
  {
    name: "Deploy to Base mainnet",
    cost: "~$0.50 ETH (Base gas)",
    budget: 120_000,
    confirm: true,
    fn: () => spawnStreamed("node", ["deploy-onchain-query.mjs"], { cwd: HERE }),
  },
  {
    name: "Off-chain Proof of SQL (pre-flight)",
    cost: "free (API quota only)",
    budget: 30_000,
    fn: () => spawnStreamed("node", ["verify-table.mjs"], { cwd: HERE }),
  },
  {
    name: "On-chain proven query — CLIMAX",
    cost: "100 SXT + Base gas (~$5–10)",
    budget: 300_000,
    confirm: true,
    onchain: true,
    fn: () => spawnStreamed("node", ["query-onchain.mjs"], { cwd: HERE }),
  },
];

// ─── Run ────────────────────────────────────────────────────────────────

console.log(`\n${bold("DEMO — full pipeline orchestrator")}\n`);
console.log(`  ${dim("Wallet:")}        ${wallet.address}`);
console.log(`  ${dim("Table ref:")}     ${FULL_TABLE_REF}`);
console.log(`  ${dim("CSV:")}           ${CSV_PATH}`);
console.log(`  ${dim("Schema path:")}   ${SCHEMA_PATH}${existsSync(SCHEMA_PATH) ? "" : dim(" (will be created by publish step)")}`);
console.log(`  ${dim("Lookup column:")} ${process.env.SXT_LOOKUP_COLUMN ?? dim("auto (first VARCHAR)")}`);
console.log(`  ${dim("Mode:")}          ${AUTO ? "AUTO (no prompts)" : "interactive"}`);
console.log(
  `  ${dim("Range:")}         steps ${FROM}–${TO}${SKIP_ONCHAIN ? " (--skip-onchain → max 6)" : ""}`,
);

const overallStart = Date.now();
const stepTimings = [];

for (let i = 0; i < STEPS.length; i++) {
  const stepNum = i + 1;
  const step = STEPS[i];
  if (stepNum < FROM) continue;
  if (stepNum > TO) break;

  if (step.onchain && SKIP_ONCHAIN) {
    console.log(`\n${dim("─".repeat(72))}`);
    console.log(`  ${cyan(`[${stepNum}/${STEPS.length}]`)} ${bold(step.name)}  ${yellow("· SKIPPED")}`);
    console.log(`  ${dim("Reason:")} --skip-onchain — saves 100 SXT this run`);
    stepTimings.push({ stepNum, name: step.name, skipped: true });
    continue;
  }

  banner(stepNum, STEPS.length, step.name, step.cost, step.budget);

  if (step.confirm) {
    const prompt = step.onchain
      ? bold(red(`  ⚠ This will spend 100 SXT on Base mainnet. Proceed? (y/N) `))
      : `  ${dim("Proceed?")} (y/N) `;
    const ok = await confirm(prompt);
    if (!ok) {
      console.log(`\n  ${yellow("Aborted by user.")}`);
      process.exit(0);
    }
  }

  const start = Date.now();
  try {
    await step.fn();
    const elapsed = Date.now() - start;
    const inBudget = elapsed <= step.budget;
    const tag = inBudget ? green("✓") : yellow("⚠ over budget");
    console.log(
      `\n  ${tag}  step ${stepNum} done in ${(elapsed / 1000).toFixed(1)}s ${
        inBudget ? "" : dim(`(budget ${(step.budget / 1000).toFixed(0)}s)`)
      }`,
    );
    stepTimings.push({ stepNum, name: step.name, elapsed, inBudget });
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`\n  ${red("✗")} step ${stepNum} failed after ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`  ${dim("Error:")} ${err.message}`);
    console.log(`\n  ${dim("Recovery hints:")}`);
    if (stepNum === 1) {
      console.log(`    • Verify wallet has SXT credits: \`node bootstrap.mjs --status\``);
      console.log(`    • Use a fresh table name to avoid duplication: DEMO_TABLE_REF=…`);
    } else if (stepNum === 5) {
      console.log(`    • Verify Base ETH balance ≥ 0.005`);
      console.log(`    • Delete .deploy-state.json if a stale deploy is blocking`);
    } else if (stepNum === 7) {
      console.log(`    • Inspect with: \`node inspect-query.mjs <queryTxHash>\``);
      console.log(`    • If stuck > 1 hour: \`cancelQuery(queryId, payment)\` refunds 100 SXT`);
    }
    console.log(`\n  ${dim("To resume from this step:")} --from=${stepNum}`);
    process.exit(1);
  }
}

const totalElapsed = Date.now() - overallStart;

// ─── Summary ────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(72)}`);
console.log(`  ${bold("Pipeline summary")}`);
console.log(`${"═".repeat(72)}`);

for (const t of stepTimings) {
  if (t.skipped) {
    console.log(`  ${yellow("·")} [${t.stepNum}] ${t.name}  ${dim("skipped")}`);
  } else {
    const tag = t.inBudget ? green("✓") : yellow("⚠");
    console.log(`  ${tag} [${t.stepNum}] ${t.name}  ${dim(`${(t.elapsed / 1000).toFixed(1)}s`)}`);
  }
}

console.log(`\n  ${bold("Total wall-clock:")} ${(totalElapsed / 1000).toFixed(1)}s`);
console.log(`  ${bold("Published table:")} ${FULL_TABLE_REF}`);
console.log(`  ${bold("Verify table again:")} \`SXT_TABLE=${FULL_TABLE_REF} node verify-table.mjs\``);

// If we deployed, surface the address from .deploy-state.json.
const stateFile = resolve(FORGE_PROJECT, ".deploy-state.json");
if (existsSync(stateFile)) {
  try {
    const { readFileSync } = await import("node:fs");
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    if (state.address) {
      console.log(`  ${bold("Deployed contract:")} ${state.address}`);
      console.log(`  ${bold("BaseScan:")} https://basescan.org/address/${state.address}`);
    }
  } catch {
    // ignore
  }
}

console.log(`\n  ${green("✓ Demo complete.")}\n`);
