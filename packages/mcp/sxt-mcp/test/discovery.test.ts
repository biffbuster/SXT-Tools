/**
 * Public-table discovery (lib/discovery.ts via sxt.list_tables), the
 * run_proven_query guards that run before a credit is spent, and row decoding.
 * No network: global fetch is a scripted fake of the auth exchange, the
 * discovery API, the chain RPC and the prover.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeTableHandler, listTablesHandler } from "../src/tools/catalog.js";
import { runProvenQueryHandler, setProverDepsForTest } from "../src/tools/run-proven-query.js";
import { clearDiscoveryCache, parseSize } from "../src/lib/discovery.js";
import { clearTokenCache } from "../src/lib/prover.js";
import { formatDecimal, toRows } from "../src/lib/results.js";
import { sanitizeError, UpstreamError } from "../src/lib/sanitize.js";

const ctx = { credentialSource: "request" as const, apiKey: "test-key-0123456789abcdef" };

const u64 = (n: number) => n.toString(16).padStart(16, "0");
const str = (s: string) => u64(s.length) + Buffer.from(s, "utf8").toString("hex");
const BIGINT = "00000005";
const VARCHAR = "00000007";
const plan = (table: string, cols: Array<[string, string]>) =>
  "0x" + u64(1) + str(table) + u64(cols.length) + cols.map(([n, t]) => u64(0) + str(n) + t).join("");

interface World {
  community: string[];
  tables: Record<string, Array<{ table: string; size: string }>>;
  /** Tables the chain planner knows; anything else is 254018. */
  provable: Record<string, Array<[string, string]>>;
}

function fakeWorld(world: World) {
  const calls = { auth: 0, schema: 0, table: 0, plan: [] as string[], submit: 0 };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes("/auth/apikey")) {
        calls.auth++;
        return json({ accessToken: "jwt" });
      }
      if (url.includes("/v2/discover/schema")) {
        calls.schema++;
        const owned = url.includes("sxtOwned=true");
        return json((owned ? ["ETHEREUM"] : world.community).map((schema) => ({ schema, isPublic: null })));
      }
      if (url.includes("/v2/discover/table")) {
        calls.table++;
        const schema = new URL(url).searchParams.get("schema")!;
        return json(
          (world.tables[schema] ?? []).map((t) => ({ ...t, schema, accessType: "public_read", immutable: true })),
        );
      }
      if (url.includes("rpc.mainnet.sxt.network")) {
        const body = JSON.parse(String(init.body));
        if (body.method === "attestation_v1_bestRecentAttestations") return json({ result: { attestationsFor: "0xabc" } });
        const query = body.params.query as string;
        calls.plan.push(query);
        if (/GROUP BY NAME/i.test(query)) {
          return json({ error: { code: 254017, message: "encountered error in proof-of-sql planner: LogicalPlan is not supported" } });
        }
        const table = Object.keys(world.provable).find((t) => query.toUpperCase().includes(t));
        if (!table) return json({ error: { code: 254018, message: "tables do not exist" } });
        return json({ result: { proofPlan: plan(table, world.provable[table]!), at: "0x01" } });
      }
      if (url.endsWith("/v1/zkquery") && init.method === "POST") {
        calls.submit++;
        return json({ queryId: "q-12345678" });
      }
      if (url.endsWith("/status")) return json({ status: "done" });
      if (url.endsWith("/results")) return json({ proof: "p" });
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return calls;
}

const communitySchemas = (n: number) => Array.from({ length: n }, (_, i) => `COMM_${String(i).padStart(2, "0")}_ABC`);

beforeEach(() => {
  clearDiscoveryCache();
  clearTokenCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setProverDepsForTest({});
});

