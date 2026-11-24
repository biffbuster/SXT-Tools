/**
 * sxt.publish_dataset — publish a CSV to SXT chain as a Proof-of-SQL-queryable
 * table. Mirrors examples/scripts/publish-dataset-cli.mjs line-for-line.
 *
 * Phase 4 (v0.1.0). First chain-touching tool. Default network is testnet
 * (`wss://rpc.testnet.sxt.network`); mainnet requires the double-gate
 * (`mainnet: true` arg + `SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` env).
 *
 * Risk surface when defaults hold: testnet credits only (free SXT faucet).
 * No EVM gas, no Studio API quota.
 *
 * Load-bearing rules enforced inline (see CLAUDE.md):
 *   1. NOT NULL on every column. The DDL builder appends NOT NULL unconditionally.
 *   2. NO PRIMARY KEY clause — tables with PK fail to promote into the MAINNET
 *      catalog and silently break downstream queries.
 *   3. Namespace is auto-suffixed with the wallet's uppercase hex address (chain
 *      enforces this; rejecting on the chain side wastes credits).
 *   4. Apache Arrow vectors carry explicit types. tableFromJSON inference is
 *      rejected by the indexing pallet with ArrowExpectedRecordBatchMessage.
 */

import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { loadConfig } from "../lib/config.js";
import { MissingCredentialError } from "../lib/errors.js";
import { selectNetwork } from "../lib/network.js";
import { logger } from "../lib/logger.js";

export const publishDatasetSchema = z
  .object({
    file: z
      .string()
      .describe(
        "Absolute or relative path to a CSV file. Parquet and JSON are not supported here; " +
          "convert them to CSV first.",
      ),
    tableRef: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/, "Must be PREFIX.TABLE in UPPERCASE_SNAKE_CASE")
      .describe(
        "Logical table reference, e.g. MY_AUDIT.KNOWN_EXPLOITS. The wallet's hex address is " +
          "auto-appended to the namespace prefix per the SXT chain rule.",
      ),
    schema: z
      .array(
        z
          .object({
            name: z.string(),
            type: z.enum([
              "BOOLEAN",
              "TINYINT",
              "SMALLINT",
              "INT",
              "INTEGER",
              "BIGINT",
              "VARCHAR",
              "BINARY",
              "TIMESTAMP",
            ]),
          })
          .strict(),
      )
      .optional()
      .describe(
        "Optional explicit column schema. When omitted, the server infers types from the first " +
          "row (BIGINT for integers, BOOLEAN for true/false, TIMESTAMP for ISO datetimes, VARCHAR " +
          "fallback). DECIMAL75 is not supported — use the chain.spaceandtime.io UI for that.",
      ),
    tableType: z
      .enum(["Community", "PublicPermissionless", "CoreBlockchain", "SCI", "Testing"])
      .default("Community")
      .describe(
        "SxtCoreTablesTableType — must match the live runtime enum. Default Community for public " +
          "reference datasets. Do not pass OwnerPermissioned or UserVerified — those names appear " +
          "in older SXT marketing material but are not valid on the current runtime.",
      ),
    mainnet: z
      .boolean()
      .default(false)
      .describe(
        "Set true to publish to SXT mainnet. Also requires SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND in " +
          "env. Default false routes to testnet (free credits via chain.spaceandtime.io faucet).",
      ),
  })
  .strict();

export type PublishDatasetArgs = z.infer<typeof publishDatasetSchema>;

// ─── Schema inference ──────────────────────────────────────────────────────

type SqlType =
  | "BOOLEAN"
  | "TINYINT"
  | "SMALLINT"
  | "INT"
  | "INTEGER"
  | "BIGINT"
  | "VARCHAR"
  | "BINARY"
  | "TIMESTAMP";

