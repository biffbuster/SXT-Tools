/**
 * Level-gated stderr logger.
 *
 * Levels (low → high verbosity): info | debug | trace.
 * Defaults to "info". Override with `MCP_DEBUG_LEVEL=debug|trace`.
 * Backward-compat: `SXT_MCP_DEBUG=1` maps to "debug".
 *
 * Formats: "text" (default, `[sxt-mcp:info] message`) or "json" (one object
 * per line, for log pipelines). Set `SXT_MCP_LOG_FORMAT=json`; the hosted
 * HTTP entrypoint defaults to json.
 *
 * All output goes to stderr so it doesn't corrupt the stdio MCP transport
 * (which speaks JSON-RPC on stdout).
 *
 * Redaction: emitted strings are scanned for known secret shapes (raw Ethereum
 * private keys, JWTs, and this server's own sealed tokens) and replaced before
 * write. Code must still never pass an SXT API key to the logger; log the
 * principal id from sealed.ts instead.
 */

export type LogLevel = "info" | "debug" | "trace" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | undefined | null>;

const ORDER: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, debug: 1, trace: 2 };

function resolveLevel(): "info" | "debug" | "trace" {
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
// Sealed tokens issued by this server (lib/sealed.ts).
const SEALED_PATTERN = /\bsxt_(client|consent|code|access|refresh)_[A-Za-z0-9_-]+/g;

export function redact(message: string): string {
  return message
    .replace(PRIVATE_KEY_PATTERN, "0x[REDACTED-PRIVATE-KEY]")
    .replace(JWT_PATTERN, "[REDACTED-JWT]")
    .replace(SEALED_PATTERN, "sxt_$1_[REDACTED]");
}

const CURRENT_LEVEL = resolveLevel();
let format: "text" | "json" = process.env.SXT_MCP_LOG_FORMAT === "json" ? "json" : "text";
let sink: (line: string) => void = (line) => process.stderr.write(line + "\n");

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (ORDER[level] > ORDER[CURRENT_LEVEL]) return;
  if (format === "json") {
    const out: Record<string, unknown> = { ts: new Date().toISOString(), level, msg: redact(message) };
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (v !== undefined) out[k] = typeof v === "string" ? redact(v) : v;
    }
    sink(JSON.stringify(out));
    return;
  }
  const suffix = fields
    ? " " +
      Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${typeof v === "string" ? redact(v) : v}`)
        .join(" ")
    : "";
  sink(`[sxt-mcp:${level}] ${redact(message)}${suffix}`);
}

export const logger = {
  level: CURRENT_LEVEL,
  /** Switch format at startup (the hosted entrypoint defaults to json). */
  setFormat: (f: "text" | "json") => {
    format = f;
  },
  /** Replace the output (Workers: console.log, which observability captures). */
  setSink: (fn: (line: string) => void) => {
    sink = fn;
  },
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  debug: (message: string, fields?: LogFields) => emit("debug", message, fields),
  trace: (message: string, fields?: LogFields) => emit("trace", message, fields),
};
