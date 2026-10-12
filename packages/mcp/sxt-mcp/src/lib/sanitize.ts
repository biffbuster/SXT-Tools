/**
 * Error sanitizer. Maps any thrown error to a stable, agent-readable code plus
 * a message that is safe to return to a remote caller.
 *
 * Two audiences:
 *   - stdio (local, the user's own process): the full upstream detail is kept,
 *     because the person reading it is the person who owns the credentials.
 *   - hosted HTTP: only the canned message for the code is returned. Upstream
 *     text (prover internals, RPC payloads, stack fragments) goes to the
 *     server log under the request id, never to the caller.
 *
 * Messages our own code raises on purpose (SQL refusals, the mainnet gate,
 * argument validation) are authored for agents and pass through in both modes.
 */

import { ZodError } from "zod";
import { MainnetGateError, MissingCredentialError } from "./errors.js";

export type ErrorCode =
  | "INVALID_ARGUMENTS"
  | "SQL_REJECTED"
  | "MAINNET_GATE"
  | "MISSING_CREDENTIAL"
  | "SXT_KEY_INVALID"
  | "SXT_SUBSCRIPTION_REQUIRED"
  | "TABLE_NOT_PROVABLE"
  | "RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "CANCELLED"
  | "INTERNAL";

/** An error raised deliberately by our code, with a message written for agents. */
export class ToolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/** Wraps an upstream (prover / RPC) failure; the raw text is kept for logs only. */
export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly detail: string,
    /** Troubleshooting hint for local callers; not used for classification. */
    readonly hint?: string,
  ) {
    super(`${service} request failed: ${detail}${hint ? ` ${hint}` : ""}`);
    this.name = "UpstreamError";
  }
}

const CANNED: Record<ErrorCode, string> = {
  INVALID_ARGUMENTS: "The tool arguments did not match the schema.",
  SQL_REJECTED: "The SQL was rejected before submission.",
  MAINNET_GATE: "Mainnet execution is not enabled for this call.",
  MISSING_CREDENTIAL: "No SXT API key is attached to this connection. Reconnect and sign in with your SXT API key.",
  SXT_KEY_INVALID: "SXT rejected the API key for this connection. Reconnect with a current key from app.spaceandtime.ai.",
  SXT_SUBSCRIPTION_REQUIRED: "The SXT account behind this API key has no active subscription. Activate one at app.spaceandtime.ai, then retry.",
  TABLE_NOT_PROVABLE: "The table is not in the prover's MAINNET catalog. Check the table reference, or confirm it was published without a PRIMARY KEY clause.",
  RATE_LIMITED: "Too many requests for this connection. Wait a moment and retry.",
  UPSTREAM_TIMEOUT: "The SXT prover did not finish in time. Retry, or narrow the query.",
  UPSTREAM_ERROR: "The SXT prover returned an error for this query.",
  CANCELLED: "The request was cancelled.",
  INTERNAL: "Internal server error.",
};

const RETRYABLE: Partial<Record<ErrorCode, true>> = {
  RATE_LIMITED: true,
  UPSTREAM_TIMEOUT: true,
  UPSTREAM_ERROR: true,
};

export interface SanitizedError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  /** Full upstream detail. Returned to stdio callers; logged (never returned) in hosted mode. */
  detail?: string;
}

function classifyUpstream(text: string): ErrorCode {
  if (/no api key found|invalid jwt|\b401\b|unauthori[sz]ed|auth exchange failed: 4\d\d/i.test(text)) return "SXT_KEY_INVALID";
  if (/subscription required|insufficient privileges|\b403\b|forbidden/i.test(text)) return "SXT_SUBSCRIPTION_REQUIRED";
  if (/does not exist in source network|\b422\b/i.test(text)) return "TABLE_NOT_PROVABLE";
  if (/\b429\b|too many requests|rate limit/i.test(text)) return "RATE_LIMITED";
  if (/timed? ?out|timeout|ETIMEDOUT|deadline/i.test(text)) return "UPSTREAM_TIMEOUT";
  return "UPSTREAM_ERROR";
}

export function sanitizeError(err: unknown): SanitizedError {
  if (err instanceof ToolError) {
    return { code: err.code, message: err.message, retryable: err.retryable || !!RETRYABLE[err.code] };
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { code: "INVALID_ARGUMENTS", message: `${CANNED.INVALID_ARGUMENTS} ${issues}`, retryable: false };
  }
  if (err instanceof MainnetGateError) return { code: "MAINNET_GATE", message: err.message, retryable: false };
  if (err instanceof MissingCredentialError) {
    return { code: "MISSING_CREDENTIAL", message: err.message, retryable: false };
  }
  if (err instanceof UpstreamError) {
    const code = classifyUpstream(err.detail);
    return { code, message: CANNED[code], retryable: !!RETRYABLE[code], detail: err.message };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return { code: "INTERNAL", message: CANNED.INTERNAL, retryable: false, detail };
}

export function cannedMessage(code: ErrorCode): string {
  return CANNED[code];
}
