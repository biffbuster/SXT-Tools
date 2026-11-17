/**
 * Resolves the caller's SXT API key and builds a ProverClient for it. Shared
 * by the proof tools and the catalog tools, which read the discovery API with
 * the same key and JWT cache.
 */

import { loadConfig } from "./config.js";
import { MissingCredentialError } from "./errors.js";
import { ToolError } from "./sanitize.js";
import { ProverClient, type ProverDeps } from "./prover.js";
import type { ToolContext } from "./context.js";

// Endpoints match verify-table.mjs and the SXT canonical examples.
export const PROVER_URL = process.env.SXT_PROVER ?? "https://api.makeinfinite.dev";
export const AUTH_URL = process.env.SXT_AUTH ?? "https://proxy.api.makeinfinite.dev/auth/apikey";
export const RPC_HTTP = process.env.SXT_RPC_HTTP ?? "https://rpc.mainnet.sxt.network/";

/** Test hook: inject fetch / verify / clock into the prover client. */
let proverDeps: ProverDeps = {};
export function setProverDepsForTest(deps: ProverDeps): void {
  proverDeps = deps;
}

/** The caller's key, or undefined. Hosted callers bring their own; only stdio falls back to the env key. */
export function optionalApiKey(ctx: ToolContext): string | undefined {
  return ctx.credentialSource === "request" ? ctx.apiKey : (ctx.apiKey ?? loadConfig().apiKey);
}

export function requireApiKey(ctx: ToolContext): string {
  const apiKey = optionalApiKey(ctx);
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

export function proverClient(apiKey: string): ProverClient {
  return new ProverClient({ prover: PROVER_URL, auth: AUTH_URL, rpc: RPC_HTTP }, apiKey, proverDeps);
}
