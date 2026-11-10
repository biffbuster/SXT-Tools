/**
 * sxt.list_tables and sxt.describe_table: discover what can be proven.
 *
 * Both read the chain catalog the prover executes against (mainnet, or
 * SXT_RPC_HTTP), through `commitments_v1_evmProofPlan`. Compiling
 * `SELECT * FROM <table>` succeeds only for tables with HyperKZG commitments,
 * and the returned plan encodes every column's name and type, so one call
 * answers both "can this be proven?" and "what are its columns?".
 *
 * Cost: none. Public JSON-RPC, no credentials, no chain write, no API quota.
 * Like run_proven_query, this reads the single catalog the prover uses, so the
 * mainnet gate does not apply: nothing is written or spent.
 */

import { z } from "zod";
import { rpcFetch } from "../lib/chain-rpc.js";
import { ToolError, UpstreamError } from "../lib/sanitize.js";

const CATALOG_RPC = process.env.SXT_RPC_HTTP ?? "https://rpc.mainnet.sxt.network/";
const CACHE_TTL_MS = 10 * 60_000;

/** Chain error for a table with no commitments (or no such table). */
const NOT_COMMITTED = 254018;

interface KnownTable {
  table: string;
  description: string;
  examples: string[];
}

/**
 * Public tables known to prove end to end. The chain cannot enumerate
 * namespaces cheaply, so this list is curated and each entry is checked live.
 */
const KNOWN_TABLES: readonly KnownTable[] = [
  {
    table: "ETHEREUM.BLOCKS",
    description:
      "Ethereum mainnet blocks: number, hash, timestamp, gas, miner, state and transaction roots.",
    examples: [
      "SELECT BLOCK_NUMBER, TRANSACTION_COUNT, SIZE FROM ETHEREUM.BLOCKS WHERE BLOCK_NUMBER = 20000000",
      "SELECT BLOCK_NUMBER, TRANSACTION_COUNT FROM ETHEREUM.BLOCKS WHERE BLOCK_NUMBER >= 20000000 AND BLOCK_NUMBER < 20000010",
    ],
  },
  {
    table: "ETHEREUM.TRANSACTIONS",
    description:
      "Ethereum mainnet transactions: hash, block, index, sender, recipient, fee and timestamp.",
    examples: [
      "SELECT BLOCK_NUMBER, TRANSACTION_INDEX, GAS, RECEIPT_STATUS FROM ETHEREUM.TRANSACTIONS WHERE BLOCK_NUMBER = 20000000",
    ],
  },
  {
    table: "MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS",
    description:
      "Demo table published with sxt-tools from a CSV (one VARCHAR column). Shows how any " +
      "user-published table is addressed: PREFIX_<WALLET HEX>.TABLE.",
    examples: ["SELECT STAKER FROM MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS"],
  },
];

const TYPE_NAMES: Record<number, string> = {
  0: "BOOLEAN",
  2: "TINYINT",
  3: "SMALLINT",
  4: "INT",
  5: "BIGINT",
  7: "VARCHAR",
  8: "DECIMAL",
  9: "TIMESTAMP",
  10: "SCALAR",
  11: "VARBINARY",
};

export interface Column {
  name: string;
  type: string;
}

/**
 * Reads the column list from the head of an EVM proof plan: table names, then
 * per column its table index, name and data type. Layout and type ids follow
 * sxt-proof-of-sql solidity/src/base (Constants.sol, DataType.presl).
 */
export function decodePlanColumns(hex: string): Column[] {
  const buf = hex.startsWith("0x") ? hex.slice(2) : hex;
  let pos = 0;
  const take = (bytes: number) => {
    if (pos + bytes * 2 > buf.length) throw new Error("proof plan ended early");
    const out = buf.slice(pos, pos + bytes * 2);
    pos += bytes * 2;
    return out;
  };
  const u64 = () => Number(BigInt("0x" + take(8)));
  const u32 = () => parseInt(take(4), 16);
  const u8 = () => parseInt(take(1), 16);
  const text = () => {
    const len = u64();
    if (len > 1024) throw new Error("proof plan name length out of range");
    const bytes = take(len).match(/../g) ?? [];
    return new TextDecoder().decode(Uint8Array.from(bytes, (b) => parseInt(b, 16)));
  };

  const tableCount = u64();
  for (let i = 0; i < tableCount; i++) text();
  const columnCount = u64();
  if (columnCount > 4096) throw new Error("proof plan column count out of range");

  const columns: Column[] = [];
  for (let i = 0; i < columnCount; i++) {
    u64(); // table index
    const name = text();
    const id = u32();
    let type = TYPE_NAMES[id];
    if (!type) throw new Error(`unknown column type id ${id}`);
    if (id === 8) {
      const precision = u8();
      const scale = (u8() << 24) >> 24;
      type = `DECIMAL(${precision},${scale})`;
    } else if (id === 9) {
      take(8); // time unit + timezone
    }
    columns.push({ name, type });
  }
  return columns;
}

interface RpcResponse {
  result?: { proofPlan?: string; at?: string };
  error?: { message?: string; code?: number };
}

export interface TableDescription {
  table: string;
  columns: Column[];
  chainStateAt: string | null;
}

// Holds the in-flight promise, not just the result, so a burst of callers on a
// cold cache shares one RPC call per table instead of stampeding the chain.
const cache = new Map<string, { at: number; value: Promise<TableDescription> }>();

