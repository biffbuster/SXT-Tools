/**
 * sxt.list_tables and sxt.describe_table: discover what can be proven.
 *
 * describe_table reads the chain catalog the prover executes against
 * (mainnet, or SXT_RPC_HTTP) through `commitments_v1_evmProofPlan`. Compiling
 * `SELECT * FROM <table>` succeeds only for tables with HyperKZG commitments,
 * and the returned plan encodes every column's name and type, so one call
 * answers both "can this be proven?" and "what are its columns?".
 *
 * list_tables pages through every public community table on MAINNET via the
 * MakeInfinite discovery API (lib/discovery.ts), with the caller's key. With
 * no key (local stdio without SXT_API_KEY) it falls back to the curated list.
 *
 * Cost: none. Public JSON-RPC and discovery reads; no chain write, no query
 * credit. Like run_proven_query, this reads the single catalog the prover
 * uses, so the mainnet gate does not apply: nothing is written or spent.
 */

import { z } from "zod";
import { rpcFetch } from "../lib/chain-rpc.js";
import { ToolError, UpstreamError } from "../lib/sanitize.js";
import { logger } from "../lib/logger.js";
import type { ToolContext } from "../lib/context.js";
import { optionalApiKey, proverClient } from "../lib/prover-session.js";
import {
  findTable,
  isSchemaCached,
  listSchemaTables,
  listSchemas,
  type Getter,
  type PublicTable,
} from "../lib/discovery.js";

const CATALOG_RPC = process.env.SXT_RPC_HTTP ?? "https://rpc.mainnet.sxt.network/";
const CACHE_TTL_MS = 10 * 60_000;

/** Chain error for a table with no commitments (or no such table). */
export const NOT_COMMITTED = 254018;

/** Upper bound on uncached schemas one list_tables call fetches, so one call never bursts the API. */
const MAX_SCHEMA_FETCHES = 12;
const FETCH_CONCURRENCY = 4;

interface KnownTable {
  table: string;
  description: string;
  examples: string[];
}

/**
 * SXT-owned tables known to prove end to end. Discovery lists ~40 ETHEREUM.*
 * tables, but most have no commitments, so the SXT-owned part of the catalog
 * stays curated and each entry is checked live.
 *
 * ETHEREUM.TRANSACTIONS is left out on purpose: it plans, but proofs against
 * it fail at execution and took the prover's planner down for ~9 minutes on
 * 2026-11-10 and 2026-11-16. Restore it when SXT confirms a fix.
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
    table: "MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS",
    description:
      "Demo table published with sxt-tools from a CSV (one VARCHAR column). Shows how any " +
      "user-published table is addressed: PREFIX_<WALLET HEX>.TABLE.",
    examples: ["SELECT STAKER FROM MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS"],
  },
];

/** Tables that plan but currently fail at the prover. run_proven_query warns before submitting. */
export const UNSTABLE_TABLES: Readonly<Record<string, string>> = {
  "ETHEREUM.TRANSACTIONS":
    "Proofs against ETHEREUM.TRANSACTIONS currently fail at the SXT prover (\"Query execution failed\") " +
    "and have briefly taken the prover offline for every user. Use ETHEREUM.BLOCKS or a community table.",
};

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

/** Columns a WHERE clause can compare (DECIMAL and TIMESTAMP cannot, checked 2026-11-10). */
function filterable(c: Column): boolean {
  return !c.type.startsWith("DECIMAL") && c.type !== "TIMESTAMP" && c.type !== "SCALAR";
}

/** A query that proves as written: bounded, and filtered when a filterable column exists. */
function exampleSql(d: TableDescription): string {
  const cols = d.columns.slice(0, 3).map((c) => c.name).join(", ");
  return `SELECT ${cols} FROM ${d.table} LIMIT 10`;
}

export const AGGREGATE_NOTE =
  "Aggregates prove only with GROUP BY on one non-VARCHAR column, e.g. SELECT AREA, COUNT(*) AS N FROM t " +
  "GROUP BY AREA (verified 2026-11-17). Whole-table aggregates (COUNT(*) with no GROUP BY) fail at the " +
  "prover and are refused; GROUP BY on a VARCHAR column does not compile.";

function discoveryGetter(ctx: ToolContext): Getter | null {
  const apiKey = optionalApiKey(ctx);
  if (!apiKey) return null;
  const client = proverClient(apiKey);
  return (path) => client.getJson(path, ctx.signal);
}