describe("sxt.list_tables with a key", () => {
  it("pages through community schemas with a cursor; curated tables lead page one", async () => {
    const community = communitySchemas(10);
    const calls = fakeWorld({
      community,
      tables: Object.fromEntries(community.map((s) => [s, [{ table: "T", size: "1.0 KB" }]])),
      provable: { "ETHEREUM.BLOCKS": [["BLOCK_NUMBER", BIGINT]] },
    });

    const p1 = await listTablesHandler({ limit: 5 }, ctx);
    expect(p1.source).toBe("discovery");
    expect(p1.tables[0]!.table).toBe("ETHEREUM.BLOCKS");
    const community1 = p1.tables.filter((t) => t.owner === "community").map((t) => t.table);
    expect(community1).toEqual(community.slice(0, 8).map((s) => `${s}.T`));
    expect(p1.nextCursor).toBe("8");

    const p2 = await listTablesHandler({ limit: 5, cursor: p1.nextCursor! }, ctx);
    expect(p2.tables.map((t) => t.table)).toEqual(community.slice(8).map((s) => `${s}.T`));
    expect(p2.nextCursor).toBeNull();
    expect(calls.table).toBe(10);
    expect(calls.auth).toBe(1);
  });

  it("caps uncached schema fetches per call, then serves repeats from cache", async () => {
    const community = communitySchemas(30);
    const calls = fakeWorld({
      community,
      tables: { [community[29]!]: [{ table: "IRIS", size: "5.2 KB" }] },
      provable: {},
    });

    const first = await listTablesHandler({ search: "iris", limit: 50 }, ctx);
    expect(calls.table).toBe(12);
    expect(first.tables).toEqual([]);
    expect(first.nextCursor).toBe("12");

    let cursor = first.nextCursor;
    const found: string[] = [];
    while (cursor) {
      const page = await listTablesHandler({ search: "iris", limit: 50, cursor }, ctx);
      found.push(...page.tables.map((t) => t.table));
      cursor = page.nextCursor;
    }
    expect(found).toEqual([`${community[29]}.IRIS`]);
    expect(calls.table).toBe(30);

    // Warm cache: the whole catalog in one call, no new upstream requests.
    const warm = await listTablesHandler({ search: "iris", limit: 50 }, ctx);
    expect(warm.tables.map((t) => t.table)).toEqual([`${community[29]}.IRIS`]);
    expect(warm.nextCursor).toBeNull();
    expect(calls.table).toBe(30);
    expect(calls.schema).toBe(2);
  });

  it("lists one schema when asked", async () => {
    fakeWorld({
      community: ["IRIS_DATASET_ABC", "OTHER_ABC"],
      tables: { IRIS_DATASET_ABC: [{ table: "IRIS", size: "5.2 KB" }], OTHER_ABC: [{ table: "X", size: "1 B" }] },
      provable: {},
    });
    const r = await listTablesHandler({ schema: "IRIS_DATASET_ABC", limit: 50 }, ctx);
    expect(r.tables.map((t) => t.table)).toEqual(["IRIS_DATASET_ABC.IRIS"]);
  });
});

describe("sxt.describe_table with a key", () => {
  it("adds size and owner from discovery", async () => {
    fakeWorld({
      community: ["IRIS_DATASET_DESC"],
      tables: { IRIS_DATASET_DESC: [{ table: "IRIS", size: "5.2 KB" }] },
      provable: { "IRIS_DATASET_DESC.IRIS": [["VARIETY", VARCHAR]] },
    });
    const r = await describeTableHandler({ table: "IRIS_DATASET_DESC.IRIS" }, ctx);
    expect(r).toMatchObject({ owner: "community", size: "5.2 KB", provable: true });
    expect(r.exampleSql).toBe("SELECT VARIETY FROM IRIS_DATASET_DESC.IRIS LIMIT 10");
  });
});