/** Describes `table` from the live catalog. Throws TABLE_NOT_PROVABLE if it has no commitments. */
export function describe(table: string): Promise<TableDescription> {
  const hit = cache.get(table);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = fetchDescription(table);
  cache.set(table, { at: Date.now(), value });
  value.catch(() => cache.delete(table));
  return value;
}

async function fetchDescription(table: string): Promise<TableDescription> {
  const res = await rpcFetch(CATALOG_RPC, {
    jsonrpc: "2.0",
    id: 1,
    method: "commitments_v1_evmProofPlan",
    params: { query: `SELECT * FROM ${table}` },
  });
  let json: RpcResponse;
  try {
    json = (await res.json()) as RpcResponse;
  } catch {
    throw new UpstreamError("Chain RPC", `${CATALOG_RPC} returned a non-JSON response (HTTP ${res.status}).`);
  }

  if (json.error?.code === NOT_COMMITTED) {
    throw new ToolError(
      "TABLE_NOT_PROVABLE",
      `${table} is not provable: it does not exist in the prover's catalog or has no proof ` +
        "commitments yet. Check the PREFIX.TABLE spelling (user tables end with the publishing " +
        "wallet's hex address), or call sxt.list_tables for tables that prove today.",
    );
  }
  if (json.error) {
    throw new UpstreamError("Chain RPC", `commitments_v1_evmProofPlan failed: ${json.error.message ?? "unknown error"}`);
  }
  const plan = json.result?.proofPlan;
  if (!plan) throw new UpstreamError("Chain RPC", `no proofPlan in the response from ${CATALOG_RPC}`);

  let columns: Column[];
  try {
    columns = decodePlanColumns(plan);
  } catch (err) {
    throw new UpstreamError("Chain RPC", `could not read columns from the proof plan: ${(err as Error).message}`);
  }
  return { table, columns, chainStateAt: json.result?.at ?? null };
}

export const describeTableSchema = z
  .object({
    table: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/, "Must be PREFIX.TABLE")
      .transform((s) => s.toUpperCase())
      .describe(
        "Fully-qualified table, e.g. ETHEREUM.TRANSACTIONS or a table you published " +
          "(MY_PREFIX_<WALLET HEX>.MY_TABLE). Case-insensitive.",
      ),
  })
  .strict();

/** How to write a literal for each column type present, so agents get comparisons right. */
function literalNotes(columns: Column[]): string[] {
  const has = (prefix: string) => columns.some((c) => c.type.startsWith(prefix));
  const notes: string[] = [];
  if (has("VARCHAR")) notes.push("VARCHAR: single-quoted string, e.g. NAME = 'alice'.");
  if (has("VARBINARY")) {
    notes.push(
      "VARBINARY (hashes, addresses): hex literal, X'd8da6bf2...' or 0xd8da6bf2... unquoted. A quoted " +
        "'0x...' string compiles to a different plan and is not a byte comparison.",
    );
  }
  // Checked against the live planner on 2026-11-10: any WHERE comparison on
  // these fails to compile.
  if (has("DECIMAL") || has("TIMESTAMP")) {
    notes.push(
      "DECIMAL and TIMESTAMP columns can be selected but not compared in WHERE. Filter on BIGINT, " +
        "INT, VARCHAR or VARBINARY columns instead, e.g. a BLOCK_NUMBER range.",
    );
  }
  return notes;
}

export async function describeTableHandler(args: z.infer<typeof describeTableSchema>) {
  const d = await describe(args.table);
  return {
    ...d,
    provable: true,
    exampleSql: `SELECT ${d.columns.slice(0, 3).map((c) => c.name).join(", ")} FROM ${d.table}`,
    notes: [
      "Use these exact column names (UPPERCASE) in sxt.run_proven_query.",
      "Select rows with a WHERE filter. Aggregates (COUNT, SUM, AVG, MIN, MAX) are refused: the prover fails on them today.",
      ...literalNotes(d.columns),
      "Read sxt://docs/proof-of-sql-foundations for the SQL that can be proven.",
    ],
  };
}

export const listTablesSchema = z
  .object({
    search: z
      .string()
      .max(100)
      .optional()
      .describe("Optional case-insensitive filter over table names and descriptions, e.g. \"transactions\"."),
  })
  .strict();

export async function listTablesHandler(args: z.infer<typeof listTablesSchema>) {
  const needle = args.search?.toLowerCase();
  const matches = KNOWN_TABLES.filter(
    (t) => !needle || t.table.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle),
  );

  const tables = await Promise.all(
    matches.map(async (t) => {
      try {
        const d = await describe(t.table);
        return { ...t, provable: true, columns: d.columns };
      } catch (err) {
        if (err instanceof ToolError && err.code === "TABLE_NOT_PROVABLE") {
          return { ...t, provable: false, columns: [] };
        }
        return { ...t, provable: null, columns: [], note: "Live check failed; retry or call sxt.describe_table." };
      }
    }),
  );

  return {
    catalog: "MAINNET",
    tables,
    notes: [
      "This is the curated public surface, checked live. It is not every table in SXT.",
      "Tables you publish yourself are provable too: call sxt.describe_table with their PREFIX.TABLE.",
      "Other ETHEREUM.* and BASE.* tables shown in SXT Studio are indexed but not yet provable.",
    ],
  };
}