export function inferColumnTypes(rows: Record<string, string>[]): Record<string, SqlType> {
  if (rows.length === 0) {
    throw new Error("CSV has no rows — cannot infer schema. Pass schema explicitly.");
  }
  const first = rows[0];
  if (!first) throw new Error("CSV first row is empty.");
  const types: Record<string, SqlType> = {};
  for (const col of Object.keys(first)) {
    const v = first[col];
    if (v === undefined || v === null || v === "") {
      types[col] = "VARCHAR";
    } else if (/^-?\d+$/.test(String(v))) {
      types[col] = "BIGINT";
    } else if (/^-?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(String(v))) {
      // DECIMAL75 has no Arrow encoder here. Refuse up front rather than
      // typing the column VARCHAR behind the user's back (which would silently
      // kill numeric comparison on chain) or emitting DECIMAL and crashing at
      // the encoder AFTER createTables has already been paid for.
      throw new Error(
        `Column "${col}" looks like a decimal (first value: "${v}"). This server has no ` +
          `DECIMAL75 Arrow encoder, so the column cannot be published as a numeric type. ` +
          `Options: (1) pass an explicit schema typing "${col}" as VARCHAR to store it as text ` +
          `(no numeric comparison on chain); (2) scale the values to integers and type it ` +
          `BIGINT; (3) load the table via chain.spaceandtime.io, which supports DECIMAL75.`,
      );
    } else if (/^(true|false)$/i.test(String(v))) {
      types[col] = "BOOLEAN";
    } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(String(v))) {
      types[col] = "TIMESTAMP";
    } else {
      types[col] = "VARCHAR";
    }
  }
  return types;
}

function buildCreateStatement(
  namespace: string,
  table: string,
  columnTypes: Record<string, SqlType>,
): string {
  // NOT NULL on every column (Proof of SQL determinism rule).
  // NO PRIMARY KEY — tables with PK silently break catalog promotion.
  const lines = Object.entries(columnTypes).map(([col, t]) => `  ${col} ${t} NOT NULL`);
  return `CREATE TABLE ${namespace}.${table} (\n${lines.join(",\n")}\n)`;
}

/** Matches the pallet's "this already exists" family. Mirrors publish-dataset-cli.mjs:382. */
function isAlreadyExistsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /VersionAlreadyExists|TableAlreadyExists|NamespaceAlreadyExists|already exists/i.test(msg);
}

/**
 * Build a verification query the prover will actually accept.
 *
 * COUNT(*) and other aggregates currently fail at the prover with null
 * AttestedCommitments (see mcp-parity-test.mjs and README "Prover status"), so
 * a point lookup against a real row is the only reliable self-check. Prefers
 * the first VARCHAR column to match how save-proof-plans.mjs picks its lookup
 * target; falls back to the first column of any type.
 */
function buildVerifySql(
  namespace: string,
  table: string,
  columnTypes: Record<string, SqlType>,
  rows: Record<string, string>[],
): string {
  const entries = Object.entries(columnTypes);
  const picked = entries.find(([, t]) => t === "VARCHAR") ?? entries[0];
  if (!picked) return `SELECT * FROM ${namespace}.${table}`;
  const [col, sqlType] = picked;
  const raw = rows[0]?.[col] ?? "";
  const literal =
    sqlType === "VARCHAR" || sqlType === "BINARY" || sqlType === "TIMESTAMP"
      ? `'${String(raw).replace(/'/g, "''")}'`
      : String(raw);
  return `SELECT ${col} FROM ${namespace}.${table} WHERE ${col} = ${literal}`;
}

// ─── Value coercion ────────────────────────────────────────────────────────

/**
 * csv-parse hands back strings for every cell. Apache Arrow's typed builders do
 * NOT parse them: `vectorFromArray(["true","false"], new Bool())` yields
 * [false, false] (every boolean silently wrong, and the HyperKZG proof then
 * attests to the wrong data), and a TimestampMillisecond builder throws
 * "Cannot convert <iso> to a BigInt". Coerce to the JS types Arrow expects
 * before building any vector.
 *
 * Ported from examples/scripts/publish-dataset-cli.mjs `coerceValues`, with
 * unparseable values promoted from silent fallbacks to hard errors — a bad
 * value published under a proof is worse than a failed publish.
 */
export function coerceValues(values: (string | undefined)[], sqlType: SqlType, col: string): unknown[] {
  const bad = (v: unknown, expected: string): never => {
    throw new Error(
      `Column "${col}" is typed ${sqlType} but contains the value ${JSON.stringify(v)}, ` +
        `which is not ${expected}. Fix the CSV or pass an explicit schema typing "${col}" as VARCHAR.`,
    );
  };

  switch (sqlType) {
    case "BOOLEAN":
      return values.map((v) => {
        const s = String(v ?? "").trim().toLowerCase();
        if (s === "true" || s === "1") return true;
        if (s === "false" || s === "0") return false;
        return bad(v, 'one of true/false/1/0');
      });

    case "TINYINT":
    case "SMALLINT":
    case "INT":
    case "INTEGER":
      return values.map((v) => {
        const s = String(v ?? "").trim();
        if (!/^-?\d+$/.test(s)) return bad(v, "an integer");
        return Number(s);
      });

    case "BIGINT":
      return values.map((v) => {
        const s = String(v ?? "").trim();
        if (!/^-?\d+$/.test(s)) return bad(v, "an integer");
        return BigInt(s);
      });

    case "TIMESTAMP":
      return values.map((v) => {
        const s = String(v ?? "").trim();
        if (/^-?\d+$/.test(s)) return BigInt(s); // already epoch millis
        const ms = Date.parse(s);
        if (Number.isNaN(ms)) return bad(v, "epoch milliseconds or an ISO 8601 datetime");
        return BigInt(ms);
      });

    default:
      // VARCHAR and BINARY take the raw strings.
      return values.map((v) => String(v ?? ""));
  }
}