export async function describeTableHandler(args: z.infer<typeof describeTableSchema>, ctx: ToolContext = {}) {
  const d = await describe(args.table);

  // Size and ownership are a nice-to-have: never fail the describe over them.
  let catalog: PublicTable | null = null;
  const get = discoveryGetter(ctx);
  if (get) {
    try {
      catalog = await findTable(get, d.table);
    } catch (err) {
      logger.debug(`discovery lookup for ${d.table} failed: ${(err as Error).message}`);
    }
  }

  const filterCol = d.columns.find(filterable);
  return {
    ...d,
    provable: true,
    ...(catalog
      ? { owner: catalog.owner, size: catalog.size, created: catalog.created, immutable: catalog.immutable }
      : {}),
    ...(UNSTABLE_TABLES[d.table] ? { warning: UNSTABLE_TABLES[d.table] } : {}),
    exampleSql: exampleSql(d),
    notes: [
      "Use these exact column names (UPPERCASE) in sxt.run_proven_query.",
      "Bound every query with a WHERE filter or LIMIT. Large tables refuse unbounded queries." +
        (filterCol ? ` ${filterCol.name} can be used in WHERE.` : ""),
      AGGREGATE_NOTE,
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
      .describe("Optional case-insensitive filter over PREFIX.TABLE names, e.g. \"iris\" or \"punks\"."),
    schema: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Must be a schema (namespace) name")
      .transform((s) => s.toUpperCase())
      .optional()
      .describe("Optional: list only this schema (the PREFIX part of PREFIX.TABLE)."),
    cursor: z
      .string()
      .regex(/^\d{1,5}$/, "Pass nextCursor from a previous list_tables result")
      .optional()
      .describe("nextCursor from a previous call, to fetch the next page."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe("Tables per page (1 to 200, default 50). A page can run over by the size of one schema."),
  })
  .strict();

type ListTablesArgs = z.infer<typeof listTablesSchema>;

async function curated(needle: string | undefined) {
  const matches = KNOWN_TABLES.filter(
    (t) => !needle || t.table.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle),
  );
  return Promise.all(
    matches.map(async (t) => {
      try {
        const d = await describe(t.table);
        return { ...t, owner: "sxt-tools curated", provable: true as boolean | null, columns: d.columns };
      } catch (err) {
        if (err instanceof ToolError && err.code === "TABLE_NOT_PROVABLE") {
          return { ...t, owner: "sxt-tools curated", provable: false as boolean | null, columns: [] as Column[] };
        }
        return {
          ...t,
          owner: "sxt-tools curated",
          provable: null as boolean | null,
          columns: [] as Column[],
          note: "Live check failed; retry or call sxt.describe_table.",
        };
      }
    }),
  );
}

const COMMON_NOTES = [
  "Call sxt.describe_table on a table before querying it: it confirms the table is provable and returns its columns.",
  "Tables you publish yourself appear here once indexed; describe_table works on them immediately.",
  "ETHEREUM.TRANSACTIONS is not listed: proofs against it currently fail at the SXT prover.",
];

export async function listTablesHandler(args: ListTablesArgs, ctx: ToolContext = {}) {
  const needle = args.search?.toLowerCase();
  const get = discoveryGetter(ctx);
  const first = !args.cursor;

  if (!get) {
    return {
      catalog: "MAINNET",
      source: "curated",
      tables: first ? await curated(needle) : [],
      nextCursor: null,
      notes: [
        "Only the curated tables are listed: set SXT_API_KEY to list every public table on MAINNET.",
        ...COMMON_NOTES,
      ],
    };
  }

  const { community } = await listSchemas(get);
  const schemas = args.schema ? community.filter((s) => s === args.schema) : community;
  const start = Number(args.cursor ?? 0);

  const found: PublicTable[] = [];
  let i = start;
  let fetched = 0;
  while (i < schemas.length && found.length < args.limit && fetched < MAX_SCHEMA_FETCHES) {
    const batch = schemas.slice(i, i + FETCH_CONCURRENCY);
    fetched += batch.filter((s) => !isSchemaCached(s)).length;
    const lists = await Promise.all(batch.map((s) => listSchemaTables(get, s, "community")));
    for (const t of lists.flat()) {
      if (!needle || t.table.toLowerCase().includes(needle)) found.push(t);
    }
    i += batch.length;
  }

  // The curated SXT tables lead the first page; they are not in the community list.
  const curatedTables = first && !args.schema ? await curated(needle) : [];
  return {
    catalog: "MAINNET",
    source: "discovery",
    schemasScanned: `${i} of ${schemas.length}`,
    tables: [
      ...curatedTables,
      ...found.map((t) => ({
        table: t.table,
        owner: t.owner,
        accessType: t.accessType,
        size: t.size,
        created: t.created,
        immutable: t.immutable,
        provable: null,
      })),
    ],
    nextCursor: i < schemas.length ? String(i) : null,
    notes: [
      "Community tables are published by SXT users. provable: null means not checked yet; " +
        "sxt.describe_table checks it for free.",
      ...(i < schemas.length ? ["More tables exist: call again with cursor = nextCursor (and the same search)."] : []),
      ...COMMON_NOTES,
    ],
  };
}
