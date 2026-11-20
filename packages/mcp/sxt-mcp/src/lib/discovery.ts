/**
 * Public table discovery via the MakeInfinite discovery API.
 *
 *   GET /v2/discover/schema?scope=PUBLIC&sourceNetwork=MAINNET&sxtOwned=<bool>
 *       → [{ schema, isPublic }]
 *   GET /v2/discover/table?scope=PUBLIC&sourceNetwork=MAINNET&schema=<SCHEMA>
 *       → [{ table, schema, accessType, immutable, size: "5.2 KB", created, ... }]
 *
 * Both need a Bearer JWT but spend nothing (checked against the account
 * balance and free-query counters on 2026-11-17). There is no "all tables"
 * call: tables come one schema at a time, so callers page through schemas
 * and cap how many uncached schemas one request may fetch.
 *
 * The PUBLIC scope returns the same catalog to every caller, so results are
 * cached process-wide (per isolate on Workers) for CACHE_TTL_MS, whichever
 * caller's JWT fetched them. Each entry holds the in-flight promise, so a
 * burst of callers on a cold cache shares one upstream request.
 */

export const CACHE_TTL_MS = 15 * 60_000;
const MAX_SCHEMA_ENTRIES = 5_000;

/** SXT identifiers as the chain accepts them. Anything else from upstream is dropped. */
const IDENT = /^[A-Z][A-Z0-9_]{0,127}$/;

export type Getter = (path: string) => Promise<unknown>;

export interface PublicTable {
  /** PREFIX.TABLE, ready for SQL. */
  table: string;
  schema: string;
  owner: "sxt" | "community";
  accessType: string | null;
  immutable: boolean | null;
  size: string | null;
  sizeBytes: number | null;
  created: string | null;
}

export interface SchemaList {
  sxt: string[];
  community: string[];
}

interface Entry<T> {
  at: number;
  value: Promise<T>;
}

const schemaCache = new Map<string, Entry<SchemaList>>();
const tableCache = new Map<string, Entry<PublicTable[]>>();

function cached<T>(map: Map<string, Entry<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = load();
  map.set(key, { at: Date.now(), value });
  value.catch(() => map.delete(key));
  if (map.size > MAX_SCHEMA_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  return value;
}

/** True when `schema`'s tables are cached and fresh, so reading them costs no upstream call. */
export function isSchemaCached(schema: string): boolean {
  const hit = tableCache.get(schema);
  return !!hit && Date.now() - hit.at < CACHE_TTL_MS;
}

const BASE = "scope=PUBLIC&sourceNetwork=MAINNET";

function schemaNames(body: unknown): string[] {
  if (!Array.isArray(body)) throw new Error("discovery schema list was not an array");
  return body
    .map((r) => (r && typeof r === "object" ? (r as { schema?: unknown }).schema : undefined))
    .filter((s): s is string => typeof s === "string" && IDENT.test(s))
    .sort();
}

/** Every public MAINNET schema, split into SXT-owned (ETHEREUM, ...) and community ones. */
export function listSchemas(get: Getter): Promise<SchemaList> {
  return cached(schemaCache, "all", async () => {
    // Sequential on purpose: two small requests, no reason to burst.
    const sxt = schemaNames(await get(`/v2/discover/schema?${BASE}&sxtOwned=true`));
    const community = schemaNames(await get(`/v2/discover/schema?${BASE}&sxtOwned=false`));
    const owned = new Set(sxt);
    return { sxt, community: community.filter((s) => !owned.has(s)) };
  });
}

/** Parses "5.2 KB" / "471.2 MB" into bytes. Null when the format is unknown. */
export function parseSize(size: unknown): number | null {
  if (typeof size !== "string") return null;
  const m = /^\s*([\d.]+)\s*(B|KB|MB|GB|TB)\s*$/i.exec(size);
  if (!m) return null;
  const power = ["B", "KB", "MB", "GB", "TB"].indexOf(m[2]!.toUpperCase());
  return Math.round(Number(m[1]) * 1024 ** power);
}

/** The public tables in one schema. */
export function listSchemaTables(get: Getter, schema: string, owner: PublicTable["owner"]): Promise<PublicTable[]> {
  if (!IDENT.test(schema)) return Promise.resolve([]);
  return cached(tableCache, schema, async () => {
    const body = await get(`/v2/discover/table?${BASE}&schema=${encodeURIComponent(schema)}`);
    if (!Array.isArray(body)) throw new Error(`discovery table list for ${schema} was not an array`);
    const out: PublicTable[] = [];
    for (const raw of body) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.table !== "string" || !IDENT.test(r.table)) continue;
      out.push({
        table: `${schema}.${r.table}`,
        schema,
        owner,
        accessType: typeof r.accessType === "string" ? r.accessType : null,
        immutable: typeof r.immutable === "boolean" ? r.immutable : null,
        size: typeof r.size === "string" ? r.size : null,
        sizeBytes: parseSize(r.size),
        created: typeof r.created === "string" ? r.created : null,
      });
    }
    return out.sort((a, b) => a.table.localeCompare(b.table));
  });
}

/** Discovery metadata for one PREFIX.TABLE, or null if it is not in the public catalog. */
export async function findTable(get: Getter, tableRef: string): Promise<PublicTable | null> {
  const [schema, name] = tableRef.toUpperCase().split(".");
  if (!schema || !name) return null;
  const { sxt } = await listSchemas(get);
  const tables = await listSchemaTables(get, schema, sxt.includes(schema) ? "sxt" : "community");
  return tables.find((t) => t.table === `${schema}.${name}`) ?? null;
}

/** Test hook. */
export function clearDiscoveryCache(): void {
  schemaCache.clear();
  tableCache.clear();
}
