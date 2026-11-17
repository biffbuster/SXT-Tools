/**
 * Off-chain prover client with an owned poll loop.
 *
 * Sends the same requests, in the same order, with the same bodies as
 * `SxTClient.queryAndVerify` in sxt-proof-of-sql-sdk 0.54.0 (pinned exactly in
 * package.json, drift-checked by examples/scripts/check-upstream.mjs):
 *
 *   1. POST {auth}                                  header `apikey`  → accessToken
 *   2. POST {rpc} attestation_v1_bestRecentAttestations             → attestationsFor
 *   3. POST {prover}/v1/zkquery                      Bearer          → queryId
 *   4. GET  {prover}/v1/zkquery/{id}/status          until done | failed | canceled
 *   5. GET  {prover}/v1/zkquery/{id}/results
 *   6. verify_prover_response_hyper_kzg(results)     local WASM verify
 *
 * What differs from the SDK, and why:
 *   - Steps 1, 2, 4 and 5 retry transient failures (network errors, 429, 5xx)
 *     with backoff. They spend nothing. The SDK fails the whole proof on one
 *     dropped status request, after the query credit is already spent.
 *   - Step 3 is NEVER retried. It is the only call that spends a query
 *     credit, and a retry after an ambiguous failure could charge twice.
 *   - Access tokens are cached per API key for 20 minutes (the JWT lives 25),
 *     and refreshed once on a 401.
 *   - Polling stops at a caller-chosen deadline. A proof still running then is
 *     returned as a pending handle (queryId) that `resume()` picks up later
 *     without resubmitting.
 */

import { createHash } from "node:crypto";
import { UpstreamError, ToolError } from "./sanitize.js";

export interface ProverEndpoints {
  prover: string;
  auth: string;
  rpc: string;
}

export type ProverStatus = "done" | "failed" | "canceled" | string;

export type ProofOutcome =
  | { state: "verified"; queryId: string; result: unknown; polls: number }
  | { state: "pending"; queryId: string; lastStatus: ProverStatus; polls: number };

export interface ProveOptions {
  /** Stop polling after this long and return a pending handle. */
  waitMs: number;
  onProgress?: (message: string) => void | Promise<void>;
  signal?: AbortSignal;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Verify = (proverResponseJson: unknown) => unknown;

export interface ProverDeps {
  fetch?: FetchLike;
  /** Defaults to the SDK's WASM verifier, loaded lazily. */
  verify?: Verify;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const TOKEN_TTL_MS = 20 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 5;
const TERMINAL = new Set(["done", "failed", "canceled"]);

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Process-wide JWT cache, keyed by a hash of the API key (never the key itself). */
const tokenCache = new Map<string, CachedToken>();

function cacheKey(apiKey: string): string {
  return createHash("sha256").update(`sxt-mcp:jwt:${apiKey}`).digest("hex");
}

/** An HTTP response worth retrying for a call that spends nothing. */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`${what}: ${status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
}

export class ProverClient {
  private readonly fetch: FetchLike;
  private readonly verifyOverride?: Verify;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly endpoints: ProverEndpoints,
    private readonly apiKey: string,
    deps: ProverDeps = {},
  ) {
    this.fetch = deps.fetch ?? ((url, init) => fetch(url, init));
    this.verifyOverride = deps.verify;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
  }

  /** Submit SQL and poll until verified or `waitMs` elapses. Spends one query credit. */
  async prove(sql: string, opts: ProveOptions): Promise<ProofOutcome> {
    const deadline = this.now() + opts.waitMs;
    await opts.onProgress?.("authenticating with SXT");
    const token = await this.accessToken();

    const attest = await this.withRetry("attestation lookup", opts.signal, () =>
      this.request(this.endpoints.rpc, "attestation lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "attestation_v1_bestRecentAttestations", params: null }),
      }),
    );
    const blockHash = (attest as { result?: { attestationsFor?: string } }).result?.attestationsFor;
    if (!blockHash) {
      throw new UpstreamError("Chain RPC", `attestation_v1_bestRecentAttestations returned no attestationsFor`);
    }

    // The one call that spends a credit: exactly one attempt.
    let submitted: { queryId?: string };
    try {
      submitted = (await this.authed("POST", "/v1/zkquery", token, {
        sqlText: sql,
        sourceNetwork: "mainnet",
        commitmentScheme: "HYPER_KZG",
        blockHash,
        timeout: null,
      })) as { queryId?: string };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const ambiguous = !(err instanceof HttpStatusError) || err.status >= 500;
      throw new UpstreamError(
        "Prover",
        `query submit failed: ${detail}`,
        ambiguous
          ? "The submit was not retried, because the prover may have accepted it and a retry could spend a second credit."
          : undefined,
      );
    }
    const queryId = submitted.queryId;
    if (!queryId) throw new UpstreamError("Prover", "submit response carried no queryId");

    await opts.onProgress?.(`submitted (queryId ${queryId})`);
    return this.poll(queryId, deadline, opts);
  }

  /** Continue a pending proof. Spends nothing: status and results only. */
  async resume(queryId: string, opts: ProveOptions): Promise<ProofOutcome> {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(queryId)) {
      throw new ToolError("INVALID_ARGUMENTS", "queryId is not a prover query id.");
    }
    return this.poll(queryId, this.now() + opts.waitMs, opts);
  }

  /** Authenticated GET on a read endpoint (e.g. /v2/discover/*). Spends nothing, so it is retried. */
  async getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const token = await this.accessToken();
    return this.withRetry(`GET ${path.split("?")[0]}`, signal, () => this.authed("GET", path, token));
  }

  private async poll(queryId: string, deadline: number, opts: ProveOptions): Promise<ProofOutcome> {
    let polls = 0;
    let status: ProverStatus = "unknown";
    let interval = 500;
    const started = this.now();

    for (;;) {
      if (opts.signal?.aborted) throw new ToolError("CANCELLED", "The request was cancelled by the client.");
      const token = await this.accessToken();
      const body = (await this.withRetry("status poll", opts.signal, () =>
        this.authed("GET", `/v1/zkquery/${encodeURIComponent(queryId)}/status`, token),
      )) as { status?: string };
      polls += 1;
      status = String(body.status ?? "unknown");
      if (TERMINAL.has(status)) break;

      const elapsed = Math.round((this.now() - started) / 1000);
      await opts.onProgress?.(`prover status: ${status} (${elapsed}s)`);
      if (this.now() + interval > deadline) {
        return { state: "pending", queryId, lastStatus: status, polls };
      }
      await this.sleep(interval);
      interval = Math.min(interval * 1.5, 2_000);
    }

    const token = await this.accessToken();
    const results = await this.withRetry("result fetch", opts.signal, () =>
      this.authed("GET", `/v1/zkquery/${encodeURIComponent(queryId)}/results`, token),
    );

    if (status !== "done") {
      throw new UpstreamError(
        "Prover",
        `query ${queryId} ended with status "${status}": ${JSON.stringify(results).slice(0, 400)}`,
      );
    }

    await opts.onProgress?.("verifying proof locally");
    const verify = this.verifyOverride ?? (await loadVerifier());
    let result: unknown;
    try {
      result = verify(results);
    } catch (err) {
      throw new UpstreamError("Verifier", `local proof verification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { state: "verified", queryId, result, polls };
  }

