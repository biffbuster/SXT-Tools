#!/usr/bin/env node
/**
 * @biffbuster/sxt-mcp — MCP server entry point.
 *
 * v0.0.1 SCAFFOLD: registers four tools and one resource. The resource
 * (proof_of_sql_foundations) returns real Markdown content. The four tools
 * register their schemas so MCP hosts can list them, but every handler throws
 * NotImplementedError. ZERO chain interaction is possible in this version.
 *
 * Phased rollout — see SAFETY.md.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import { loadConfig } from "./lib/config.js";

const VERSION = "0.1.0";
const config = loadConfig();

const server = new Server(
  { name: "@biffbuster/sxt-mcp", version: VERSION },
  { capabilities: { tools: {}, resources: {} } },
);

// ─── Tool registry ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "sxt.publish_dataset",
    description:
      "Publish a CSV file to Space and Time as a chain-secured table queryable with Proof of SQL. " +
      "Defaults to testnet; mainnet requires the double-gate (mainnet: true + " +
      "SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND). Idempotent — re-runs against existing namespace/table " +
      "skip the create step and proceed to insert. Requires PRIVATE_KEY in the host config.",
    schema: publishDatasetSchema,
    handler: publishDatasetHandler,
  },
  {
    name: "sxt.run_proven_query",
    description:
      "Run a SELECT against a published SXT table with proveExecution=true and return " +
      "the proof receipt. Off-chain via /v1/zkquery — no SXT or ETH spend, just an API quota tick. " +
      "Requires SXT_API_KEY in the host config.",
    schema: runProvenQuerySchema,
    handler: runProvenQueryHandler,
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
  },
] as const;

// ─── Tool list ──────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.schema),
  })),
}));

// ─── Tool dispatch ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  }

  if (config.debug) {
    process.stderr.write(`[sxt-mcp] ${name} called with ${JSON.stringify(args ?? {})}\n`);
  }

  try {
    const parsed = tool.schema.parse(args ?? {});
    // The cast is safe — each handler accepts its own parsed schema, and we just
    // matched the tool by name above. TypeScript can't follow the linkage through
    // the union, so we trust the runtime check.
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

// ─── Resources ──────────────────────────────────────────────────────────────

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

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[sxt-mcp] v${VERSION} ready on stdio. ` +
      `Tools: ${TOOLS.length} live. Resources: 1. ` +
      (config.allowMainnet
        ? "WARNING: mainnet gate is unlocked.\n"
        : "Mainnet gate is locked (default).\n"),
  );
}

main().catch((err) => {
  process.stderr.write(`[sxt-mcp] fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
