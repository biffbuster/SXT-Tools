#!/usr/bin/env node
/**
 * mcp-parity-test.mjs — proves MCP wrapping is a correct protocol adapter.
 *
 * The MCP server wraps the same SDK that verify-stakers.mjs uses. Both should
 * produce identical verified results for the same SQL — if they don't, the
 * MCP layer is lossy. This script exercises both paths and diffs their output.
 *
 * Path A: spawn the MCP server, send tools/call sxt.run_proven_query
 * Path B: call SxTClient.queryAndVerify directly (same as verify-stakers.mjs)
 *
 * Both paths run against the live mainnet prover. Cost: 2× API quota tick.
 *
 * Usage:
 *   node mcp-parity-test.mjs          # one round-trip per path
 *   node mcp-parity-test.mjs --json   # emit JSON instead of human output
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Load .env from examples/scripts/ explicitly so cwd doesn't matter.
const dotenv = await import("dotenv");
dotenv.config({ path: resolve(HERE, ".env") });
const REPO_ROOT = resolve(HERE, "..", "..");
const MCP_INDEX = resolve(REPO_ROOT, "packages", "mcp", "sxt-mcp", "dist", "index.js");

const STAKERS_TABLE =
  process.env.SXT_TABLE ?? "MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS";
const SQL = `SELECT COUNT(*) AS ROW_COUNT FROM ${STAKERS_TABLE}`;

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");

function log(msg) {
  if (!JSON_OUT) console.log(msg);
}

const apiKey = process.env.SXT_API_KEY ?? process.env.MAKEINFINITE_API_KEY;
if (!apiKey) {
  console.error("✗ SXT_API_KEY not set in .env. Set it and rerun.");
  process.exit(1);
}

// ─── Path A: via MCP server ─────────────────────────────────────────────

async function runViaMcp() {
  const start = Date.now();
  const child = spawn("node", [MCP_INDEX], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SXT_API_KEY: apiKey },
  });

  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  // Discard stderr — banner only.
  child.stderr.on("data", () => {});

  const writeMsg = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");

  writeMsg({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "parity-test", version: "1.0.0" },
    },
  });
  writeMsg({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "sxt.run_proven_query",
      arguments: { tableRef: STAKERS_TABLE, sql: SQL },
    },
  });

  // Wait up to 90s for the verify call (the off-chain prover can be slow).
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (stdout.match(/"id":2/)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();

  if (!stdout.match(/"id":2/)) {
    throw new Error("MCP did not return a response for tools/call within 90s");
  }

  // Pull the second response (id:2). Each frame is one line of JSON.
  const lines = stdout.trim().split("\n");
  const responseLine = lines.find((l) => /"id":2/.test(l));
  if (!responseLine) throw new Error("no tools/call response in stdout");

  const response = JSON.parse(responseLine);
  if (response.result?.isError) {
    throw new Error(`MCP returned error: ${response.result.content?.[0]?.text}`);
  }

  const text = response.result?.content?.[0]?.text;
  if (!text) throw new Error("MCP response missing content[0].text");
  const parsed = JSON.parse(text);

  return {
    elapsedMs: Date.now() - start,
    result: parsed.result,
    verified: parsed.verified,
    tableRef: parsed.tableRef,
  };
}

// ─── Path B: direct SDK call ────────────────────────────────────────────

async function runViaSdk() {
  const start = Date.now();
  const { SxTClient } = await import("sxt-proof-of-sql-sdk");
  const client = new SxTClient(
    process.env.SXT_PROVER ?? "https://api.makeinfinite.dev",
    process.env.SXT_AUTH ?? "https://proxy.api.makeinfinite.dev/auth/apikey",
    process.env.SXT_RPC_HTTP ?? "https://rpc.mainnet.sxt.network/",
    apiKey,
  );

  const result = await client.queryAndVerify(SQL);
  return {
    elapsedMs: Date.now() - start,
    result,
  };
}

// ─── Compare ────────────────────────────────────────────────────────────

function canonical(obj) {
  // Stable stringify for a structural diff.
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonical).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

log("\n  MCP/CLI parity test\n");
log(`  SQL: ${SQL}`);
log("");

let mcpResult, sdkResult, mcpError, sdkError;

log("  Path A: via MCP server (sxt.run_proven_query tool)…");
try {
  mcpResult = await runViaMcp();
  log(`    ✓ ${mcpResult.elapsedMs}ms  verified=${mcpResult.verified}  tableRef=${mcpResult.tableRef}`);
} catch (e) {
  mcpError = e;
  log(`    ✗ ${e.message}`);
}
log("");

log("  Path B: direct SDK call (verify-stakers.mjs equivalent)…");
try {
  sdkResult = await runViaSdk();
  log(`    ✓ ${sdkResult.elapsedMs}ms`);
} catch (e) {
  sdkError = e;
  log(`    ✗ ${e.message}`);
}
log("");

if (mcpError || sdkError) {
  log("─".repeat(60));
  log(`  ✗ Parity test failed — at least one path errored.`);
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: false, mcpError: mcpError?.message, sdkError: sdkError?.message }));
  }
  process.exit(1);
}

const mcpCanon = canonical(mcpResult.result);
const sdkCanon = canonical(sdkResult.result);
const match = mcpCanon === sdkCanon;

log("  Diff:");
log(`    MCP result canonical:  ${mcpCanon.slice(0, 100)}${mcpCanon.length > 100 ? "..." : ""}`);
log(`    SDK result canonical:  ${sdkCanon.slice(0, 100)}${sdkCanon.length > 100 ? "..." : ""}`);
log("");

log("─".repeat(60));
if (match) {
  log(`  ✓ Parity confirmed — MCP wrapping is a correct protocol adapter.`);
  log(`    MCP overhead: ${mcpResult.elapsedMs - sdkResult.elapsedMs}ms over direct SDK.`);
} else {
  log(`  ✗ Outputs DIVERGED — MCP layer is lossy. Investigate before relying on the MCP path.`);
}

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        ok: match,
        mcpElapsedMs: mcpResult.elapsedMs,
        sdkElapsedMs: sdkResult.elapsedMs,
        mcpOverheadMs: mcpResult.elapsedMs - sdkResult.elapsedMs,
        mcpResult: mcpResult.result,
        sdkResult: sdkResult.result,
      },
      null,
      2,
    ),
  );
}

process.exit(match ? 0 : 1);
