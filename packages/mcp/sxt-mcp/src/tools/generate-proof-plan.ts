/**
 * sxt.generate_proof_plan — compile SQL into an EVM proof plan.
 *
 * Mirrors examples/scripts/save-proof-plans.mjs and generate-chain-plan.mjs.
 * Calls the SXT chain RPC method `commitments_v1_evmProofPlan`, which returns
 * the hex blob a Solidity contract embeds as `bytes public constant QUERY_PLAN`
 * and submits through `IQueryRouter.requestQuery`.
 *
 * This is the missing link between `sxt.publish_dataset` and the on-chain
 * proof. Without it an agent can publish a table and prove against it off-chain
 * but has no route to a verifiable on-chain event.
 *
 * Cost: none. Plain JSON-RPC read against a public endpoint, no credentials, no
 * chain write, no API quota. Safe to call speculatively.
 *
 * Isolation: returns the plan in the response and writes nothing to disk unless
 * the caller passes `outputPath`. No shared handoff file, so two users of the
 * same server never see each other's plans.
 */

import { z } from "zod";
import { selectNetwork } from "../lib/network.js";
import { ToolError, UpstreamError } from "../lib/sanitize.js";
import type { ToolContext } from "../lib/context.js";
import { logger } from "../lib/logger.js";

export const generateProofPlanSchema = z
  .object({
    sql: z
      .string()
      .describe(
        "Complete SELECT to compile. Must reference a fully-qualified table (PREFIX.TABLE) that " +
          "exists in the SXT catalog. Parameterized plans use $1, $2 placeholders; declare their " +
          "types in paramTypes.",
      ),
    paramTypes: z
      .array(z.enum(["BOOLEAN", "TINYINT", "SMALLINT", "INT", "INTEGER", "BIGINT", "VARCHAR", "TIMESTAMP"]))
      .default([])
      .describe(
        "Types for $1, $2, ... in declaration order. Empty (default) means a literal plan with no " +
          "placeholders. A parameterized plan lets one deployed contract serve any input value.",
      ),
    name: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/, "Letters, digits, underscore and hyphen only")
      .default("proof-plan")
      .describe("Short label recorded in the artifact. Used as the filename when outputPath is a directory."),
    mainnet: z
      .boolean()
      .default(false)
      .describe(
        "Compile against the mainnet chain catalog. Requires SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND. " +
          "Default false uses testnet. A plan is bound to the catalog it was compiled against, so " +
          "this must match the network the table was published to.",
      ),
    outputPath: z
      .string()
      .optional()
      .describe(
        "Optional path to write the plan artifact as JSON. When omitted, the plan is returned in " +
          "the response only and nothing touches the filesystem.",
      ),
  })
  .strict();

export type GenerateProofPlanArgs = z.infer<typeof generateProofPlanSchema>;

// Operators outside the proven surface. Same list run-proven-query enforces,
// kept here because a plan that compiles but cannot execute wastes the user's
// deploy gas rather than an API tick.
const UNPROVEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bover\s*\(/i, reason: "windowed aggregates (OVER ...) are not in the proven SQL surface" },
  { pattern: /\bwith\s+recursive\b/i, reason: "recursive CTEs are not in the proven SQL surface" },
  {
    pattern: /\b(insert|update|delete|merge|upsert)\b/i,
    reason: "DML statements are not provable; use sxt.publish_dataset to write data",
  },
  {
    pattern: /\b(drop|alter|truncate|create)\s+(table|view|index|schema)\b/i,
    reason: "DDL statements are not accepted by the prover",
  },
];

interface RpcResponse {
  result?: { proofPlan?: string; at?: string };
  error?: { message?: string; code?: number };
}

/** Retries only transient transport failures, matching save-proof-plans.mjs:228. */
async function rpcFetch(endpoint: string, body: unknown, tries = 4): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      lastErr = err;
      const msg = String(err instanceof Error ? err.message : err);
      if (!/fetch failed|TIMEOUT|ECONN|ETIMEDOUT|ABORT/i.test(msg)) throw err;
      logger.debug(`evmProofPlan transport retry ${attempt}/${tries}: ${msg}`);
    }
  }
  throw lastErr;
}