  private async accessToken(force = false): Promise<string> {
    const key = cacheKey(this.apiKey);
    const hit = tokenCache.get(key);
    if (!force && hit && hit.expiresAt > this.now()) return hit.token;

    const body = (await this.withRetry("auth exchange", undefined, () =>
      this.request(this.endpoints.auth, "auth exchange", {
        method: "POST",
        headers: { apikey: this.apiKey, "Content-Type": "application/json" },
      }),
    )) as { accessToken?: string };
    if (typeof body.accessToken !== "string") {
      throw new UpstreamError("Auth", "auth exchange returned no accessToken");
    }
    tokenCache.set(key, { token: body.accessToken, expiresAt: this.now() + TOKEN_TTL_MS });
    if (tokenCache.size > 10_000) {
      const now = this.now();
      for (const [k, v] of tokenCache) if (v.expiresAt <= now) tokenCache.delete(k);
    }
    return body.accessToken;
  }

  /** Prover call with Bearer auth; on 401, refresh the token once and retry. */
  private async authed(method: "GET" | "POST", path: string, token: string, data?: unknown): Promise<unknown> {
    const call = (t: string) =>
      this.request(`${this.endpoints.prover}${path}`, `${method} ${path.replace(/\/[^/]{8,}\//, "/{id}/")}`, {
        method,
        headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
    try {
      return await call(token);
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 401) {
        return call(await this.accessToken(true));
      }
      throw err;
    }
  }

  private async request(url: string, what: string, init: RequestInit): Promise<unknown> {
    const res = await this.fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpStatusError(res.status, text, what);
    }
    return res.json();
  }

  /**
   * Retries a call that spends nothing. Gives up immediately on a non-retryable
   * HTTP status (bad key, subscription gate, missing table): those will not
   * change on a retry.
   */
  private async withRetry(what: string, signal: AbortSignal | undefined, fn: () => Promise<unknown>): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw new ToolError("CANCELLED", "The request was cancelled by the client.");
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (err instanceof HttpStatusError && !retryableStatus(err.status)) break;
        if (attempt < MAX_ATTEMPTS) await this.sleep(Math.min(250 * 2 ** (attempt - 1), 4_000));
      }
    }
    const detail = lastErr instanceof Error ? describe(lastErr) : String(lastErr);
    throw new UpstreamError("Prover", `${what} failed: ${detail}`);
  }
}

/** Node's fetch hides the useful part (ECONNRESET, ENOTFOUND) in `cause`. */
function describe(err: Error): string {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  return cause?.code ? `${err.message} (${cause.code})` : err.message;
}

let verifier: Verify | undefined;
async function loadVerifier(): Promise<Verify> {
  if (!verifier) {
    const sdk = (await import("sxt-proof-of-sql-sdk")) as { verify_prover_response_hyper_kzg: Verify };
    verifier = sdk.verify_prover_response_hyper_kzg;
  }
  return verifier;
}

/** Test hook. */
export function clearTokenCache(): void {
  tokenCache.clear();
}
