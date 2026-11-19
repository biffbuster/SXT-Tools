/**
 * sxt.run_proven_query and sxt.get_proof_result: off-chain Proof of SQL via
 * /v1/zkquery.
 *
 * Request sequence and bodies match sxt-proof-of-sql-sdk 0.54.0
 * `SxTClient.queryAndVerify`, which examples/scripts/verify-table.mjs calls.
 * The loop itself lives in lib/prover.ts so free steps can be retried and a
 * long proof can be resumed without resubmitting:
 *   1. POST /auth/apikey → 25-min JWT (cached per key for 20 min)
 *   0. commitments_v1_evmProofPlan on the chain RPC (free): unsupported SQL is
 *      refused here with the planner's reason, before any credit is at stake
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
import { ToolError, UpstreamError } from "../lib/sanitize.js";
import type { ProofOutcome } from "../lib/prover.js";
import type { ToolContext } from "../lib/context.js";
import { rpcFetch } from "../lib/chain-rpc.js";
import { findTable } from "../lib/discovery.js";
import { logger } from "../lib/logger.js";
import { toRows } from "../lib/results.js";
import { AUTH_URL, PROVER_URL, RPC_HTTP, proverClient, requireApiKey } from "../lib/prover-session.js";
import { AGGREGATE_NOTE, NOT_COMMITTED, UNSTABLE_TABLES } from "./catalog.js";

export { setProverDepsForTest } from "../lib/prover-session.js";

/**
 * Tables at or above this size refuse SQL with neither WHERE nor LIMIT: the
 * result would be the whole table, which the prover must ship and this server
 * must verify and return. The 2026-11-16 ETHEREUM.TRANSACTIONS failure showed
 * one heavy proof can stall the shared prover for everyone.
 */
const LARGE_TABLE_BYTES = Number(process.env.SXT_MCP_LARGE_TABLE_BYTES ?? 50 * 1024 * 1024);

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

// Aggregates, as probed on 2026-11-17:
//   - GROUP BY on one BIGINT column with COUNT(*) proves and verifies
//     (HELLO_WORLD, queryId d42eae0d-6880-4a9b-a53f-5316523448fa).
//   - A whole-table COUNT(*) with no GROUP BY plans, then fails at execution
//     ("Query execution failed 3 times", IRIS, queryId 28d8d6d1-...).
//   - GROUP BY on a VARCHAR column does not compile (the planner preflight
//     reports that one).
// So only ungrouped aggregates are refused here. SXT_MCP_ALLOW_AGGREGATES=1
// lifts the refusal without a release. `sxt upstream`
// (examples/scripts/check-upstream.mjs) runs a live COUNT(*) and reports
// DRIFT the moment whole-table aggregates work again.
const AGGREGATE_PATTERN = /\b(count|sum|avg|min|max)\s*\(/i;
const GROUP_BY_PATTERN = /\bgroup\s+by\b/i;

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

  if (
    AGGREGATE_PATTERN.test(sql) &&
    !GROUP_BY_PATTERN.test(sql) &&
    process.env.SXT_MCP_ALLOW_AGGREGATES !== "1"
  ) {
    throw new ToolError(
      "SQL_REJECTED",
      "SQL rejected before submission: an aggregate with no GROUP BY fails at the SXT prover today. " +
        AGGREGATE_NOTE +
        // The operator override (SXT_MCP_ALLOW_AGGREGATES) is documented in SAFETY.md, not
        // here: a hosted user cannot set it, so the message offers a rewrite instead.
        " Rewrite it with GROUP BY on a non-VARCHAR column, or select the rows with a WHERE filter or LIMIT.",
    );
  }
}

function validateStableTable(tableRef: string): void {
  const warning = UNSTABLE_TABLES[tableRef];
  if (warning && process.env.SXT_MCP_ALLOW_UNSTABLE_TABLES !== "1") {
    throw new ToolError("SQL_REJECTED", `SQL rejected before submission: ${warning}`);
  }
}

/** Planner messages, translated into what an agent should change. */
function plannerHint(message: string): string {
  if (/LogicalPlan is not supported/i.test(message)) {
    return "The query shape is not provable. " + AGGREGATE_NOTE;
  }
  if (/column/i.test(message)) {
    return (
      "A column name is wrong or a column type cannot be used there. Call sxt.describe_table for the " +
      "exact names; DECIMAL and TIMESTAMP columns cannot be compared in WHERE."
    );
  }
  return "Call sxt.describe_table for the columns and supported filters.";
}

