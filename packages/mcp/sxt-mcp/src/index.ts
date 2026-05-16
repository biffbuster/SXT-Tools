#!/usr/bin/env node
/**
 * @biffbuster/sxt-mcp — stdio entrypoint.
 *
 * Thin transport wrapper. All tool logic lives in src/server.ts via
 * buildServer() so the HTTP entrypoint (src/http.ts) shares identical
 * handlers. See SAFETY.md for the phased-rollout and double-gate rules.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildServer, TOOL_COUNT, VERSION } from "./server.js";
import { loadConfig } from "./lib/config.js";
import { logger } from "./lib/logger.js";

async function main() {
  const config = loadConfig();
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(
    `v${VERSION} ready on stdio. ` +
      `Tools: ${TOOL_COUNT} live. Resources: 1. ` +
      (config.allowMainnet
        ? "WARNING: mainnet gate is unlocked."
        : "Mainnet gate is locked (default)."),
  );
  logger.debug(`log level: ${logger.level}`);
}

main().catch((err) => {
  // Fatal path bypasses the logger — we want this on stderr unconditionally
  // since the process is about to exit.
  process.stderr.write(`[sxt-mcp:fatal] ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