describe("sxt.run_proven_query guards (nothing submitted)", () => {
  const world: World = {
    community: ["HELLO_ABC", "BIG_ABC"],
    tables: { HELLO_ABC: [{ table: "HW", size: "2.0 KB" }], BIG_ABC: [{ table: "LOGS", size: "471.2 MB" }] },
    provable: { "HELLO_ABC.HW": [["AREA", BIGINT], ["NAME", VARCHAR]], "BIG_ABC.LOGS": [["N", BIGINT]] },
  };
  const run = (tableRef: string, sql: string) =>
    runProvenQueryHandler({ tableRef, sql, waitSeconds: 10 }, ctx).catch((e) => e);

  it("refuses an aggregate with no GROUP BY", async () => {
    const calls = fakeWorld(world);
    const err = await run("HELLO_ABC.HW", "SELECT COUNT(*) FROM HELLO_ABC.HW");
    expect(sanitizeError(err).code).toBe("SQL_REJECTED");
    expect(calls.plan).toEqual([]);
    expect(calls.submit).toBe(0);
  });

  it("returns the planner's reason for an unprovable shape", async () => {
    const calls = fakeWorld(world);
    const err = await run("HELLO_ABC.HW", "SELECT NAME, COUNT(*) AS N FROM HELLO_ABC.HW GROUP BY NAME");
    const s = sanitizeError(err);
    expect(s.code).toBe("SQL_REJECTED");
    expect(s.message).toContain("nothing was spent");
    expect(s.message).toContain("GROUP BY");
    expect(calls.submit).toBe(0);
  });

  it("maps an unknown table to TABLE_NOT_PROVABLE", async () => {
    const calls = fakeWorld(world);
    const err = await run("NOPE_ABC.T", "SELECT A FROM NOPE_ABC.T LIMIT 1");
    expect(sanitizeError(err).code).toBe("TABLE_NOT_PROVABLE");
    expect(calls.submit).toBe(0);
  });

  it("refuses an unbounded query on a large table", async () => {
    const calls = fakeWorld(world);
    const err = await run("BIG_ABC.LOGS", "SELECT N FROM BIG_ABC.LOGS");
    const s = sanitizeError(err);
    expect(s.code).toBe("SQL_REJECTED");
    expect(s.message).toContain("471.2 MB");
    expect(calls.submit).toBe(0);
  });

  it("refuses ETHEREUM.TRANSACTIONS while it breaks the prover", async () => {
    const calls = fakeWorld(world);
    const err = await run("ETHEREUM.TRANSACTIONS", "SELECT GAS FROM ETHEREUM.TRANSACTIONS WHERE BLOCK_NUMBER = 1");
    expect(sanitizeError(err).code).toBe("SQL_REJECTED");
    expect(calls.submit).toBe(0);
  });

  it("proves a grouped aggregate and decodes the rows", async () => {
    const calls = fakeWorld(world);
    setProverDepsForTest({
      verify: () => [
        ["AREA", { BigInt: [344400, 371000] }],
        ["N", { BigInt: [1, 2] }],
      ],
    });
    const r = (await runProvenQueryHandler(
      { tableRef: "HELLO_ABC.HW", sql: "SELECT AREA, COUNT(*) AS N FROM HELLO_ABC.HW GROUP BY AREA", waitSeconds: 10 },
      ctx,
    )) as Record<string, unknown>;
    expect(r.status).toBe("verified");
    expect(r.rows).toEqual([
      { AREA: 344400, N: 1 },
      { AREA: 371000, N: 2 },
    ]);
    expect(calls.submit).toBe(1);
  });
});

describe("toRows", () => {
  it("decodes DECIMAL limbs at their scale, including negatives", () => {
    const r = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617") - 510n;
    const exact = [3, 2, 1, 0].map((i) => ((r >> BigInt(64 * i)) & 0xffffffffffffffffn).toString());
    const lossy = exact.map(Number);
    // Number-rounded limbs would decode to a wrong value, so no rows at all.
    expect(toRows([["D", { Decimal75: [18, 2, [lossy]] }]])).toBeNull();
    const out = toRows([
      ["SEPAL_LENGTH", { Decimal75: [18, 2, [[0, 0, 0, 510], [0, 0, 0, 5], exact]] }],
      ["VARIETY", { VarChar: ["Setosa", "Setosa", "Virginica"] }],
    ]);
    expect(out!.rows).toEqual([
      { SEPAL_LENGTH: "5.10", VARIETY: "Setosa" },
      { SEPAL_LENGTH: "0.05", VARIETY: "Setosa" },
      { SEPAL_LENGTH: "-5.10", VARIETY: "Virginica" },
    ]);
  });

  it("renders VARBINARY as 0x hex", () => {
    expect(toRows([["H", { VarBinary: [[0xde, 0xad], []] }]])!.rows).toEqual([{ H: "0xdead" }, { H: "0x" }]);
  });

  it("returns null for a shape it does not know, rather than guessing", () => {
    expect(toRows([["X", { Mystery: { a: 1 } }]])).toBeNull();
    expect(toRows([["A", { BigInt: [1, 2] }], ["B", { BigInt: [1] }]])).toBeNull();
  });

  it("formats scales", () => {
    expect(formatDecimal(5n, 0)).toBe("5");
    expect(formatDecimal(5n, -2)).toBe("500");
    expect(formatDecimal(-7n, 3)).toBe("-0.007");
  });
});

describe("discovery and error helpers", () => {
  it("parses discovery sizes", () => {
    expect(parseSize("5.2 KB")).toBe(5325);
    expect(parseSize("471.2 MB")).toBe(Math.round(471.2 * 1024 ** 2));
    expect(parseSize("big")).toBeNull();
  });

  it("classifies a planner 422 as SQL_REJECTED, not a missing table", () => {
    const e = sanitizeError(
      new UpstreamError("Prover", 'query submit failed: 422: {"title":"Unable to generate proof plan"}'),
    );
    expect(e.code).toBe("SQL_REJECTED");
  });

  it("classifies an execution failure as non-retryable QUERY_FAILED", () => {
    const e = sanitizeError(
      new UpstreamError("Prover", 'query q ended with status "failed": {"error":"Query execution failed 3 times"}'),
    );
    expect(e).toMatchObject({ code: "QUERY_FAILED", retryable: false });
  });
});
