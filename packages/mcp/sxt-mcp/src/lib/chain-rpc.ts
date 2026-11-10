/**
 * JSON-RPC over HTTP to the SXT chain. Used by the free, keyless catalog reads
 * (generate_proof_plan, list_tables, describe_table).
 */

import { logger } from "./logger.js";

/** Retries only transient transport failures, matching save-proof-plans.mjs:228. */
export async function rpcFetch(endpoint: string, body: unknown, tries = 4): Promise<Response> {
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
      logger.debug(`chain RPC transport retry ${attempt}/${tries}: ${msg}`);
    }
  }
  throw lastErr;
}