/**
 * Compiles the SQL on the chain RPC before anything is submitted. Free, and
 * the same planner the prover uses: every query it refused on 2026-11-17 the
 * prover's own build-plan refused too.
 */
async function preflightPlan(sql: string): Promise<void> {
  const res = await rpcFetch(RPC_HTTP, {
    jsonrpc: "2.0",
    id: 1,
    method: "commitments_v1_evmProofPlan",
    params: { query: sql },
  });
  let json: { result?: { proofPlan?: string }; error?: { code?: number; message?: string } };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new UpstreamError("Chain RPC", `${RPC_HTTP} returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (!json.error) return;
  const message = String(json.error.message ?? "unknown error").slice(0, 300);
  if (json.error.code === NOT_COMMITTED) {
    throw new ToolError(
      "TABLE_NOT_PROVABLE",
      "The table is not provable: it does not exist in the prover's catalog or has no proof commitments. " +
        "Check the PREFIX.TABLE spelling, or call sxt.list_tables.",
    );
  }
  throw new ToolError(
    "SQL_REJECTED",
    `SQL rejected by the proof planner (nothing was spent): ${message}. ${plannerHint(message)}`,
  );
}

const BOUNDED_PATTERN = /\b(where|limit)\b/i;

/** Refuses an unbounded query on a large table. Skipped when the size is unknown. */
async function validateBounded(sql: string, tableRef: string, apiKey: string, signal?: AbortSignal): Promise<void> {
  if (BOUNDED_PATTERN.test(sql) || GROUP_BY_PATTERN.test(sql)) return;
  let sizeBytes: number | null = null;
  let size: string | null = null;
  try {
    const client = proverClient(apiKey);
    const t = await findTable((p) => client.getJson(p, signal), tableRef);
    sizeBytes = t?.sizeBytes ?? null;
    size = t?.size ?? null;
  } catch (err) {
    logger.debug(`size lookup for ${tableRef} failed: ${(err as Error).message}`);
    return;
  }
  if (sizeBytes !== null && sizeBytes >= LARGE_TABLE_BYTES) {
    throw new ToolError(
      "SQL_REJECTED",
      `SQL rejected before submission: ${tableRef} is ${size}, and this query has no WHERE or LIMIT, so it ` +
        "would return the whole table. Add a WHERE filter or a LIMIT.",
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
  const decoded = toRows(outcome.result);
  return {
    ...extra,
    status: "verified",
    verified: true,
    queryId: outcome.queryId,
    elapsedMs,
    ...(decoded ? { rowCount: decoded.rowCount, rows: decoded.rows } : {}),
    result: outcome.result,
    endpoints: { prover: PROVER_URL, auth: AUTH_URL, substrateRpc: RPC_HTTP },
    notes: [
      "Proof verified locally via WASM verify_prover_response_hyper_kzg.",
      "rows is result decoded for reading (DECIMAL as exact strings, VARBINARY as 0x hex); result is the raw verifier output.",
      "The same proof is verifiable on-chain in ~150K gas via the QueryRouter contract.",
    ],
  };
}

export async function runProvenQueryHandler(args: RunProvenQueryArgs, ctx: ToolContext = {}) {
  const apiKey = requireApiKey(ctx);
  validateProvenSurface(args.sql);
  validateTableReferenced(args.sql, args.tableRef);
  validateStableTable(args.tableRef);
  await preflightPlan(args.sql);
  await validateBounded(args.sql, args.tableRef, apiKey, ctx.signal);

  const started = Date.now();
  const outcome = await proverClient(apiKey).prove(args.sql, {
    waitMs: args.waitSeconds * 1000,
    onProgress: progressSink(ctx),
    signal: ctx.signal,
  });
  return render(outcome, started, { tableRef: args.tableRef, sql: args.sql });
}

export async function getProofResultHandler(args: GetProofResultArgs, ctx: ToolContext = {}) {
  const apiKey = requireApiKey(ctx);
  const started = Date.now();
  const outcome = await proverClient(apiKey).resume(args.queryId, {
    waitMs: args.waitSeconds * 1000,
    onProgress: progressSink(ctx),
    signal: ctx.signal,
  });
  return render(outcome, started, {});
}
