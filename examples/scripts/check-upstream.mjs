#!/usr/bin/env node
/**
 * check-upstream.mjs — detect drift between this repo and live Space and Time.
 *
 * Every SXT fact in this codebase is a hardcoded constant with a comment next
 * to it: contract addresses, RPC method names, the `sourceNetwork` enum, the
 * commitment scheme, the pinned SDK, and the proven SQL surface. Nothing
 * detected when any of those changed upstream, so the first signal was a user
 * burning SXT on a call that silently dropped.
 *
 * This script probes the live surfaces and reports three states per check:
 *
 *   ok       matches what we pin
 *   DRIFT    upstream changed — action needed, exits non-zero
 *   unknown  could not determine (offline, missing credential) — never fails
 *
 * The distinction matters. A failed probe is not evidence of drift, and
 * treating it as such would train people to ignore this script.
 *
 * Cost: free, except the aggregate probe, which spends one API quota tick.
 *
 * Usage:
 *   node check-upstream.mjs              # all checks
 *   node check-upstream.mjs --no-prover  # skip anything needing SXT_API_KEY
 *   node check-upstream.mjs --json       # machine-readable
 *
 * Writes `.upstream-check.json` next to this script so the aggregate result
 * carries a date. The note in proof-of-sql-foundations/SKILL.md went three
 * months without re-validation; a dated artifact makes staleness visible.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const MCP_DIR = resolve(REPO_ROOT, "packages", "mcp", "sxt-mcp");

const dotenv = await import("dotenv");
dotenv.config({ path: resolve(HERE, ".env") });

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const NO_PROVER = args.includes("--no-prover");

// ─── Pinned constants. These mirror CLAUDE.md; keep them in sync. ──────────

const PINNED = {
  base: {
    rpc: "https://base.publicnode.com",
    QueryRouter: "0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB",
    Verifier: "0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518",
    SXT_ERC20: "0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8",
  },
  ethereum: {
    rpc: "https://ethereum.publicnode.com",
    QueryRouter: "0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB",
    Verifier: "0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9",
    SXT_ERC20: "0xE6Bfd33F52d82Ccb5b37E16D3dD81f9FFDAbB195",
  },
  sxtRpcHttp: process.env.SXT_RPC_HTTP ?? "https://rpc.mainnet.sxt.network/",
  prover: process.env.SXT_PROVER ?? "https://api.makeinfinite.dev",
  auth: process.env.SXT_AUTH ?? "https://proxy.api.makeinfinite.dev/auth/apikey",
  table:
    process.env.SXT_TABLE ??
    "MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS",
  sampleStaker:
    process.env.SAMPLE_STAKER ?? "0x45c56e138881fd3ff46359ba1826d5fc6fccaedc",
};

// ─── Harness ───────────────────────────────────────────────────────────────

const results = [];
const c = JSON_OUT
  ? { g: (s) => s, r: (s) => s, y: (s) => s, d: (s) => s }
  : {
      g: (s) => `\x1b[32m${s}\x1b[0m`,
      r: (s) => `\x1b[31m${s}\x1b[0m`,
      y: (s) => `\x1b[33m${s}\x1b[0m`,
      d: (s) => `\x1b[2m${s}\x1b[0m`,
    };

const section = (t) => !JSON_OUT && console.log(`\n▶ ${t}`);

/**
 * fn returns { state: "ok"|"drift"|"unknown", detail: string }.
 * A thrown error is "unknown", never "drift" — we cannot distinguish a
 * changed upstream from an unreachable one.
 */
async function probe(name, fn) {
  let out;
  try {
    out = await fn();
  } catch (err) {
    out = { state: "unknown", detail: err?.message ?? String(err) };
  }
  results.push({ name, ...out });
  if (JSON_OUT) return;
  const mark =
    out.state === "ok" ? c.g("ok   ") : out.state === "drift" ? c.r("DRIFT") : c.y("?    ");
  console.log(`  ${mark} ${name}${out.detail ? c.d(` — ${out.detail}`) : ""}`);
}

async function rpc(endpoint, method, params, timeoutMs = 20000) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

// ─── 1. Pinned SDK vs npm latest ───────────────────────────────────────────

section("Pinned dependency vs upstream");

