/**
 * sxt.run_proven_query and sxt.get_proof_result: off-chain Proof of SQL via
 * /v1/zkquery.
 *
 * Request sequence and bodies match sxt-proof-of-sql-sdk 0.54.0
 * `SxTClient.queryAndVerify`, which examples/scripts/verify-table.mjs calls.
 * The loop itself lives in lib/prover.ts so free steps can be retried and a
 * long proof can be resumed without resubmitting:
 *   1. POST /auth/apikey → 25-min JWT (cached per key for 20 min)
 *   2. attestation_v1_bestRecentAttestations → recent block hash
 *   3. POST /v1/zkquery → queryId              (spends one credit; never retried)
 *   4. Poll GET /v1/zkquery/{id}/status until done|failed|canceled
 *   5. GET /v1/zkquery/{id}/results
 *   6. Local WASM proof verify via verify_prover_response_hyper_kzg
 *
 * If the proof is still running at the end of `waitSeconds`, the tool returns
 * `status: "pending"` with the queryId. `sxt.get_proof_result` resumes from
 * step 4 and spends nothing.
 *
 * Safety: read-only. No SXT chain credits, no EVM gas, only a query credit on
 * the caller's own account. Network selection does not apply: the prover is a
 * single SXT-managed endpoint and the request body is always
 * sourceNetwork "mainnet" + commitmentScheme "HYPER_KZG", same as the SDK.
 */

import { z } from "zod";
import { loadConfig } from "../lib/config.js";
import { MissingCredentialError } from "../lib/errors.js";
import { ToolError } from "../lib/sanitize.js";
import { ProverClient, type ProofOutcome, type ProverDeps } from "../lib/prover.js";
import type { ToolContext } from "../lib/context.js";

// Endpoints match verify-table.mjs and the SXT canonical examples.
const PROVER_URL = process.env.SXT_PROVER ?? "https://api.makeinfinite.dev";
const AUTH_URL = process.env.SXT_AUTH ?? "https://proxy.api.makeinfinite.dev/auth/apikey";
const RPC_HTTP = process.env.SXT_RPC_HTTP ?? "https://rpc.mainnet.sxt.network/";

/** Ceiling on waitSeconds. Longer proofs come back pending and resume. */
const MAX_WAIT_SECONDS = Number(process.env.SXT_MCP_MAX_WAIT_SECONDS ?? 120);

const waitSecondsField = z
  .number()
  .int()
  .min(1)
  .max(MAX_WAIT_SECONDS)
  .default(60)
  .describe(
    `How long to wait for the proof, in seconds (1 to ${MAX_WAIT_SECONDS}, default 60). If the ` +
      "prover is still working after this, the result is status \"pending\" with a queryId; " +
      "call sxt.get_proof_result with it. Resuming spends no credit.",
  );

export const runProvenQuerySchema = z
  .object({
    tableRef: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/, "Must be PREFIX.TABLE in UPPERCASE_SNAKE_CASE")
      .describe(
        "Fully-qualified SXT table reference, e.g. MY_AUDIT.STAKERS_HEX_SUFFIX. " +
          "Used to validate the SQL FROM clause references the expected table.",
      ),
    sql: z
      .string()
      .describe(
        "Complete SELECT statement, including FROM <tableRef>. Must compile against " +
          "the proven SQL surface. Common refusals: windowed aggregates (OVER ...), " +
          "recursive CTEs, DML, DDL. See sxt://docs/proof-of-sql-foundations.",
      ),
    waitSeconds: waitSecondsField,
  })
  .strict();

export const getProofResultSchema = z
  .object({
    queryId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,128}$/, "A prover queryId as returned by sxt.run_proven_query")
      .describe("The queryId from a pending sxt.run_proven_query result."),
    waitSeconds: waitSecondsField,
  })
  .strict();

export type GetProofResultArgs = z.infer<typeof getProofResultSchema>;

export type RunProvenQueryArgs = z.infer<typeof runProvenQuerySchema>;

const UNPROVEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bover\s*\(/i,
    reason: "windowed aggregates (OVER ...) are not in the proven SQL surface",
  },
  {
    pattern: /\bwith\s+recursive\b/i,
    reason: "recursive CTEs are not in the proven SQL surface",
  },
  {
    pattern: /\b(insert|update|delete|merge|upsert)\b/i,
    reason: "DML statements are not provable; use sxt.publish_dataset to mutate state",
  },
  {
    pattern: /\b(drop|alter|truncate|create)\s+(table|view|index|schema)\b/i,
    reason: "DDL statements are not accepted by the prover",
  },
];

