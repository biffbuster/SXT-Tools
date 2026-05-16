/**
 * Shared MCP server factory. Both `index.ts` (stdio) and `http.ts` (Streamable
 * HTTP) call `buildServer()` to construct an identically-wired `Server`
 * instance — same tool registry, same schemas, same handlers.
 *
 * The `allowedTools` filter exists so transports can expose narrower surfaces.
 * stdio (Claude Code / build-from-source) sees all four tools. HTTP (ChatGPT
 * connector) sees ONLY `sxt.run_proven_query` — the read-only proof-query
 * path that needs no private key. See `project_mcp_transport_split` memory.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  publishDatasetSchema,
  publishDatasetHandler,
} from "./tools/publish-dataset.js";
import {
  runProvenQuerySchema,
  runProvenQueryHandler,
} from "./tools/run-proven-query.js";
import {
  auditContractSchema,
  auditContractHandler,
} from "./tools/audit-contract.js";
import {
  deployContractSchema,
  deployContractHandler,
} from "./tools/deploy-contract.js";
import {
  FOUNDATIONS_RESOURCE_URI,
  readFoundationsResource,
} from "./tools/proof-of-sql-foundations.js";
import { logger } from "./lib/logger.js";

export const VERSION = "0.1.0";

// MCP behavioural hints. ChatGPT enforces these when deciding whether to ask
// the user to confirm a tool call; Claude treats them as advisory. Spec:
// https://modelcontextprotocol.io/specification/server/tools#annotations
const ALL_TOOLS = [
  {
    name: "sxt.publish_dataset",
    description:
      "Publish a CSV file to Space and Time as a chain-secured table queryable with Proof of SQL. " +
      "Defaults to testnet; mainnet requires the double-gate (mainnet: true + " +
      "SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND). Idempotent — re-runs against existing namespace/table " +
      "skip the create step and proceed to insert. Requires PRIVATE_KEY in the host config.",
    schema: publishDatasetSchema,
    handler: publishDatasetHandler,
    annotations: {
      title: "Publish dataset to SXT chain",
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: false,
    },
  },
  {
    name: "sxt.run_proven_query",
    description:
      "Run a SELECT against a published SXT table with proveExecution=true and return " +
      "the proof receipt. Off-chain via /v1/zkquery — no SXT or ETH spend, just an API quota tick. " +
      "Requires SXT_API_KEY in the host config.",
    schema: runProvenQuerySchema,
    handler: runProvenQueryHandler,
    annotations: {
      title: "Run a proof-of-SQL query",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "sxt.audit_contract",
    description:
      "Local Solidity audit: spawns `forge build` and optionally `slither` against a project " +
      "root or .sol file, computes SHA-256 hashes of every source file (consumed by future " +
      "cross-reference tools), and returns a structured report plus optional Markdown render. " +
      "Pure local execution — no chain interaction, no API calls, no credentials read.",
    schema: auditContractSchema,
    handler: auditContractHandler,
    annotations: {
      title: "Audit Solidity contract locally",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "sxt.deploy_contract",
    description:
      "Deploy a Solidity contract via ethers ContractFactory from a forge build artifact. " +
      "Sepolia by default; Base / Ethereum mainnet require the double-gate. Idempotent via " +
      ".deploy-state.json — refuses redeploy when the prior address still has code. Requires " +
      "PRIVATE_KEY in the host config.",
    schema: deployContractSchema,
    handler: deployContractHandler,
    annotations: {
      title: "Deploy contract to EVM chain",
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
] as const;

export type ToolName = (typeof ALL_TOOLS)[number]["name"];

export interface BuildServerOptions {
  /** Restrict registered tools to this allowlist. Default: all tools. */
  allowedTools?: readonly ToolName[];
}

export function buildServer(options: BuildServerOptions = {}): Server {
  const tools = options.allowedTools
    ? ALL_TOOLS.filter((t) => options.allowedTools!.includes(t.name))
    : ALL_TOOLS;

  const server = new Server(
    { name: "@biffbuster/sxt-mcp", version: VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema),
      annotations: t.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      // Includes the case where a transport-allowed tool name doesn't match
      // any tool, and the case where a hidden tool is invoked over a narrowed
      // transport (HTTP).
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }

    logger.debug(`${name} called`);
    logger.trace(`${name} args: ${JSON.stringify(args ?? {})}`);

    try {
      const parsed = tool.schema.parse(args ?? {});
      const result = await (tool.handler as (a: unknown) => Promise<unknown>)(parsed);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
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
    const resource = await readFoundationsResource();
    return { contents: [resource] };
  });

  return server;
}

export const TOOL_COUNT = ALL_TOOLS.length;

/** Read-only allowlist for the HTTP (ChatGPT) transport. */
export const HTTP_READ_ONLY_TOOLS = ["sxt.run_proven_query"] as const satisfies readonly ToolName[];