await probe("sxt-proof-of-sql-sdk version", async () => {
  const require = createRequire(import.meta.url);
  let installed = null;
  for (const base of [HERE, MCP_DIR]) {
    try {
      installed = require(resolve(base, "node_modules", "sxt-proof-of-sql-sdk", "package.json"))
        .version;
      break;
    } catch {
      // try the next location
    }
  }
  if (!installed) return { state: "unknown", detail: "SDK not installed locally" };

  const res = await fetch("https://registry.npmjs.org/sxt-proof-of-sql-sdk/latest", {
    signal: AbortSignal.timeout(15000),
  });
  const latest = (await res.json()).version;

  if (installed === latest) return { state: "ok", detail: `${installed} (latest)` };
  return {
    state: "drift",
    detail: `installed ${installed}, npm latest ${latest} — this SDK owns auth, the blockHash binding and the WASM verifier, so review the changelog before shipping`,
  };
});

// ─── 2. On-chain constants still deployed ──────────────────────────────────

section("On-chain contracts (CLAUDE.md constants)");

for (const [chain, cfg] of Object.entries({ base: PINNED.base, ethereum: PINNED.ethereum })) {
  for (const name of ["QueryRouter", "Verifier", "SXT_ERC20"]) {
    await probe(`${chain}: ${name}`, async () => {
      const j = await rpc(cfg.rpc, "eth_getCode", [cfg[name], "latest"], 15000);
      const code = j?.result ?? "0x";
      const bytes = (code.length - 2) / 2;
      if (bytes === 0) {
        return {
          state: "drift",
          detail: `no code at ${cfg[name]} — the pinned address is wrong or the contract was removed`,
        };
      }
      return { state: "ok", detail: `${cfg[name]} (${bytes} bytes)` };
    });
  }
}

// ─── 3. SXT chain RPC methods ──────────────────────────────────────────────

section("SXT chain RPC methods");

await probe("commitments_v1_evmProofPlan", async () => {
  const sql = `SELECT STAKER FROM ${PINNED.table} WHERE STAKER = '${PINNED.sampleStaker}'`;
  const j = await rpc(PINNED.sxtRpcHttp, "commitments_v1_evmProofPlan", { query: sql });
  if (j?.error) {
    return { state: "drift", detail: `RPC error: ${j.error.message ?? JSON.stringify(j.error)}` };
  }
  if (!j?.result?.proofPlan) {
    return { state: "drift", detail: "no proofPlan in response — the response shape changed" };
  }
  const bytes = (j.result.proofPlan.length - 2) / 2;
  return { state: "ok", detail: `${bytes}-byte plan at ${String(j.result.at).slice(0, 14)}…` };
});

await probe("attestation_v1_bestRecentAttestations", async () => {
  const j = await rpc(PINNED.sxtRpcHttp, "attestation_v1_bestRecentAttestations", []);
  if (j?.error) {
    return { state: "drift", detail: `RPC error: ${j.error.message ?? JSON.stringify(j.error)}` };
  }
  // Shape is { result: { attestations: [ { blockNumber, blockHash, ... } ] } }.
  // The blockHash inside is what binds a /v1/zkquery proof to attested chain
  // state, so both the wrapper key and the field we read are load-bearing.
  const list = j?.result?.attestations;
  if (!Array.isArray(list)) {
    return {
      state: "drift",
      detail: "result.attestations is not an array — response shape changed, check the blockHash binding",
    };
  }
  if (list.length === 0) return { state: "drift", detail: "no recent attestations returned" };
  if (!list[0]?.blockHash) {
    return { state: "drift", detail: "attestation entries no longer carry blockHash" };
  }
  return { state: "ok", detail: `${list.length} attestation(s), best block ${list[0].blockNumber}` };
});

// ─── 4. Prover auth + the aggregate question ───────────────────────────────

section("Off-chain prover");

const apiKey = process.env.SXT_API_KEY ?? process.env.MAKEINFINITE_API_KEY;

