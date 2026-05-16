/**
 * Level-gated stderr logger.
 *
 * Levels (low → high verbosity): info | debug | trace.
 * Defaults to "info". Override with `MCP_DEBUG_LEVEL=debug|trace`.
 * Backward-compat: `SXT_MCP_DEBUG=1` maps to "debug".
 *
 * All output goes to stderr so it doesn't corrupt the stdio MCP transport
 * (which speaks JSON-RPC on stdout). HTTP transport ignores stderr.
 *
 * Redaction: we scan emitted strings for known secret shapes (raw Ethereum
 * private keys and JWTs) and replace them before write. This is defensive —
 * tool arg schemas don't currently carry secrets — but cheap insurance if a
 * future tool adds a token-bearing field.
 */

export type LogLevel = "info" | "debug" | "trace";

const ORDER: Record<LogLevel, number> = { info: 0, debug: 1, trace: 2 };

function resolveLevel(): LogLevel {
  const raw = (process.env.MCP_DEBUG_LEVEL ?? "").toLowerCase();
  if (raw === "info" || raw === "debug" || raw === "trace") return raw;
  if (process.env.SXT_MCP_DEBUG === "1" || process.env.SXT_MCP_DEBUG === "true") {
    return "debug";
  }
  return "info";
}

// Ethereum private keys: 32 raw bytes encoded as 0x + 64 hex chars.
const PRIVATE_KEY_PATTERN = /\b0x[0-9a-fA-F]{64}\b/g;
// JWT: three dot-separated base64url segments, the header always starts with `eyJ`.
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function redact(message: string): string {
  return message
    .replace(PRIVATE_KEY_PATTERN, "0x[REDACTED-PRIVATE-KEY]")
    .replace(JWT_PATTERN, "[REDACTED-JWT]");
}

const CURRENT_LEVEL = resolveLevel();

function emit(level: LogLevel, message: string): void {
  if (ORDER[level] > ORDER[CURRENT_LEVEL]) return;
  process.stderr.write(`[sxt-mcp:${level}] ${redact(message)}\n`);
}

export const logger = {
  level: CURRENT_LEVEL,
  info: (message: string) => emit("info", message),
  debug: (message: string) => emit("debug", message),
  trace: (message: string) => emit("trace", message),
};
