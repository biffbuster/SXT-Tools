/**
 * Express app for the Streamable HTTP transport. Built by `createHttpApp()` so
 * the listener (http.ts) and the test suite share one construction path.
 *
 * Two modes, chosen by SXT_MCP_PUBLIC_URL:
 *
 * LOCAL (unset). One operator, the operator's own SXT key from env.
 *   1. Loopback bind by default; non-loopback requires SXT_MCP_HTTP_BEARER.
 *   2. Host allowlist (DNS-rebinding defense) and Origin allowlist.
 *   3. Optional static bearer, constant-time compare.
 *
 * PUBLIC (set to the https origin the server is reached at). Many users,
 * bring-your-own key. The operator's SXT key is never used for a caller.
 *   1. OAuth 2.1 authorization server from the MCP SDK (`mcpAuthRouter`):
 *      protected-resource + AS metadata, dynamic client registration, PKCE,
 *      token, revocation. Tokens are sealed (lib/sealed.ts), so no database.
 *   2. Consent page: the user enters their SXT API key; it is checked with
 *      the free /auth/apikey exchange before any token is issued.
 *   3. `X-SXT-API-Key` header as an alternative for headless agents.
 *   4. Host allowlist pinned to the public URL's host.
 *   5. Per-caller rate limit on tool calls.
 *
 * Both modes:
 *   - Stateless MCP transport: a fresh Server + transport per POST, so any
 *     instance can serve any request and no session map exists to scale.
 *   - Read-only tool catalog only (tools/catalog-read.ts); the write tools
 *     are not imported, so they cannot be reached or loaded.
 *   - `selectNetwork()` mainnet double-gate, same as stdio.
 *   - /healthz and /readyz answer before host checks, for platform probes.
 */

import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";

import { buildMcpServer, VERSION, type CallLimiter, type Resource } from "./core.js";
import { READ_ONLY_TOOLS, READ_ONLY_TOOL_NAMES } from "./tools/catalog-read.js";
import type { HttpConfig } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { RateLimiter } from "./lib/rate-limit.js";
import { Sealer, deriveKey, nowSeconds, principalId } from "./lib/sealed.js";
import { looksLikeApiKey, validateApiKey, type KeyValidator } from "./lib/sxt-auth.js";
import { SCOPE, SxtOAuthProvider } from "./auth/provider.js";

export const MCP_PATH = "/mcp";
export const CONSENT_PATH = "/oauth/consent";
export const KEY_HEADER = "x-sxt-api-key";

export interface HttpAppDeps {
  /** Override the SXT key check (tests). Defaults to the live /auth/apikey exchange. */
  validateKey?: KeyValidator;
  /** Loads the proven-surface reference. Node reads it from disk; Workers bundle it. */
  readFoundations: () => Promise<Resource>;
  /** Tool-call limiter. Defaults to an in-memory token bucket per instance. */
  rateLimiter?: CallLimiter;
  /**
   * Header an edge sets to the true client IP (Cloudflare: cf-connecting-ip).
   * When set, it replaces any client-sent X-Forwarded-For and becomes the IP
   * the OAuth endpoint rate limits key on. Workers have no socket address, so
   * without this every caller would share one bucket.
   */
  clientIpHeader?: string;
}

export interface HttpApp {
  app: express.Express;
  mode: "local" | "public";
  /** The OAuth provider in public mode (exposed for tests). */
  provider?: SxtOAuthProvider;
}

function rpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", id: null, error: { code, message } });
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Constant-time bearer comparison: avoids leaking length via timing. */
function bearerMatches(expected: string, presented: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function allowedHosts(cfg: HttpConfig): Set<string> {
  if (cfg.publicUrl) {
    // Behind a TLS terminator the Host is the public host, with or without port.
    return new Set([cfg.publicUrl.host.toLowerCase(), cfg.publicUrl.hostname.toLowerCase()]);
  }
  const p = `:${cfg.port}`;
  return new Set(
    ["127.0.0.1", "localhost", "[::1]", cfg.bindHost].flatMap((h) => [h, `${h}${p}`]),
  );
}

function originAllowed(origin: string | undefined, host: string | undefined, cfg: HttpConfig): boolean {
  if (!origin) return true; // native clients and curl send no Origin
  const o = origin.toLowerCase();
  if (host && (o === `http://${host}` || o === `https://${host}`)) return true;
  if (cfg.publicUrl && o === cfg.publicUrl.origin.toLowerCase()) return true;
  return cfg.allowedOrigins.includes(origin);
}

/** Throws on unsafe configurations so a misconfigured server never starts. */
export function assertStartable(cfg: HttpConfig): void {
  if ((cfg.bindHost === "0.0.0.0" || cfg.bindHost === "::") && !cfg.bindExplicit) {
    throw new Error(
      "Refusing to bind to 0.0.0.0 without explicit SXT_MCP_BIND_HOST. Set SXT_MCP_BIND_HOST=0.0.0.0 to override.",
    );
  }
  if (cfg.publicUrl) {
    if (!cfg.tokenSecret) {
      throw new Error(
        "Public mode (SXT_MCP_PUBLIC_URL) requires SXT_MCP_TOKEN_SECRET (at least 32 random characters). " +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
      );
    }
    if (cfg.bearer) {
      throw new Error(
        "SXT_MCP_HTTP_BEARER is a local-mode setting and cannot be combined with SXT_MCP_PUBLIC_URL. " +
          "Public mode authenticates every caller with OAuth or their own X-SXT-API-Key.",
      );
    }
    return;
  }
  // Local mode, non-loopback: an unauthenticated endpoint would spend the
  // operator's SXT key for anyone who can reach it.
  if (!isLoopback(cfg.bindHost) && !cfg.bearer) {
    throw new Error(
      `Refusing to bind to non-loopback host ${cfg.bindHost} without SXT_MCP_HTTP_BEARER set. ` +
        "Set a bearer token, or run in public mode (SXT_MCP_PUBLIC_URL) so callers bring their own key.",
    );
  }
}

export function createHttpApp(cfg: HttpConfig, deps: HttpAppDeps): HttpApp {
  assertStartable(cfg);
  const mode = cfg.publicUrl ? "public" : "local";
  const app = express();
  app.disable("x-powered-by");
  if (deps.clientIpHeader) {
    const header = deps.clientIpHeader.toLowerCase();
    app.set("trust proxy", 1);
    app.use((req, _res, next) => {
      const ip = req.headers[header];
      // Overwrite, never append: a client-sent X-Forwarded-For is not trusted.
      req.headers["x-forwarded-for"] = typeof ip === "string" && ip ? ip : "0.0.0.0";
      next();
    });
  } else if (cfg.trustProxy > 0) {
    app.set("trust proxy", cfg.trustProxy);
  }

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  // Probes come from the platform with internal Host headers; answer them
  // before the host check. They expose nothing but liveness and the version.
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", version: VERSION, mode });
  });
  app.get("/readyz", (_req, res) => {
    res.json({ status: "ready", version: VERSION, mode, tools: READ_ONLY_TOOL_NAMES });
  });

  const hosts = allowedHosts(cfg);
  app.use((req, res, next) => {
    const host = req.headers.host?.toLowerCase();
    if (!host || !hosts.has(host)) {
      logger.debug("http: rejected host", { host });
      rpcError(res, 403, -32000, "host not allowed");
      return;
    }
    if (!originAllowed(req.headers.origin, host, cfg)) {
      logger.debug("http: rejected origin", { origin: req.headers.origin });
      rpcError(res, 403, -32000, "origin not allowed");
      return;
    }
    next();
  });

  let provider: SxtOAuthProvider | undefined;
  let authenticate: (req: Request, res: Response, next: NextFunction) => void;

  if (cfg.publicUrl) {
    const sealer = new Sealer(
      deriveKey(cfg.tokenSecret!, 1),
      cfg.tokenSecretPrevious ? [deriveKey(cfg.tokenSecretPrevious, 0)] : [],
    );
    const resourceUrl = new URL(MCP_PATH, cfg.publicUrl);
    const validateKey = deps.validateKey ?? validateApiKey;
    provider = new SxtOAuthProvider({ sealer, validateKey, resourceUrl, consentPath: CONSENT_PATH });

    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl: cfg.publicUrl,
        resourceServerUrl: resourceUrl,
        scopesSupported: [SCOPE],
        resourceName: "Space and Time Proof of SQL",
      }),
    );

    const p = provider;
    app.post(CONSENT_PATH, express.urlencoded({ extended: false, limit: "16kb" }), (req, res, next) => {
      p.completeConsent(req.body ?? {}, res).catch(next);
    });

    const bearer = requireBearerAuth({
      verifier: provider,
      requiredScopes: [SCOPE],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
    });

    authenticate = (req, res, next) => {
      const headerKey = req.headers[KEY_HEADER];
      if (cfg.allowKeyHeader && typeof headerKey === "string" && headerKey.length > 0) {
        if (!looksLikeApiKey(headerKey)) {
          rpcError(res, 401, -32001, `${KEY_HEADER} does not look like an SXT API key`);
          return;
        }
        // Not pre-validated here: the key is checked by SXT on first use, and
        // a rejected key comes back as SXT_KEY_INVALID from the tool.
        req.auth = {
          token: "header",
          clientId: "x-sxt-api-key",
          scopes: [SCOPE],
          expiresAt: nowSeconds() + 60,
          extra: { sxtApiKey: headerKey, principal: principalId(headerKey) },
        };
        next();
        return;
      }
      bearer(req, res, next);
    };
  } else {
    authenticate = (req, res, next) => {
      if (!cfg.bearer) return next();
      const auth = req.headers.authorization;
      const presented = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!presented || !bearerMatches(cfg.bearer, presented)) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="sxt-mcp"');
        rpcError(res, 401, -32001, "unauthorized");
        return;
      }
      next();
    };
  }

  const rateLimiter = deps.rateLimiter ?? new RateLimiter(cfg.rateLimitPerMin);

  app.post(MCP_PATH, express.json({ limit: "256kb" }), authenticate, async (req, res) => {
    const server = buildMcpServer(READ_ONLY_TOOLS, {
      surface: "hosted",
      credentials: mode === "public" ? "request" : "env",
      rateLimiter,
      readFoundations: deps.readFoundations,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Stateless transport: no standalone SSE stream and no session to delete.
  app.all(MCP_PATH, (_req, res) => {
    res.setHeader("Allow", "POST");
    rpcError(res, 405, -32000, "method not allowed; this server is stateless, use POST");
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("http: unhandled error", { detail: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) rpcError(res, 500, -32603, "internal error");
    else res.end();
  });

  return { app, mode, provider };
}
