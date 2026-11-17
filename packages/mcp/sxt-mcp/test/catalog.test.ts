import { afterEach, describe, expect, it, vi } from "vitest";
import { decodePlanColumns, describeTableHandler, listTablesHandler } from "../src/tools/catalog.js";
import { sanitizeError } from "../src/lib/sanitize.js";

const u64 = (n: number) => n.toString(16).padStart(16, "0");
const u32 = (n: number) => n.toString(16).padStart(8, "0");
const str = (s: string) => u64(s.length) + Buffer.from(s, "utf8").toString("hex");

/** The head of a `SELECT *` EVM proof plan, as the chain RPC returns it. */
function plan(table: string, cols: Array<[string, string]>): string {
  return "0x" + u64(1) + str(table) + u64(cols.length) + cols.map(([n, t]) => u64(0) + str(n) + t).join("") + "deadbeef";
}

const BIGINT = u32(5);
const VARCHAR = u32(7);
const TIMESTAMP = u32(9) + u32(1) + u32(0);
const DECIMAL_10_NEG2 = u32(8) + "0a" + "fe";

function stubRpc(byTable: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const query = JSON.parse(init.body).params.query as string;
      calls.push(query);
      const table = query.replace("SELECT * FROM ", "");
      const body = byTable[table] ?? { error: { code: 254018, message: "tables do not exist" } };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("decodePlanColumns", () => {
  it("reads names and types, skipping timestamp and decimal extras", () => {
    const hex = plan("ETHEREUM.BLOCKS", [
      ["TIME_STAMP", TIMESTAMP],
      ["BLOCK_NUMBER", BIGINT],
      ["AMOUNT", DECIMAL_10_NEG2],
      ["MINER", VARCHAR],
    ]);
    expect(decodePlanColumns(hex)).toEqual([
      { name: "TIME_STAMP", type: "TIMESTAMP" },
      { name: "BLOCK_NUMBER", type: "BIGINT" },
      { name: "AMOUNT", type: "DECIMAL(10,-2)" },
      { name: "MINER", type: "VARCHAR" },
    ]);
  });

  it("refuses an unknown type id rather than misreading the rest", () => {
    expect(() => decodePlanColumns(plan("A.B", [["X", u32(99)]]))).toThrow(/unknown column type id 99/);
  });

  it("refuses a truncated plan", () => {
    expect(() => decodePlanColumns("0x" + u64(1) + u64(50))).toThrow(/ended early/);
  });
});

describe("sxt.describe_table", () => {
  it("returns live columns for a provable table", async () => {
    const calls = stubRpc({
      "DEMO_ABC.ITEMS": { result: { proofPlan: plan("DEMO_ABC.ITEMS", [["NAME", VARCHAR]]), at: "0x01" } },
    });
    const r = await describeTableHandler({ table: "DEMO_ABC.ITEMS" });
    expect(r.provable).toBe(true);
    expect(r.columns).toEqual([{ name: "NAME", type: "VARCHAR" }]);
    expect(r.chainStateAt).toBe("0x01");
    expect(calls).toEqual(["SELECT * FROM DEMO_ABC.ITEMS"]);
  });

  it("adds literal hints only for the column types present", async () => {
    stubRpc({
      "DEMO_ABC.TXS": {
        result: { proofPlan: plan("DEMO_ABC.TXS", [["HASH", u32(11)], ["FEE", DECIMAL_10_NEG2]]) },
      },
    });
    const notes = (await describeTableHandler({ table: "DEMO_ABC.TXS" })).notes.join("\n");
    expect(notes).toContain("X'");
    expect(notes).toContain("not compared in WHERE");
    expect(notes).toContain("Aggregates");
    expect(notes).not.toContain("single-quoted string");
  });

  it("shares one RPC call across a burst of concurrent callers", async () => {
    const calls = stubRpc({
      "DEMO_ABC.BURST": { result: { proofPlan: plan("DEMO_ABC.BURST", [["N", BIGINT]]) } },
    });
    const results = await Promise.all(
      Array.from({ length: 25 }, () => describeTableHandler({ table: "DEMO_ABC.BURST" })),
    );
    expect(results.every((r) => r.columns[0]!.type === "BIGINT")).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("does not cache a failure", async () => {
    const calls = stubRpc({});
    await describeTableHandler({ table: "DEMO_ABC.LATER" }).catch(() => undefined);
    await describeTableHandler({ table: "DEMO_ABC.LATER" }).catch(() => undefined);
    expect(calls).toHaveLength(2);
  });

  it("maps a table without commitments to TABLE_NOT_PROVABLE with an agent-readable message", async () => {
    stubRpc({});
    const err = await describeTableHandler({ table: "ETHEREUM.LOGS_UNCOMMITTED" }).catch((e) => e);
    const s = sanitizeError(err);
    expect(s.code).toBe("TABLE_NOT_PROVABLE");
    expect(s.message).toContain("sxt.list_tables");
  });
});

describe("sxt.list_tables without a key", () => {
  // credentialSource "request" with no key: never falls back to a developer's SXT_API_KEY.
  const keyless = { credentialSource: "request" as const };

  it("falls back to the curated list, filtered and checked live", async () => {
    stubRpc({
      "ETHEREUM.BLOCKS": {
        result: { proofPlan: plan("ETHEREUM.BLOCKS", [["BLOCK_NUMBER", BIGINT]]) },
      },
    });
    const r = await listTablesHandler({ search: "blocks", limit: 50 }, keyless);
    expect(r.source).toBe("curated");
    expect(r.tables.map((t) => t.table)).toEqual(["ETHEREUM.BLOCKS"]);
    expect(r.tables[0]!.provable).toBe(true);
    expect(r.notes.join(" ")).toContain("SXT_API_KEY");
  });

  it("never lists ETHEREUM.TRANSACTIONS while proofs against it fail", async () => {
    stubRpc({});
    const r = await listTablesHandler({ search: "transactions", limit: 50 }, keyless);
    expect(r.tables).toEqual([]);
  });
});