// ─── Promise-wrapped signAndSend ───────────────────────────────────────────

interface SubstrateExtrinsic {
  signAndSend(
    address: string,
    options: { signer: unknown },
    cb: (status: SubstrateStatus) => void,
  ): Promise<() => void>;
}

interface SubstrateStatus {
  status: {
    isInBlock: boolean;
    isFinalized: boolean;
    isInvalid: boolean;
    isDropped: boolean;
    asInBlock: { toHex(): string };
    asFinalized: { toHex(): string };
    type: string;
  };
  dispatchError?: {
    isModule: boolean;
    asModule: unknown;
    toString(): string;
  };
}

interface ApiLike {
  registry: {
    findMetaError(asModule: unknown): { section: string; name: string; docs?: string[] };
  };
}

function submitTx(
  label: string,
  tx: SubstrateExtrinsic,
  signer: unknown,
  signerAddress: string,
  api: ApiLike,
): Promise<string> {
  return new Promise((resolveResult, reject) => {
    let unsub: (() => void) | null = null;
    tx.signAndSend(signerAddress, { signer }, ({ status, dispatchError }) => {
      if (dispatchError) {
        let msg: string;
        if (dispatchError.isModule) {
          const decoded = api.registry.findMetaError(dispatchError.asModule);
          msg = `${label} module error: ${decoded.section}.${decoded.name}${decoded.docs?.length ? ` — ${decoded.docs.join(" ")}` : ""}`;
        } else {
          msg = `${label} dispatch error: ${dispatchError.toString()}`;
        }
        if (unsub) unsub();
        reject(new Error(msg));
        return;
      }
      if (status.isFinalized) {
        const hash = status.asFinalized.toHex();
        if (unsub) unsub();
        resolveResult(hash);
      } else if (status.isInvalid || status.isDropped) {
        if (unsub) unsub();
        reject(new Error(`${label} ${status.type}`));
      }
    })
      .then((u) => {
        unsub = u;
      })
      .catch(reject);
  });
}

// ─── Handler ───────────────────────────────────────────────────────────────

