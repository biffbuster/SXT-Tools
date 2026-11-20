/**
 * Cloudflare Workers entrypoint (public mode only).
 *
 * Runs the same Express app as the Node binary (http-app.ts) through
 * Cloudflare's Node HTTP compatibility layer, so OAuth, consent, sealed
 * tokens, the read-only catalog and every defense layer are one code path on
 * both platforms. Two things differ, because a Worker has no filesystem:
 *   - The proven-surface reference is bundled as text at build time.
 *   - The SDK verifier is the build-time WASM extraction in worker-gen/
 *     (scripts/build-worker-verifier.mjs), aliased in wrangler.jsonc.
 *
 * Config comes from Worker vars and secrets via process.env (nodejs_compat):
 * SXT_MCP_PUBLIC_URL (var) and SXT_MCP_TOKEN_SECRET (secret) are required.
 * No SXT or wallet credential belongs in this Worker.
 */

import { httpServerHandler } from "cloudflare:node";
import foundationsText from "../../docs/proof-of-sql-foundations.md";

import { createHttpApp } from "../http-app.js";
import { FOUNDATIONS_RESOURCE_URI, type CallLimiter } from "../core.js";
import { loadConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";

const PORT = 8080;

type Handler = ReturnType<typeof httpServerHandler>;

interface Env {
  /** Cloudflare Rate Limiting binding (wrangler.jsonc "ratelimits"). Shared per location. */
  TOOL_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

/** Per-caller tool-call limit backed by the Workers Rate Limiting binding. */
function bindingLimiter(binding: NonNullable<Env["TOOL_LIMITER"]>): CallLimiter {
  return {
    async take(principal) {
      const { success } = await binding.limit({ key: principal });
      return success ? 0 : 10_000;
    },
  };
}
let handler: Handler | undefined;

/**
 * Built on the first request, not at module load: Workers forbid timers and
 * random values in global scope, and the SDK's OAuth rate limiters start a
 * timer when the router is constructed.
 */
function init(env: Env): Handler {
  logger.setFormat("json");
  logger.setSink((line) => console.log(line));
  const cfg = loadConfig().http;
  if (!cfg.publicUrl) {
    throw new Error("The Workers build runs in public mode only. Set the SXT_MCP_PUBLIC_URL var.");
  }
  const { app } = createHttpApp(cfg, {
    clientIpHeader: "cf-connecting-ip",
    // Without the binding, http-app falls back to an in-memory bucket per isolate.
    rateLimiter: env.TOOL_LIMITER ? bindingLimiter(env.TOOL_LIMITER) : undefined,
    readFoundations: async () => ({
      uri: FOUNDATIONS_RESOURCE_URI,
      mimeType: "text/markdown",
      text: foundationsText,
    }),
  });
  app.listen(PORT);
  return httpServerHandler({ port: PORT });
}

export default {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    handler ??= init(env as Env);
    return handler.fetch(request, env, ctx);
  },
};
