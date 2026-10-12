#!/usr/bin/env node
/**
 * @biffbuster/sxt-mcp — Streamable HTTP entrypoint.
 *
 * Starts the Express app from http-app.ts. Local mode (default) serves one
 * operator on loopback with their env credentials. Public mode
 * (SXT_MCP_PUBLIC_URL set) serves many users, each with their own SXT API
 * key over OAuth 2.1. See http-app.ts for the defense layers and SAFETY.md for
 * the operating rules.
 */

import { VERSION } from "./core.js";
import { READ_ONLY_TOOL_NAMES } from "./tools/catalog-read.js";
import { readFoundationsResource } from "./tools/proof-of-sql-foundations.js";
import { createHttpApp } from "./http-app.js";
import { loadConfig } from "./lib/config.js";
import { logger } from "./lib/logger.js";

/** In-flight proofs get this long to finish after SIGTERM before exit. */
const DRAIN_MS = Number(process.env.SXT_MCP_DRAIN_MS ?? 25_000);

async function main() {
  const config = loadConfig();
  const cfg = config.http;
  if (cfg.publicUrl && process.env.SXT_MCP_LOG_FORMAT === undefined) logger.setFormat("json");

  const { app, mode } = createHttpApp(cfg, { readFoundations: readFoundationsResource });

  const httpServer = app.listen(cfg.port, cfg.bindHost, () => {
    const where = cfg.publicUrl ? `${new URL("/mcp", cfg.publicUrl).href} (public)` : `http://${cfg.bindHost}:${cfg.port}/mcp`;
    logger.info(
      `v${VERSION} ready on ${where}. ` +
        `Tools exposed: ${READ_ONLY_TOOL_NAMES.length} (read-only). ` +
        (mode === "public"
          ? "Auth: OAuth 2.1, bring-your-own SXT key."
          : cfg.bearer
            ? "Bearer auth required."
            : "No auth (loopback only).") +
        " " +
        (config.allowMainnet ? "WARNING: mainnet gate is unlocked." : "Mainnet gate is locked (default)."),
      { version: VERSION, mode, port: cfg.port, bind: cfg.bindHost },
    );
  });
  // Proofs can take tens of seconds; keep sockets open past Node's defaults.
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 65_000;
  httpServer.keepAliveTimeout = 61_000;

  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      if (stopping) return;
      stopping = true;
      logger.info(`${sig} received; draining`, { drainMs: DRAIN_MS });
      httpServer.close(() => process.exit(0));
      setTimeout(() => process.exit(0), DRAIN_MS).unref();
    });
  }
}

main().catch((err) => {
  process.stderr.write(`[sxt-mcp:fatal] ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
