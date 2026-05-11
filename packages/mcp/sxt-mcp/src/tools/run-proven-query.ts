/**
 * sxt.run_proven_query — off-chain Proof of SQL via /v1/zkquery.
 *
 * Mirrors examples/scripts/verify-stakers.mjs line-for-line. Uses the
 * sxt-proof-of-sql-sdk SxTClient which encapsulates:
 *   1. POST /auth/apikey → 25-min JWT
 *   2. attestation_v1_bestRecentAttestations → recent block hash
 *   3. POST /v1/zkquery → queryId
 *   4. Poll GET /v1/zkquery/{id}/status until done|failed|canceled (60s cap)
 *   5. GET /v1/zkquery/{id}/results
 *   6. Local WASM proof verify via verify_prover_response_hyper_kzg
 *
 * Safety: this tool is read-only. No SXT chain credits, no EVM gas — only an
 * API quota tick. Mainnet/testnet network selection does NOT apply: the prover
 * service is a single SXT-managed endpoint and the SDK hardcodes
 * sourceNetwork: "mainnet" + commitmentScheme: "HYPER_KZG" for the request body.
 * Therefore no mainnet gate is enforced on this tool.
 */

import { z } from "zod";
import { loadConfig } from "../lib/config.js";
import { MissingCredentialError } from "../lib/errors.js";

// Endpoints match verify-stakers.mjs and the SXT canonical examples.
const PROVER_URL = process.env.SXT_PROVER ?? "https://api.makeinfinite.dev";
const AUTH_URL = process.env.SXT_AUTH ?? "https://proxy.api.makeinfinite.dev/auth/apikey";
const RPC_HTTP = process.env.SXT_RPC_HTTP ?? "https://rpc.mainnet.sxt.network/";

export const runProvenQuerySchema = z.object({
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
});

export type RunProvenQueryArgs = z.infer<typeof runProvenQuerySchema>;

interface SxTClientLike {
  queryAndVerify(sql: string, blockHash?: string | null): Promise<unknown>;
}

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

function validateProvenSurface(sql: string): void {
  for (const r of UNPROVEN_PATTERNS) {
    if (r.pattern.test(sql)) {
      throw new Error(
        `SQL rejected before submission: ${r.reason}. ` +
          "See sxt://docs/proof-of-sql-foundations for the full proven surface.",
      );
    }
  }
}

function validateTableReferenced(sql: string, tableRef: string): void {
  if (!new RegExp(`\\b${tableRef.replace(/\./g, "\\.")}\\b`, "i").test(sql)) {
    throw new Error(
      `SQL does not reference the declared tableRef "${tableRef}". ` +
        "Either include the table reference in the FROM clause or correct the tableRef arg.",
    );
  }
}

export async function runProvenQueryHandler(args: RunProvenQueryArgs) {
  const config = loadConfig();
  if (!config.apiKey) {
    throw new MissingCredentialError(
      "SXT_API_KEY",
      "exchange for a JWT and submit /v1/zkquery requests to the SXT prover",
    );
  }

  validateProvenSurface(args.sql);
  validateTableReferenced(args.sql, args.tableRef);

  // Lazy import — keeps server startup fast and avoids loading WASM until needed.
  const { SxTClient } = (await import("sxt-proof-of-sql-sdk")) as {
    SxTClient: new (
      zkQueryRootURL: string,
      authRootURL: string,
      substrateNodeURL: string,
      sxtApiKey: string,
    ) => SxTClientLike;
  };

  const client = new SxTClient(PROVER_URL, AUTH_URL, RPC_HTTP, config.apiKey);

  let result: unknown;
  try {
    result = await client.queryAndVerify(args.sql);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Prover request failed: ${message}. ` +
        "Common causes: (1) table not in MAINNET catalog — check it was published " +
        "without a PRIMARY KEY clause; (2) raw API key passed as Bearer instead of via " +
        "/auth/apikey exchange (SDK handles this — confirm SXT_API_KEY is the Studio key, " +
        "not a JWT); (3) SQL contains an unproven operator the local validator missed.",
    );
  }

  return {
    tableRef: args.tableRef,
    sql: args.sql,
    verified: true,
    result,
    endpoints: {
      prover: PROVER_URL,
      auth: AUTH_URL,
      substrateRpc: RPC_HTTP,
    },
    notes: [
      "Proof verified locally via WASM verify_prover_response_hyper_kzg.",
      "The same proof is verifiable on-chain in ~150K gas via the QueryRouter contract.",
    ],
  };
}