export async function generateProofPlanHandler(args: GenerateProofPlanArgs, ctx: ToolContext = {}) {
  // A network-exposed server must never write to caller-chosen paths.
  if (args.outputPath && ctx.allowFilesystem === false) {
    throw new ToolError(
      "INVALID_ARGUMENTS",
      "outputPath is not available on the hosted server. Omit it; the plan is returned in the response.",
    );
  }

  for (const r of UNPROVEN_PATTERNS) {
    if (r.pattern.test(args.sql)) {
      throw new ToolError(
        "SQL_REJECTED",
        `SQL rejected before compilation: ${r.reason}. ` +
          "See sxt://docs/proof-of-sql-foundations for the full proven surface.",
      );
    }
  }

  // Placeholder count must match declared types, or the rendered contract will
  // encode the wrong number of arguments at call time.
  const placeholders = [...new Set(args.sql.match(/\$\d+/g) ?? [])].sort();
  if (placeholders.length !== args.paramTypes.length) {
    throw new ToolError(
      "INVALID_ARGUMENTS",
      `SQL has ${placeholders.length} distinct placeholder(s) (${placeholders.join(", ") || "none"}) ` +
        `but paramTypes declares ${args.paramTypes.length}. Each $1, $2, ... needs one entry, in order.`,
    );
  }

  const network = selectNetwork({
    mainnet: args.mainnet,
    action: `generate_proof_plan against the SXT ${args.mainnet ? "mainnet" : "testnet"} catalog`,
  });

  const res = await rpcFetch(network.sxtRpcHttp, {
    jsonrpc: "2.0",
    id: args.name,
    method: "commitments_v1_evmProofPlan",
    params: { query: args.sql },
  });

  let json: RpcResponse;
  try {
    json = (await res.json()) as RpcResponse;
  } catch {
    throw new UpstreamError(
      "Chain RPC",
      `${network.sxtRpcHttp} returned a non-JSON response (HTTP ${res.status}).`,
    );
  }

  if (json.error) {
    throw new ToolError(
      "SQL_REJECTED",
      `commitments_v1_evmProofPlan failed: ${json.error.message ?? "unknown error"}. ` +
        "Common causes: the table does not exist in this network's catalog (confirm the publish " +
        "landed and that mainnet/testnet matches), or a column name in the SQL is misspelled.",
    );
  }

  const proofPlan = json.result?.proofPlan;
  if (!proofPlan) {
    throw new UpstreamError(
      "Chain RPC",
      `no proofPlan in the response from ${network.sxtRpcHttp}. ` +
        `Raw response: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }

  const artifact = {
    name: args.name,
    sql: args.sql,
    paramTypes: args.paramTypes,
    parameterized: args.paramTypes.length > 0,
    proofPlan,
    proofPlanBytes: (proofPlan.length - 2) / 2,
    chainStateAt: json.result?.at ?? null,
    rpcEndpoint: network.sxtRpcHttp,
    network: network.network,
    queryRouter: network.queryRouter,
    verifier: network.verifier,
    generatedAt: new Date().toISOString(),
  };

  let writtenTo: string | null = null;
  if (args.outputPath) {
    // Imported lazily: only the local stdio surface writes files, and the
    // Workers bundle must not depend on node:fs.
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname, isAbsolute, resolve } = await import("node:path");
    const target = isAbsolute(args.outputPath)
      ? args.outputPath
      : resolve(process.cwd(), args.outputPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(artifact, null, 2) + "\n", "utf8");
    writtenTo = target;
  }

  return {
    ...artifact,
    writtenTo,
    notes: [
      'Embed in Solidity as: bytes public constant QUERY_PLAN = hex"<proofPlan without the 0x>";',
      `Submit via IQueryRouter.requestQuery against ${network.queryRouter}.`,
      "The plan is bound to the catalog state at chainStateAt. Republishing the table invalidates " +
        "it — regenerate and redeploy the contract after any republish.",
      "Pre-flight with sxt.run_proven_query on the same SQL before spending on chain. A successful " +
        "off-chain proof means the on-chain query will also fulfill.",
    ],
  };
}
