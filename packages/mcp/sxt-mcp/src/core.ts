/**
 * Transport-neutral MCP server factory.
 *
 * Takes the tool list as an argument and imports no tool modules itself, so
 * each entrypoint bundles only the tools it serves:
 *   - stdio (index.ts via server.ts): all tools.
 *   - HTTP, Node (http-app.ts) and Cloudflare Workers (worker.ts): the
 *     read-only catalog only (tools/catalog-read.ts). The write tools and their
 *     dependencies (@polkadot/api, ethers, child_process) are never loaded.
 *
 * Runs on Node 20+ and on Workers: it uses only Web-standard globals
 * (crypto.randomUUID) plus the MCP SDK and zod.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodTypeAny } from "zod";

import { logger, type LogFields } from "./lib/logger.js";
import type { ToolContext } from "./lib/context.js";
import { sanitizeError, ToolError } from "./lib/sanitize.js";

export const VERSION = "0.4.0";

export interface ToolDef {
  name: string;
  description: string;
  schema: ZodTypeAny;
  handler: (args: never, ctx: ToolContext) => Promise<unknown>;
  // MCP behavioural hints. ChatGPT enforces these when deciding whether to
  // ask the user to confirm a tool call; Claude treats them as advisory.
  // https://modelcontextprotocol.io/specification/server/tools#annotations
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
    idempotentHint: boolean;
  };
}

/** Tool-call limiter. Returns 0 if allowed, else milliseconds to wait. */
export interface CallLimiter {
  take(principal: string): number | Promise<number>;
}

export interface Resource {
  uri: string;
  mimeType: string;
  text: string;
}

export const FOUNDATIONS_RESOURCE_URI = "sxt://docs/proof-of-sql-foundations";

export interface BuildServerOptions {
  /**
   * "local" (default): stdio / loopback. Credentials come from the operator's
   * env and full upstream error detail is returned.
   * "hosted": network-exposed. Credentials must arrive with each request,
   * handlers may not touch the filesystem, and upstream error detail is
   * logged under the request id instead of returned.
   */
  surface?: "local" | "hosted";
  /**
   * Where SXT API keys may come from. Defaults to "env" for the local surface
   * and "request" for the hosted one. Local-mode HTTP (one operator, loopback
   * or static bearer) is hosted-surface with env credentials.
   */
  credentials?: "env" | "request";
  /** Per-principal tool-call limiter (hosted surface). */
  rateLimiter?: CallLimiter;
  /** Loads the proven-surface reference served as an MCP resource. */
  readFoundations: () => Promise<Resource>;
}

type Handler = (args: unknown, ctx: ToolContext) => Promise<unknown>;

export function buildMcpServer(tools: readonly ToolDef[], options: BuildServerOptions): Server {
  const surface = options.surface ?? "local";

  const server = new Server(
    { name: "@biffbuster/sxt-mcp", version: VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.schema, { target: "draft-7", io: "input" }) as Record<string, unknown> & { type: "object" },
      annotations: t.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const { name, arguments: args } = req.params;
    const requestId = crypto.randomUUID();
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      // Includes a tool hidden from this transport (the HTTP surface never
      // registers the write tools).
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }

    const authExtra = (extra.authInfo?.extra ?? {}) as { sxtApiKey?: string; principal?: string };
    const credentials = options.credentials ?? (surface === "hosted" ? "request" : "env");
    const principal = authExtra.principal ?? (credentials === "env" ? "operator" : undefined);
    const progressToken = req.params._meta?.progressToken;

    const ctx: ToolContext = {
      credentialSource: credentials,
      apiKey: authExtra.sxtApiKey,
      principal,
      requestId,
      allowFilesystem: surface === "local",
      signal: extra.signal,
      progress:
        progressToken === undefined
          ? undefined
          : async (progress, message) => {
              try {
                await extra.sendNotification({
                  method: "notifications/progress",
                  params: { progressToken, progress, message },
                });
              } catch {
                // client went away; the abort signal handles cancellation
              }
            },
    };

    const started = Date.now();
    const finish = (outcome: string, fields: LogFields = {}) =>
      logger.info("tool call", {
        requestId,
        tool: name,
        principal,
        outcome,
        ms: Date.now() - started,
        ...fields,
      });

    try {
      if (options.rateLimiter && principal) {
        const waitMs = await options.rateLimiter.take(principal);
        if (waitMs > 0) {
          throw new ToolError(
            "RATE_LIMITED",
            `Too many requests for this connection. Retry in ${Math.ceil(waitMs / 1000)}s.`,
            true,
          );
        }
      }
      logger.trace(`${name} args: ${JSON.stringify(args ?? {})}`, { requestId });
      const parsed = tool.schema.parse(args ?? {});
      const result = await (tool.handler as Handler)(parsed, ctx);
      finish("ok");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const e = sanitizeError(err);
      finish("error", { code: e.code, detail: e.detail, ...(e.queryId ? { queryId: e.queryId } : {}) });
      const body: Record<string, unknown> = {
        error: {
          code: e.code,
          message: e.message,
          retryable: e.retryable,
          requestId,
          ...(e.queryId ? { queryId: e.queryId } : {}),
        },
      };
      // Local callers own the credentials and the process, so they see full
      // upstream detail. Hosted callers get the request id; the detail is in
      // the server log.
      if (surface === "local" && e.detail) (body.error as Record<string, unknown>).detail = e.detail;
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: FOUNDATIONS_RESOURCE_URI,
        name: "Proof of SQL foundations",
        description:
          "The proven SQL surface — operators that compile to a HyperKZG proof and operators " +
          "that don't. Read this before drafting SQL for sxt.run_proven_query.",
        mimeType: "text/markdown",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri !== FOUNDATIONS_RESOURCE_URI) {
      throw new Error(`Unknown resource URI: ${req.params.uri}`);
    }
    return { contents: [await options.readFoundations()] };
  });

  return server;
}
