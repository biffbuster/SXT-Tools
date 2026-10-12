/**
 * Full tool set for the stdio entrypoint (index.ts): the read-only catalog
 * plus the write tools (publish, audit, deploy), which need a private key or
 * the local filesystem.
 *
 * HTTP entrypoints do not import this file. They build from core.ts with the
 * read-only catalog only (tools/catalog-read.ts), so the write tools and
 * their dependencies are never loaded on a network-exposed server.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { buildMcpServer, VERSION, type BuildServerOptions, type ToolDef } from "./core.js";
import { READ_ONLY_TOOLS, READ_ONLY_TOOL_NAMES } from "./tools/catalog-read.js";
import { publishDatasetSchema, publishDatasetHandler } from "./tools/publish-dataset.js";
import { auditContractSchema, auditContractHandler } from "./tools/audit-contract.js";
import { deployContractSchema, deployContractHandler } from "./tools/deploy-contract.js";
import { readFoundationsResource } from "./tools/proof-of-sql-foundations.js";

export { VERSION };

const WRITE_TOOLS = [
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
] as const satisfies readonly ToolDef[];

const ALL_TOOLS = [READ_ONLY_TOOLS[0], WRITE_TOOLS[0], ...READ_ONLY_TOOLS.slice(1), ...WRITE_TOOLS.slice(1)];

export type ToolName = (typeof ALL_TOOLS)[number]["name"];

export function buildServer(
  options: Omit<BuildServerOptions, "readFoundations"> & { allowedTools?: readonly string[] } = {},
): Server {
  const tools = options.allowedTools
    ? ALL_TOOLS.filter((t) => options.allowedTools!.includes(t.name))
    : ALL_TOOLS;
  return buildMcpServer(tools, { ...options, readFoundations: readFoundationsResource });
}

export const TOOL_COUNT = ALL_TOOLS.length;

/** Names of the tools any HTTP surface exposes. Defined by tools/catalog-read.ts. */
export const HTTP_READ_ONLY_TOOLS = READ_ONLY_TOOL_NAMES;