// Aggregates are in the proven SQL surface on paper, but the live prover
// currently returns null AttestedCommitments for them (see README "Prover
// status" and the note in mcp-parity-test.mjs). Submitting one burns an API
// quota tick and returns an opaque failure, so refuse by default. If SXT
// restores aggregate support, set SXT_MCP_ALLOW_AGGREGATES=1 to bypass this
// without waiting on a release.
//
// This refusal is a workaround for a live defect, not a permanent surface
// limit, so it must be re-probed rather than assumed. `sxt upstream`
// (examples/scripts/check-upstream.mjs) runs a live COUNT(*) and reports
// DRIFT with removal instructions the moment aggregates work again.
const AGGREGATE_PATTERN = /\b(count|sum|avg|min|max)\s*\(/i;

function validateProvenSurface(sql: string): void {
  for (const r of UNPROVEN_PATTERNS) {
    if (r.pattern.test(sql)) {
      throw new ToolError(
        "SQL_REJECTED",
        `SQL rejected before submission: ${r.reason}. ` +
          "See sxt://docs/proof-of-sql-foundations for the full proven surface.",
      );
    }
  }

  if (AGGREGATE_PATTERN.test(sql) && process.env.SXT_MCP_ALLOW_AGGREGATES !== "1") {
    throw new ToolError(
      "SQL_REJECTED",
      "SQL rejected before submission: aggregate functions (COUNT/SUM/AVG/MIN/MAX) currently " +
        "fail at the SXT prover with null AttestedCommitments, so submitting this would spend " +
        "an API quota tick and return an opaque error. Rewrite as a point lookup or filtered " +
        "projection, e.g. SELECT <col> FROM <table> WHERE <col> = '<value>'. " +
        "If the prover has since restored aggregate support, set SXT_MCP_ALLOW_AGGREGATES=1 to bypass.",
    );
  }
}

function validateTableReferenced(sql: string, tableRef: string): void {
  if (!new RegExp(`\\b${tableRef.replace(/\./g, "\\.")}\\b`, "i").test(sql)) {
    throw new ToolError(
      "SQL_REJECTED",
      `SQL does not reference the declared tableRef "${tableRef}". ` +
        "Either include the table reference in the FROM clause or correct the tableRef arg.",
    );
  }
}

/** Test hook: inject fetch / verify / clock into the prover client. */
let proverDeps: ProverDeps = {};
export function setProverDepsForTest(deps: ProverDeps): void {
  proverDeps = deps;
}

function resolveApiKey(ctx: ToolContext): string {
  // Hosted callers always bring their own key (ctx.apiKey). Only the local
  // stdio surface falls back to the operator's env key.
  const apiKey = ctx.credentialSource === "request" ? ctx.apiKey : (ctx.apiKey ?? loadConfig().apiKey);
  if (apiKey) return apiKey;
  if (ctx.credentialSource === "request") {
    throw new ToolError(
      "MISSING_CREDENTIAL",
      "No SXT API key is attached to this connection. Reconnect and sign in with your SXT API key.",
    );
  }
  throw new MissingCredentialError(
    "SXT_API_KEY",
    "exchange for a JWT and submit /v1/zkquery requests to the SXT prover",
  );
}

function client(apiKey: string): ProverClient {
  return new ProverClient({ prover: PROVER_URL, auth: AUTH_URL, rpc: RPC_HTTP }, apiKey, proverDeps);
}

function progressSink(ctx: ToolContext) {
  if (!ctx.progress) return undefined;
  let n = 0;
  return (message: string) => ctx.progress!(n++, message);
}

function render(outcome: ProofOutcome, started: number, extra: Record<string, unknown>) {
  const elapsedMs = Date.now() - started;
  if (outcome.state === "pending") {
    return {
      ...extra,
      status: "pending",
      verified: false,
      queryId: outcome.queryId,
      proverStatus: outcome.lastStatus,
      elapsedMs,
      next: `The proof is still running. Call sxt.get_proof_result with queryId "${outcome.queryId}". Resuming spends no credit.`,
    };
  }
  return {
    ...extra,
    status: "verified",
    verified: true,
    queryId: outcome.queryId,
    elapsedMs,
    result: outcome.result,
    endpoints: { prover: PROVER_URL, auth: AUTH_URL, substrateRpc: RPC_HTTP },
    notes: [
      "Proof verified locally via WASM verify_prover_response_hyper_kzg.",
      "The same proof is verifiable on-chain in ~150K gas via the QueryRouter contract.",
    ],
  };
}

export async function runProvenQueryHandler(args: RunProvenQueryArgs, ctx: ToolContext = {}) {
  const apiKey = resolveApiKey(ctx);
  validateProvenSurface(args.sql);
  validateTableReferenced(args.sql, args.tableRef);

  const started = Date.now();
  const outcome = await client(apiKey).prove(args.sql, {
    waitMs: args.waitSeconds * 1000,
    onProgress: progressSink(ctx),
    signal: ctx.signal,
  });
  return render(outcome, started, { tableRef: args.tableRef, sql: args.sql });
}

export async function getProofResultHandler(args: GetProofResultArgs, ctx: ToolContext = {}) {
  const apiKey = resolveApiKey(ctx);
  const started = Date.now();
  const outcome = await client(apiKey).resume(args.queryId, {
    waitMs: args.waitSeconds * 1000,
    onProgress: progressSink(ctx),
    signal: ctx.signal,
  });
  return render(outcome, started, {});
}
