#!/usr/bin/env node
/**
 * demo-rehearsal.mjs — orchestrated demo arc with timing markers.
 *
 * Walks through the safe rehearsable pipeline so you know exactly what each
 * step takes wall-clock during the live demo. No mainnet spend, no on-chain
 * write — only read-only chain checks and the off-chain prover.
 *
 * The arc:
 *
 *   1. Off-chain Proof of SQL query against the live STAKERS table
 *      (uses sxt-proof-of-sql-sdk, costs API quota only).
 *   2. Local Solidity audit of the StakersQuery source via forge build.
 *   3. Mainnet contract liveness check — confirms the existing StakersQuery
 *      contract at 0x1fc02a8d… still has code on Base mainnet.
 *   4. (Opt-in) Testnet publish — only runs when PUBLISH_TESTNET=1 in env,
 *      because it requires a separate testnet-funded wallet.
 *
 * Each step has a target budget. If a step blows its budget significantly,
 * that's a signal to either pre-warm (e.g., open the page beforehand) or
 * pre-record that segment.
 *
 * Usage:
 *   node demo-rehearsal.mjs                    # core arc (steps 1-3)
 *   PUBLISH_TESTNET=1 node demo-rehearsal.mjs  # add step 4 (testnet write)
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Load .env from examples/scripts/ explicitly so cwd doesn't matter.
const dotenv = await import("dotenv");
dotenv.config({ path: resolve(HERE, ".env") });
const REPO_ROOT = resolve(HERE, "..", "..");
const FORGE_PROJECT = resolve(REPO_ROOT, "examples", "contracts", "sxt-onchain-query");
const STAKERS_TABLE =
  process.env.SXT_TABLE ?? "MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS";
const STAKERS_CONTRACT = "0x1fc02a8dc0A4050B2DA5D075838F37705fcF0Aa1"; // Base mainnet
const BASE_RPC = process.env.ETH_RPC ?? "https://base.publicnode.com";

function bold(s) {
  return `\x1b[1m${s}\x1b[0m`;
}
function dim(s) {
  return `\x1b[2m${s}\x1b[0m`;
}
function green(s) {
  return `\x1b[32m${s}\x1b[0m`;
}
function red(s) {
  return `\x1b[31m${s}\x1b[0m`;
}
function yellow(s) {
  return `\x1b[33m${s}\x1b[0m`;
}

const STEPS = [];

function step(name, budgetMs, fn, opts = {}) {
  STEPS.push({ name, budgetMs, fn, optional: opts.optional ?? false });
}

// ─── Step 1: off-chain proof query ──────────────────────────────────────

step("Off-chain Proof of SQL query (live STAKERS table)", 8000, async () => {
  const apiKey = process.env.SXT_API_KEY ?? process.env.MAKEINFINITE_API_KEY;
  if (!apiKey) throw new Error("SXT_API_KEY not set in .env");

  const { SxTClient } = await import("sxt-proof-of-sql-sdk");
  const client = new SxTClient(
    process.env.SXT_PROVER ?? "https://api.makeinfinite.dev",
    process.env.SXT_AUTH ?? "https://proxy.api.makeinfinite.dev/auth/apikey",
    process.env.SXT_RPC_HTTP ?? "https://rpc.mainnet.sxt.network/",
    apiKey,
  );

  // Point lookup, not COUNT(*): as of June 2026 the prover returns null
  // AttestedCommitments for aggregate queries ("failed to deserialize prover
  // response json") while point lookups / scans prove end-to-end. This is the
  // same membership-proof shape the on-chain StakersQuery contract uses.
  const sampleStaker = process.env.SAMPLE_STAKER ?? "0x45c56e138881fd3ff46359ba1826d5fc6fccaedc";
  const sql = `SELECT STAKER FROM ${STAKERS_TABLE} WHERE STAKER = '${sampleStaker}'`;
  const result = await client.queryAndVerify(sql);

  return {
    sql,
    table: STAKERS_TABLE,
    verified: true,
    rowSummary: JSON.stringify(result).slice(0, 120) + "...",
  };
});

// ─── Step 2: local Solidity audit ───────────────────────────────────────

step(
  "Local audit (forge build StakersQuery)",
  6000,
  async () => {
    if (!existsSync(resolve(FORGE_PROJECT, "foundry.toml"))) {
      throw new Error(`foundry.toml missing at ${FORGE_PROJECT}`);
    }
    const r = spawnSync("forge", ["build", "--silent"], {
      cwd: FORGE_PROJECT,
      encoding: "utf8",
    });
    if (r.error?.code === "ENOENT") {
      throw new Error("forge not on PATH — install via getfoundry.sh");
    }
    if (r.status !== 0) throw new Error(`forge build failed: ${r.stderr.split("\n")[0]}`);

    // Pull contract metadata from the artifact
    const artifactPath = resolve(
      FORGE_PROJECT,
      "out",
      "StakersQuery.sol",
      "StakersQuery.json",
    );
    if (!existsSync(artifactPath)) throw new Error(`artifact missing at ${artifactPath}`);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const bytecodeBytes = (artifact.bytecode.object.length - 2) / 2;

    return {
      contract: "StakersQuery",
      bytecodeBytes,
      eip170OK: bytecodeBytes < 24576,
      abiEntries: artifact.abi.length,
    };
  },
  // Optional so the read-only demo path (no foundry installed) still succeeds.
  // The off-chain proof + mainnet contract liveness checks are the demo's
  // value props; local forge build is bonus credibility.
  { optional: true },
);

// ─── Step 3: existing mainnet contract is alive ──────────────────────────

step("Mainnet StakersQuery liveness", 3000, async () => {
  const { JsonRpcProvider } = await import("ethers");
  const provider = new JsonRpcProvider(BASE_RPC);
  const code = await provider.getCode(STAKERS_CONTRACT);
  if (!code || code === "0x") {
    throw new Error(`no code at ${STAKERS_CONTRACT} on Base — contract was wiped`);
  }
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 8453) {
    throw new Error(`expected chainId 8453 (Base), got ${network.chainId}`);
  }
  return {
    address: STAKERS_CONTRACT,
    chainId: Number(network.chainId),
    bytecodeBytes: (code.length - 2) / 2,
    explorer: `https://basescan.org/address/${STAKERS_CONTRACT}`,
  };
});

// ─── Step 4: testnet publish (opt-in) ───────────────────────────────────

if (process.env.PUBLISH_TESTNET === "1" || process.env.PUBLISH_TESTNET === "true") {
  step(
    "Testnet publish (opt-in via PUBLISH_TESTNET=1)",
    30000,
    async () => {
      const sample = resolve(REPO_ROOT, "examples", "data", "sxt_stakers.csv");
      if (!existsSync(sample)) {
        throw new Error(`sample CSV missing at ${sample}`);
      }
      // Use the canonical CLI script with SXT_RPC overridden to testnet.
      // This rehearses the actual publish path; if it works here, the demo
      // will work too.
      const r = spawnSync(
        "node",
        ["publish-dataset-cli.mjs", sample, "DEMO_REHEARSAL.STAKERS_PROBE"],
        {
          cwd: HERE,
          encoding: "utf8",
          env: { ...process.env, SXT_RPC: "wss://rpc.testnet.sxt.network" },
          timeout: 120_000,
        },
      );
      if (r.status !== 0) {
        const lastLine = r.stderr.split("\n").filter(Boolean).slice(-3).join(" | ");
        throw new Error(`publish exit ${r.status} — ${lastLine || r.stdout.split("\n").slice(-3).join(" | ")}`);
      }
      const blockHashes = [...r.stdout.matchAll(/finalized in block: (0x[0-9a-f]+)/gi)].map(
        (m) => m[1],
      );
      return {
        chain: "testnet",
        finalizedBlocks: blockHashes.length,
        firstBlockHash: blockHashes[0]?.slice(0, 10) + "..." ?? "(unknown)",
      };
    },
    { optional: true },
  );
}

// ─── Run ─────────────────────────────────────────────────────────────────

console.log(bold("\n  Demo arc rehearsal\n"));
console.log(dim(`  Steps: ${STEPS.length}  (PUBLISH_TESTNET=${process.env.PUBLISH_TESTNET ?? "0"})\n`));

const startedAll = Date.now();
let successCount = 0;
const summary = [];

for (let i = 0; i < STEPS.length; i++) {
  const s = STEPS[i];
  const stepNum = `[${i + 1}/${STEPS.length}]`;
  process.stdout.write(`  ${dim(stepNum)} ${s.name}…\n`);
  const start = Date.now();
  try {
    let info;
    try {
      info = await s.fn();
    } catch (firstErr) {
      // Cold first connections (slow resolver / IPv6-broken routes) fail with
      // a ~10s connect timeout and then succeed immediately — retry once
      // before declaring the step failed.
      if (/fetch failed|TIMEOUT|ECONN|ETIMEDOUT/i.test(String(firstErr?.message ?? firstErr))) {
        console.log(`        ${dim("· transient network error — retrying once…")}`);
        info = await s.fn();
      } else {
        throw firstErr;
      }
    }
    const elapsed = Date.now() - start;
    const inBudget = elapsed <= s.budgetMs;
    const tag = inBudget ? green("✓") : yellow("⚠");
    const budgetNote = inBudget
      ? `${elapsed}ms (budget ${s.budgetMs}ms)`
      : `${elapsed}ms — over budget by ${elapsed - s.budgetMs}ms`;
    console.log(`        ${tag} ${budgetNote}`);
    if (info && typeof info === "object") {
      for (const [k, v] of Object.entries(info)) {
        const val = typeof v === "object" ? JSON.stringify(v) : String(v);
        console.log(`          ${dim(k + ":")} ${val.length > 80 ? val.slice(0, 77) + "..." : val}`);
      }
    }
    summary.push({ step: s.name, ok: true, elapsed, inBudget });
    successCount++;
  } catch (err) {
    const elapsed = Date.now() - start;
    if (s.optional) {
      console.log(`        ${yellow("·")} ${elapsed}ms — skipped: ${err.message}`);
      summary.push({ step: s.name, ok: false, optional: true, elapsed, error: err.message });
    } else {
      console.log(`        ${red("✗")} ${elapsed}ms — ${err.message}`);
      summary.push({ step: s.name, ok: false, optional: false, elapsed, error: err.message });
    }
  }
  console.log("");
}

const totalElapsed = Date.now() - startedAll;
console.log("─".repeat(64));
console.log(
  `  ${bold("Total")}: ${(totalElapsed / 1000).toFixed(1)}s  ${dim(
    `(${successCount}/${STEPS.length} ok, ${STEPS.filter((s) => s.optional).length} optional)`,
  )}`,
);

const required = summary.filter((s) => !s.optional);
const requiredFailed = required.filter((s) => !s.ok);
if (requiredFailed.length === 0) {
  console.log(`  ${green("✓")} Demo arc rehearsable end-to-end.`);
} else {
  console.log(`  ${red("✗")} ${requiredFailed.length} required step(s) failed — fix before demo.`);
}

process.exit(requiredFailed.length === 0 ? 0 : 1);
