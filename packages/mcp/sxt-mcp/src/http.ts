#!/usr/bin/env node
/**
 * @biffbuster/sxt-mcp — Streamable HTTP entrypoint for ChatGPT-shaped clients.
 *
 * Narrowed surface: exposes ONLY `sxt.run_proven_query`. The publish, deploy,
 * and audit tools stay stdio-only — they need filesystem paths or a private
 * key, neither of which makes sense for a network-exposed connector.
 *
 * Defense layers, in order:
 *   1. Bind to loopback by default. Non-loopback bind requires explicit
 *      SXT_MCP_BIND_HOST AND a non-empty SXT_MCP_HTTP_BEARER.
 *   2. Host header allowlist (DNS rebinding defense).
 *   3. Origin header allowlist (same-origin OK; cross-origin requires
 *      SXT_MCP_ALLOWED_ORIGINS).
 *   4. Bearer token check (when SXT_MCP_HTTP_BEARER is set).
 *   5. MCP protocol layer — only `sxt.run_proven_query` is registered.
 *   6. selectNetwork() mainnet double-gate (same chokepoint as stdio path).
 *
 * The mainnet gate is upstream of the transport — there is no HTTP-only or
 * stdio-only bypass.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { buildServer, HTTP_READ_ONLY_TOOLS, VERSION } from "./server.js";
import { loadConfig, type HttpConfig } from "./lib/config.js";
import { logger } from "./lib/logger.js";

const SESSION_HEADER = "mcp-session-id";

// One transport instance per MCP session. Re-using one transport across
// sessions would cross-pollinate message history and SSE streams.
const transports = new Map<string, StreamableHTTPServerTransport>();

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Constant-time bearer comparison — avoids leaking length via timing. */
function bearerMatches(expected: string, presented: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * DNS-rebinding defense. The Host header on a legitimate request should be
 * a loopback literal or the explicitly-configured bind host. Anything else
 * suggests a browser tab being tricked into talking to us via a name that
 * resolves to loopback.
 */
function isHostAllowed(host: string | undefined, cfg: HttpConfig): boolean {
  if (!host) return false;
  const portStr = `:${cfg.port}`;
  const candidates = new Set<string>([
    `127.0.0.1${portStr}`,
    `localhost${portStr}`,
    `[::1]${portStr}`,
    `${cfg.bindHost}${portStr}`,
    "127.0.0.1",
    "localhost",
    "[::1]",
    cfg.bindHost,
  ]);
  return candidates.has(host.toLowerCase());
}

function isOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  cfg: HttpConfig,
): boolean {
  if (!origin) return true; // curl / native clients
  if (host) {
    const sameOrigin = [`http://${host}`, `https://${host}`];
    if (sameOrigin.includes(origin.toLowerCase())) return true;
  }
  return cfg.allowedOrigins.includes(origin);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: HttpConfig,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/mcp") {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  const host = req.headers.host;
  if (!isHostAllowed(host, cfg)) {
    logger.debug(`http: rejected host=${host}`);
    sendJson(res, 403, rpcError(null, -32000, "host not allowed"));
    return;
  }

  const origin = req.headers.origin as string | undefined;
  if (!isOriginAllowed(origin, host, cfg)) {
    logger.debug(`http: rejected origin=${origin}`);
    sendJson(res, 403, rpcError(null, -32000, "origin not allowed"));
    return;
  }

  if (cfg.bearer) {
    const auth = req.headers.authorization;
    const presented = auth && auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!presented || !bearerMatches(cfg.bearer, presented)) {
      logger.debug("http: bearer rejected");
      res.setHeader("WWW-Authenticate", 'Bearer realm="sxt-mcp"');
      sendJson(res, 401, rpcError(null, -32001, "unauthorized"));
      return;
    }
  }

  const sessionId = req.headers[SESSION_HEADER] as string | undefined;

  if (req.method === "POST") {
    const body = await readBody(req);
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (!sessionId && isInitializeRequest(body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
          logger.debug(`http: session ${id} opened`);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) {
          transports.delete(transport!.sessionId);
          logger.debug(`http: session ${transport!.sessionId} closed`);
        }
      };
      // Read-only surface: only `sxt.run_proven_query` is registered.
      const server = buildServer({ allowedTools: HTTP_READ_ONLY_TOOLS });
      await server.connect(transport);
    } else {
      sendJson(res, 400, rpcError(null, -32000, "missing or invalid session id"));
      return;
    }

    await transport!.handleRequest(req, res, body);
    return;
  }

  if (req.method === "GET" || req.method === "DELETE") {
    if (!sessionId || !transports.has(sessionId)) {
      sendJson(res, 400, rpcError(null, -32000, "missing or invalid session id"));
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
    return;
  }

  res.writeHead(405, { allow: "POST, GET, DELETE" });
  res.end();
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

async function main() {
  const config = loadConfig();
  const cfg = config.http;

  if ((cfg.bindHost === "0.0.0.0" || cfg.bindHost === "::") && !cfg.bindExplicit) {
    throw new Error(
      "Refusing to bind to 0.0.0.0 without explicit SXT_MCP_BIND_HOST. " +
        "Set SXT_MCP_BIND_HOST=0.0.0.0 to override.",
    );
  }

  // Non-loopback bind without a bearer is an unauthenticated public endpoint
  // calling /v1/zkquery on the server operator's API key. Refuse.
  if (!isLoopback(cfg.bindHost) && !cfg.bearer) {
    throw new Error(
      `Refusing to bind to non-loopback host ${cfg.bindHost} without ` +
        "SXT_MCP_HTTP_BEARER set. Set a bearer token to enable non-loopback bind.",
    );
  }

  const httpServer = createServer((req, res) => {
    handle(req, res, cfg).catch((err) => {
      logger.debug(`http: handler error: ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) {
        sendJson(res, 500, rpcError(null, -32603, "internal error"));
      } else {
        try {
          res.end();
        } catch {
          // socket already closed
        }
      }
    });
  });

  httpServer.listen(cfg.port, cfg.bindHost, () => {
    logger.info(
      `v${VERSION} ready on http://${cfg.bindHost}:${cfg.port}/mcp. ` +
        `Tools exposed: ${HTTP_READ_ONLY_TOOLS.length} (read-only). ` +
        (cfg.bearer ? "Bearer auth required." : "No auth (loopback only).") +
        " " +
        (config.allowMainnet
          ? "WARNING: mainnet gate is unlocked."
          : "Mainnet gate is locked (default)."),
    );
    logger.debug(`log level: ${logger.level}`);
    if (cfg.allowedOrigins.length > 0) {
      logger.debug(`allowed cross-origins: ${cfg.allowedOrigins.join(", ")}`);
    }
  });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      httpServer.close(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  process.stderr.write(`[sxt-mcp:fatal] ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