export async function publishDatasetHandler(args: PublishDatasetArgs) {
  const config = loadConfig();
  if (!config.privateKey) {
    throw new MissingCredentialError(
      "PRIVATE_KEY",
      "sign SXT chain extrinsics for publish_dataset",
    );
  }

  // Network selection — enforces mainnet double-gate.
  const network = selectNetwork({
    mainnet: args.mainnet,
    action: `publish_dataset to SXT ${args.mainnet ? "mainnet" : "testnet"}`,
  });

  // ─── Load + parse CSV ────────────────────────────────────────────────
  let csvText: string;
  try {
    csvText = await readFile(args.file, "utf8");
  } catch {
    throw new Error(`Could not read file: ${args.file}`);
  }

  const { parse: parseCsv } = (await import("csv-parse/sync")) as {
    parse: (
      input: string,
      opts: { columns: boolean; skip_empty_lines: boolean; trim: boolean },
    ) => Record<string, string>[];
  };
  const rows = parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: true });
  if (rows.length === 0) {
    throw new Error(`CSV at ${args.file} contains no data rows.`);
  }

  // ─── Resolve column schema ──────────────────────────────────────────
  let columnTypes: Record<string, SqlType>;
  if (args.schema) {
    columnTypes = Object.fromEntries(args.schema.map((c) => [c.name, c.type]));
  } else {
    columnTypes = inferColumnTypes(rows);
  }

  // ─── Pre-flight the encode BEFORE spending ──────────────────────────
  // createTables costs 20-40 SXT and is submitted below. Any value that the
  // Arrow encoder would reject must surface here, at zero cost, rather than
  // after the table has been created and paid for.
  for (const [col, sqlType] of Object.entries(columnTypes)) {
    if (!(col in (rows[0] ?? {}))) {
      throw new Error(
        `Schema declares column "${col}" but the CSV header does not contain it. ` +
          `CSV columns: ${Object.keys(rows[0] ?? {}).join(", ")}`,
      );
    }
    coerceValues(
      rows.map((r) => r[col]),
      sqlType,
      col,
    );
  }

  // ─── Derive wallet + namespace ──────────────────────────────────────
  const { Wallet } = await import("ethers");
  const wallet = new Wallet(config.privateKey);

  const refParts = args.tableRef.split(".");
  const prefix = refParts[0]!;
  const table = refParts[1]!;
  const namespace = `${prefix}_${wallet.address.slice(2).toUpperCase()}`;
  const createStatement = buildCreateStatement(namespace, table, columnTypes);

  // ─── Connect to Substrate ───────────────────────────────────────────
  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const provider = new WsProvider(network.sxtRpc);
  const api = await ApiPromise.create({ provider, noInitWarn: true });

  try {
    const { EthEcdsaSigner } = await import("../lib/eth-ecdsa-signer.js");
    const signer = new EthEcdsaSigner(wallet, api);

    // Verify the pallets we need exist.
    const tablesPallet = api.tx["tables"] as
      | { createNamespace?: unknown; createTables?: unknown }
      | undefined;
    if (!tablesPallet?.createNamespace || !tablesPallet?.createTables) {
      throw new Error(
        `api.tx.tables.{createNamespace,createTables} not available on ${network.sxtRpc}. ` +
          "Confirm the chain runtime supports the tables pallet (it should on both mainnet and testnet).",
      );
    }

    // ─── Submit createNamespace + createTables (batched) ──────────────
    const tablesTx = api.tx["tables"] as unknown as {
      createNamespace: (...args: unknown[]) => SubstrateExtrinsic;
      createTables: (specs: unknown[]) => SubstrateExtrinsic;
    };
    const utilityTx = api.tx["utility"] as unknown as {
      batchAll: (txs: unknown[]) => SubstrateExtrinsic;
    };

    const createNamespaceTx = tablesTx.createNamespace(
      namespace,
      0,
      `CREATE SCHEMA IF NOT EXISTS ${namespace}`,
      args.tableType,
      { UserCreated: "sxt-mcp-v0.1.1" },
    );
    const createTablesTx = tablesTx.createTables([
      {
        ident: { namespace, name: table },
        createStatement,
        tableType: args.tableType,
        commitment: { Empty: { hyperKzg: true } },
        source: { UserCreated: "sxt-mcp-v0.1.1" },
      },
    ]);
    const batchTx = utilityTx.batchAll([createNamespaceTx, createTablesTx]);

    let createTxHash: string | null = null;
    let alreadyExisted = false;
    try {
      createTxHash = await submitTx(
        "createTable batch",
        batchTx,
        signer,
        signer.address,
        api as unknown as ApiLike,
      );
    } catch (err) {
      if (!isAlreadyExistsError(err)) throw err;

      // batchAll is ATOMIC. When createNamespace fails because the namespace
      // already exists (the common case for every publish after the first from
      // a given wallet), the whole batch rolls back and createTables never
      // landed. Proceeding straight to submitData here would fail with
      // indexing.UnauthorizedSubmitter. Re-submit createTables on its own
      // against the existing namespace.
      // Mirrors examples/scripts/publish-dataset-cli.mjs:393-414.
      alreadyExisted = true;
      try {
        createTxHash = await submitTx(
          "createTables (fallback, existing namespace)",
          createTablesTx,
          signer,
          signer.address,
          api as unknown as ApiLike,
        );
      } catch (err2) {
        // Table itself already exists too — nothing to create, go insert.
        if (!isAlreadyExistsError(err2)) throw err2;
      }
    }

    // ─── Encode rows as Apache Arrow IPC ──────────────────────────────
    const arrow = await import("apache-arrow");
    const vectors: Record<string, unknown> = {};
    for (const [col, sqlType] of Object.entries(columnTypes)) {
      const colValues = rows.map((r) => r[col]);
      let arrowType: unknown;
      switch (sqlType) {
        case "VARCHAR":
          arrowType = new arrow.Utf8();
          break;
        case "BINARY":
          arrowType = new arrow.Binary();
          break;
        case "BOOLEAN":
          arrowType = new arrow.Bool();
          break;
        case "TINYINT":
          arrowType = new arrow.Int8();
          break;
        case "SMALLINT":
          arrowType = new arrow.Int16();
          break;
        case "INT":
        case "INTEGER":
          arrowType = new arrow.Int32();
          break;
        case "BIGINT":
          arrowType = new arrow.Int64();
          break;
        case "TIMESTAMP":
          arrowType = new arrow.TimestampMillisecond();
          break;
        default:
          throw new Error(
            `Unsupported SQL type "${sqlType}" on column ${col}. DECIMAL75 needs a custom encoder; ` +
              "publish that column through the chain.spaceandtime.io UI.",
          );
      }
      // Coerce strings to the JS types Arrow's typed builders expect. Skipping
      // this silently corrupts BOOLEAN columns and throws on TIMESTAMP.
      const coerced = coerceValues(colValues, sqlType, col);
      vectors[col] = arrow.vectorFromArray(coerced as never, arrowType as never);
    }
    const arrowTable = new arrow.Table(vectors as never);
    const ipc = arrow.tableToIPC(arrowTable);

    // ─── Submit indexing.submitData ───────────────────────────────────
    const indexingPallet = api.tx["indexing"] as { submitData?: unknown } | undefined;
    if (typeof indexingPallet?.submitData !== "function") {
      // Table created but data submission unavailable — return partial success
      // with a hint to use the chain.spaceandtime.io UI for the data load.
      return {
        partial: true,
        namespace,
        table,
        tableRef: `${namespace}.${table}`,
        rowsParsed: rows.length,
        bytesEncoded: ipc.byteLength,
        createTxHash,
        alreadyExisted,
        network: network.network,
        notes: [
          "Table created (or already existed) but indexing.submitData is not available on this chain runtime.",
          "Load the encoded IPC data via the chain.spaceandtime.io UI manually.",
          "Schema: " + namespace,
          "Table:  " + table,
        ],
      };
    }

    const indexingTx = api.tx["indexing"] as unknown as {
      submitData: (
        ident: { namespace: string; name: string },
        batchId: string,
        ipcHex: string,
      ) => SubstrateExtrinsic;
    };

    const batchId = "0x" + BigInt(Date.now()).toString(16).padStart(16, "0");
    const insertTx = indexingTx.submitData(
      { namespace, name: table },
      batchId,
      "0x" + Buffer.from(ipc).toString("hex"),
    );

    // Write the inferred schema next to the caller's own CSV, matching what
    // publish-dataset-cli.mjs produces. This is what makes the pipeline
    // schema-agnostic: save-proof-plans.mjs and render-onchain-query.mjs both
    // read this artifact.
    //
    // Isolation: the target is derived from the caller's input path, so each
    // user's artifact lands in their own directory. The server keeps no shared
    // handoff file, and a failed write never fails the publish — the schema is
    // also returned inline in the response.
    let schemaPath: string | null = null;
    try {
      const target = args.file.replace(/\.csv$/i, "") + ".inferred-schema.json";
      await writeFile(
        target,
        JSON.stringify(
          { table: `${namespace}.${table}`, network: network.network, columns: columnTypes },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      schemaPath = target;
    } catch (err) {
      logger.debug(`schema writeout skipped: ${err instanceof Error ? err.message : err}`);
    }

    let insertTxHash: string;
    try {
      insertTxHash = await submitTx(
        "indexing.submitData",
        insertTx,
        signer,
        signer.address,
        api as unknown as ApiLike,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Insert failed: ${msg}. The table was created — load data via chain.spaceandtime.io UI ` +
          `(Schema: ${namespace}, Table: ${table}) if your account lacks IndexingPallet.SubmitDataForPrivilegedQuorum.`,
      );
    }

    // ─── Success ──────────────────────────────────────────────────────
    return {
      partial: false,
      namespace,
      table,
      tableRef: `${namespace}.${table}`,
      rowsPublished: rows.length,
      bytesPublished: ipc.byteLength,
      transactions: {
        createBatch: createTxHash,
        insert: insertTxHash,
        batchId,
      },
      alreadyExisted,
      network: network.network,
      schema: columnTypes,
      schemaPath,
      nextStep:
        `Compile this table into an on-chain proof plan with sxt.generate_proof_plan, using ` +
        `mainnet: ${args.mainnet} to match where it was published.`,
      verifyHint:
        `Use sxt.run_proven_query with tableRef "${namespace}.${table}" and ` +
        `sql "${buildVerifySql(namespace, table, columnTypes, rows)}". ` +
        "Note: do NOT verify with SELECT COUNT(*) — aggregates currently fail at the prover " +
        "(null AttestedCommitments). Use a point lookup like the one above.",
    };
  } finally {
    await api.disconnect();
  }
}