await probe("auth: API key exchanges for a JWT", async () => {
  if (NO_PROVER) return { state: "unknown", detail: "skipped (--no-prover)" };
  if (!apiKey) return { state: "unknown", detail: "SXT_API_KEY not set" };
  const res = await fetch(PINNED.auth, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();

  if (res.ok) {
    let j;
    try {
      j = JSON.parse(body);
    } catch {
      return { state: "drift", detail: "200 but body is not JSON — response shape changed" };
    }
    if (!j?.accessToken) {
      return { state: "drift", detail: "200 but no accessToken in body — response shape changed" };
    }
    return { state: "ok", detail: "accessToken received (raw key is not a Bearer token)" };
  }

  // A rejected key is an account problem, not a protocol change. The endpoint
  // answering with a structured error proves the route and our request shape
  // are still correct, so this must not be reported as drift — doing so would
  // train people to ignore the script.
  if (/No Api Key found|Unauthorized|Subscription/i.test(body)) {
    return {
      state: "unknown",
      detail:
        `key rejected (HTTP ${res.status}: ${(JSON.parse(body || "{}").detail ?? "").slice(0, 80)}) — ` +
        "endpoint and request shape are correct, so this is a credential/subscription issue, not drift",
    };
  }

  return {
    state: "drift",
    detail: `${res.status} from ${PINNED.auth} with an unrecognized body — auth flow may have changed: ${body.slice(0, 100)}`,
  };
});

/**
 * The aggregate question.
 *
 * SXT's own docs describe the prover as evaluating "filters, joins, group-bys,
 * and aggregations", so aggregates are IN the documented surface. They were
 * empirically failing on 2026-06-10 with a null AttestedCommitments
 * deserialization error, and on that evidence both the CLI docs and
 * `sxt.run_proven_query` refuse them.
 *
 * That refusal is a workaround for a live defect, not a permanent surface
 * limit, so it has to be re-probed rather than assumed. Three outcomes:
 *
 *   ok      aggregates still fail — the refusal is still correct
 *   DRIFT   aggregates now WORK — remove the block, update the SKILL.md note
 *   unknown entitlement gate or transport failure — cannot tell
 */
await probe("aggregate support (re-probe; refusal is a dated workaround)", async () => {
  if (NO_PROVER) return { state: "unknown", detail: "skipped (--no-prover)" };
  if (!apiKey) return { state: "unknown", detail: "SXT_API_KEY not set" };

  const { SxTClient } = await import("sxt-proof-of-sql-sdk");
  const client = new SxTClient(PINNED.prover, PINNED.auth, PINNED.sxtRpcHttp, apiKey);

  try {
    await client.queryAndVerify(`SELECT COUNT(*) FROM ${PINNED.table}`);
    return {
      state: "drift",
      detail:
        "COUNT(*) SUCCEEDED — aggregates work again. Remove AGGREGATE_PATTERN from " +
        "packages/mcp/sxt-mcp/src/tools/run-proven-query.ts, drop the verifyHint warning, " +
        "and update the note in proof-of-sql-foundations/SKILL.md",
    };
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (/AttestedCommitments|deserialize prover response/i.test(msg)) {
      return {
        state: "ok",
        detail: "still failing with null AttestedCommitments — the refusal remains correct",
      };
    }
    if (/403|subscription|No Api Key found|404/i.test(msg)) {
      return {
        state: "unknown",
        detail:
          "blocked at auth (invalid key, or subscription gate) before reaching the prover — " +
          "aggregate status cannot be determined until the credential works",
      };
    }
    return { state: "unknown", detail: `inconclusive: ${msg.slice(0, 120)}` };
  }
});

// ─── Report ────────────────────────────────────────────────────────────────

const drift = results.filter((r) => r.state === "drift");
const unknown = results.filter((r) => r.state === "unknown");
const okCount = results.length - drift.length - unknown.length;

const artifact = {
  checkedAt: new Date().toISOString(),
  summary: { ok: okCount, drift: drift.length, unknown: unknown.length },
  results,
};
const artifactPath = resolve(HERE, ".upstream-check.json");
try {
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + "\n");
} catch {
  // Read-only checkout. The report on stdout is the primary output.
}

if (JSON_OUT) {
  console.log(JSON.stringify(artifact, null, 2));
} else {
  console.log("\n" + "─".repeat(60));
  console.log(
    `  ${okCount} ok · ${drift.length ? c.r(`${drift.length} drift`) : "0 drift"} · ${unknown.length} unknown`,
  );
  if (drift.length) {
    console.log(`\n  ${c.r("Upstream has moved. Review before shipping:")}`);
    for (const d of drift) console.log(`    - ${d.name}: ${d.detail}`);
  }
  if (unknown.length && !JSON_OUT) {
    console.log(
      c.d(
        `\n  ${unknown.length} check(s) inconclusive (offline or missing credential). Not treated as drift.`,
      ),
    );
  }
  console.log(c.d(`\n  Written to ${artifactPath}`));
}

// Only real drift fails. An unreachable endpoint must not block a build.
process.exit(drift.length === 0 ? 0 : 1);
