/**
 * The read-only tool catalog: the only tools any HTTP surface (Node or
 * Cloudflare Workers) registers. Each spends nothing but the caller's own
 * query credit (run_proven_query) or nothing at all (list_tables,
 * describe_table, get_proof_result, generate_proof_plan), needs no private
 * key, and touches no filesystem on the hosted surface.
 *
 * Adding a tool here exposes it to every hosted user. It must keep all three
 * properties above.
 */

import type { ToolDef } from "../core.js";
import {
  runProvenQuerySchema,
  runProvenQueryHandler,
  getProofResultSchema,
  getProofResultHandler,
} from "./run-proven-query.js";
import { generateProofPlanSchema, generateProofPlanHandler } from "./generate-proof-plan.js";
import {
  listTablesSchema,
  listTablesHandler,
  describeTableSchema,
  describeTableHandler,
} from "./catalog.js";

export const READ_ONLY_TOOLS = [
  {
    name: "sxt.list_tables",
    description:
      "Start here. Lists public tables on the SXT MAINNET catalog: curated Ethereum tables plus " +
      "every community table SXT users have published, with size and creation date. Paged: " +
      "pass search to filter by name, schema to list one namespace, and nextCursor for the next " +
      "page. Free: no query credit. Then call sxt.describe_table on a table to confirm it is " +
      "provable and get its columns.",
    schema: listTablesSchema,
    handler: listTablesHandler,
    annotations: {
      title: "List provable tables",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "sxt.describe_table",
    description:
      "Check whether a table can be proven and get its exact column names and types, live from " +
      "the prover's catalog, plus its size and owner when known. Works for any public table, " +
      "including tables other users published (PREFIX_<WALLET HEX>.TABLE). Call it before " +
      "writing SQL for sxt.run_proven_query. Free: no query credit.",
    schema: describeTableSchema,
    handler: describeTableHandler,
    annotations: {
      title: "Describe a provable table",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "sxt.run_proven_query",
    description:
      "Run a SELECT against any public SXT table with proveExecution=true and return " +
      "the proof receipt plus decoded rows. Off-chain via /v1/zkquery — no SXT or ETH spend, one " +
      "query credit on the caller's SXT account. The SQL is compiled by the free planner first, so " +
      "unsupported SQL is refused with a reason before anything is spent. Streams progress while " +
      "the prover works. A proof still running " +
      "after waitSeconds returns status \"pending\" with a queryId for sxt.get_proof_result, which " +
      "resumes without a new credit. Uses the connection's SXT API key (hosted) or SXT_API_KEY (local).",
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
    name: "sxt.get_proof_result",
    description:
      "Resume a Proof of SQL query that sxt.run_proven_query returned as status \"pending\". " +
      "Polls the prover for the given queryId, fetches the result, and verifies the proof locally. " +
      "Spends no query credit: the query was already submitted. Requires the same SXT API key " +
      "that submitted it.",
    schema: getProofResultSchema,
    handler: getProofResultHandler,
    annotations: {
      title: "Fetch a pending proof result",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "sxt.generate_proof_plan",
    description:
      "Compile SQL into an EVM proof plan via the SXT chain RPC (commitments_v1_evmProofPlan). " +
      "The returned hex blob is what a Solidity contract embeds as QUERY_PLAN and submits through " +
      "IQueryRouter.requestQuery — this is the bridge from a published table to an on-chain proof. " +
      "Supports parameterized plans ($1, $2) so one deployed contract serves any input. " +
      "Zero cost: no credentials, no chain write, no API quota.",
    schema: generateProofPlanSchema,
    handler: generateProofPlanHandler,
    annotations: {
      title: "Compile SQL to an EVM proof plan",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
] as const satisfies readonly ToolDef[];

export const READ_ONLY_TOOL_NAMES = READ_ONLY_TOOLS.map((t) => t.name);
