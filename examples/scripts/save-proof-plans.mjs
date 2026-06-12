#!/usr/bin/env node
/**
 * Build EVM proof plans for a published SXT table by calling
 * `commitments_v1_evmProofPlan` on the SXT chain RPC. Writes one JSON
 * artifact per query to examples/data/proof-plans/.
 *
 * SCHEMA-AWARE: discovers your table's columns from a schema JSON and
 * picks a sensible lookup column automatically (the first VARCHAR), or
 * uses SXT_LOOKUP_COLUMN if set. Generates type-correct SQL literals
 * (quoted for VARCHAR, raw for BIGINT etc.) so the same script works
 * for any CSV the publish step has indexed.
 *
 * Pointing this at your own data:
 *   1. Run `publish-dataset-cli.mjs <csv> <PREFIX.TABLE>` — that step
 *      writes `<csv-base>.inferred-schema.json` next to your CSV.
 *   2. Set SXT_TABLE in .env to the full table reference printed by
 *      publish (PREFIX_<HEX>.TABLE).
 *   3. Set SXT_SCHEMA_PATH if your schema lives somewhere unusual.
 *      Default: `../data/sxt_stakers.schema.json` (matches the canonical
 *      demo) — if you used --fresh, the orchestrator passes the right
 *      path automatically.
 *   4. (Optional) Set SXT_LOOKUP_COLUMN if your schema has multiple
 *      VARCHAR columns and you want a specific one for the point-lookup
 *      membership proof. Default: first VARCHAR column.
 *   5. (Optional) Set SXT_POINT_LOOKUP to a value you expect IS in the
 *      table.
 *
 * Defaults preserve the canonical demo's behavior so re-running with no
 * env overrides reproduces the proof plans baked into the existing
 * StakersQuery.sol / OnchainQuery.sol contracts.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseCsv } from 'csv-parse/sync';
import { readLastPublish, planDirFor } from './lib/last-publish.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Resolution order (per skill design):
//   1. Explicit env var
//   2. .last-publish.json handoff (written by publish-dataset-cli.mjs)
//   3. Legacy canonical-demo default (so re-running with no args reproduces
//      the proof plans baked into StakersQuery.sol)
let handoff = readLastPublish();
// An indexed-sci handoff (written by index-contract.mjs) is not consumable by
// the CSV proof pipeline — SCI tables aren't zk-provable yet. Ignore it so
// env vars / legacy defaults win instead of resolving to an unprovable table.
if (handoff?.kind === 'indexed-sci') handoff = null;

const RPC = process.env.SXT_RPC_HTTP ?? 'https://rpc.mainnet.sxt.network';
const TABLE = process.env.SXT_TABLE
  ?? handoff?.tableRef
  ?? 'MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS';
const SCHEMA_PATH = process.env.SXT_SCHEMA_PATH
  ?? handoff?.schemaPath
  ?? resolvePath(HERE, '..', 'data', 'sxt_stakers.schema.json');
const LOOKUP_COLUMN_ENV = process.env.SXT_LOOKUP_COLUMN?.trim() ?? handoff?.lookupColumn ?? null;
const BASE_PLAN_DIR = resolvePath(HERE, '..', 'data', 'proof-plans');
// Per-dataset subdir so a second publish doesn't stomp the first user's
// plans. The canonical STAKERS demo writes to the root for back-compat.
const OUT_DIR = process.env.SXT_PLAN_DIR
  ? resolvePath(process.env.SXT_PLAN_DIR)
  : planDirFor(TABLE, BASE_PLAN_DIR);
mkdirSync(OUT_DIR, { recursive: true });
// POINT_LOOKUP is resolved after pickLookupColumn() runs — we need to know the
// chosen column before we can grab a sample value from the CSV. See the
// "auto-detect from CSV" block further down.
let POINT_LOOKUP = process.env.SXT_POINT_LOOKUP;

// ─── Schema discovery ─────────────────────────────────────────────────

if (!existsSync(SCHEMA_PATH)) {
  console.error(`✗ Schema file not found: ${SCHEMA_PATH}`);
  console.error('');
  console.error('  publish-dataset-cli.mjs writes <csv-base>.inferred-schema.json next');
  console.error('  to the CSV after a successful publish, and a handoff at');
  console.error('  examples/data/.last-publish.json so this script picks it up');
  console.error('  automatically. Either:');
  console.error('    • Run publish-dataset-cli.mjs first, or');
  console.error('    • Set SXT_SCHEMA_PATH to your schema JSON.');
  process.exit(1);
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
if (!schema.columns) {
  console.error(`✗ Schema at ${SCHEMA_PATH} missing "columns" field.`);
  process.exit(1);
}

// Normalize the schema map to UPPERCASE column name → base SQL type
// (strip parametric type widths like DECIMAL(38,10) for matching).
const COLUMNS = Object.fromEntries(
  Object.entries(schema.columns).map(([k, v]) => [
    k.toUpperCase(),
    String(v).toUpperCase().split('(')[0],
  ]),
);

function pickLookupColumn() {
  if (LOOKUP_COLUMN_ENV) {
    const upper = LOOKUP_COLUMN_ENV.toUpperCase();
    if (!(upper in COLUMNS)) {
      throw new Error(
        `SXT_LOOKUP_COLUMN="${LOOKUP_COLUMN_ENV}" not in schema. Available: ${Object.keys(COLUMNS).join(', ')}`,
      );
    }
    return { name: upper, type: COLUMNS[upper] };
  }
  // Default: first VARCHAR column (the common "identifier" pattern).
  const varcharCols = Object.entries(COLUMNS).filter(([, t]) => t === 'VARCHAR');
  if (varcharCols.length > 0) {
    return { name: varcharCols[0][0], type: 'VARCHAR' };
  }
  // No VARCHAR — fall back to first column of any type.
  const first = Object.entries(COLUMNS)[0];
  if (!first) throw new Error('Schema has zero columns — cannot select a lookup column.');
  return { name: first[0], type: first[1] };
}

const LOOKUP = pickLookupColumn();

// Auto-detect SXT_POINT_LOOKUP from the published CSV when the env isn't set.
// This makes the pipeline "just work" for any community CSV — the agent / user
// doesn't have to peek the file first to find a known membership value.
// Override via SXT_POINT_LOOKUP still wins (e.g. for a specific demo address).
let pointLookupSource = 'SXT_POINT_LOOKUP env var';
if (!POINT_LOOKUP) {
  // Find the CSV: handoff record wins, then DEMO_CSV env (set by the
  // orchestrator), then the schema-path-derived guess as last resort.
  const csvPath = handoff?.csvPath ?? process.env.DEMO_CSV ?? SCHEMA_PATH
    .replace(/\.inferred-schema\.json$/i, '.csv')
    .replace(/\.schema\.json$/i, '.csv');
  if (existsSync(csvPath)) {
    try {
      const rows = parseCsv(readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true });
      if (rows.length > 0) {
        // Find the row-key matching our lookup column (case-insensitive).
        const keys = Object.keys(rows[0]);
        const matchKey = keys.find((k) => k.toUpperCase() === LOOKUP.name);
        if (matchKey && rows[0][matchKey]) {
          POINT_LOOKUP = String(rows[0][matchKey]).trim();
          pointLookupSource = `auto-picked from row 1 of ${csvPath}`;
        }
      }
    } catch (_) { /* fall through to legacy default below */ }
  }
}
if (!POINT_LOOKUP) {
  POINT_LOOKUP = '0x45c56e138881fd3ff46359ba1826d5fc6fccaedc';
  pointLookupSource = 'legacy STAKERS default — set SXT_POINT_LOOKUP or DEMO_CSV';
}

// Format the lookup value as a SQL literal correct for the column type.
function formatLiteral(value, sqlType) {
  switch (sqlType) {
    case 'VARCHAR':
    case 'BINARY':
      return `'${String(value).replace(/'/g, "''")}'`;
    case 'BOOLEAN':
      return /^true$/i.test(String(value)) ? 'TRUE' : 'FALSE';
    case 'TIMESTAMP':
      return `TIMESTAMP '${String(value)}'`;
    default:
      // Numeric types (TINYINT/SMALLINT/INT/INTEGER/BIGINT/DECIMAL)
      return String(value);
  }
}

// The "negative" sentinel value for non-membership proofs needs to be a
// value that's plausibly NOT in the table. Zero-address for VARCHAR (the
// canonical demo), or 0 for numeric types.
function negativeLiteral(sqlType) {
  switch (sqlType) {
    case 'VARCHAR':
      return `'0x0000000000000000000000000000000000000000'`;
    case 'BINARY':
      return `'\\x00'`;
    case 'BOOLEAN':
      return 'FALSE';
    default:
      return '-1'; // unlikely to be a real ID in most numeric schemas
  }
}

const lookupLiteral = formatLiteral(POINT_LOOKUP, LOOKUP.type);
const notInLiteral = negativeLiteral(LOOKUP.type);

const lookupSource = process.env.SXT_LOOKUP_COLUMN
  ? 'from SXT_LOOKUP_COLUMN'
  : handoff?.lookupColumn
    ? 'from .last-publish.json handoff'
    : 'auto-picked first VARCHAR';
console.log(`  Schema:          ${SCHEMA_PATH}`);
console.log(`  Table:           ${TABLE}${handoff && !process.env.SXT_TABLE ? ' [from .last-publish.json]' : ''}`);
console.log(`  Lookup column:   ${LOOKUP.name} (${LOOKUP.type}) [${lookupSource}]`);
console.log(`  Lookup value:    ${lookupLiteral}  [${pointLookupSource}]`);
console.log(`  Output dir:      ${OUT_DIR}`);
console.log('');

// ─── Plans ────────────────────────────────────────────────────────────

// To customize beyond the canonical membership/count/non-membership
// shapes (e.g. GROUP BY, JOIN, SUM with WHERE), edit the SQL below.
// The renderer + Solidity template handle arbitrary SELECT projections
// with COUNT(*) + SUM(col) aggregates already.
const plans = [
  {
    name: 'point-lookup',
    description: `Verify a specific ${LOOKUP.type} value is in column ${LOOKUP.name} of the table (positive membership proof).`,
    sql: `SELECT ${LOOKUP.name} FROM ${TABLE} WHERE ${LOOKUP.name} = ${lookupLiteral}`,
  },
  {
    name: 'count',
    description: 'Verify the table has exactly the row count it was published with (cardinality proof).',
    sql: `SELECT COUNT(*) AS N FROM ${TABLE}`,
  },
  {
    name: 'negative-lookup',
    description: `Verify a sentinel ${LOOKUP.type} value is NOT in column ${LOOKUP.name} of the table (non-membership proof).`,
    sql: `SELECT ${LOOKUP.name} FROM ${TABLE} WHERE ${LOOKUP.name} = ${notInLiteral}`,
  },
];

for (const plan of plans) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: plan.name,
      method: 'commitments_v1_evmProofPlan',
      params: { query: plan.sql },
    }),
  });
  const json = await res.json();
  if (!json.result?.proofPlan) {
    console.error(`✗ ${plan.name}: no proofPlan in response — ${JSON.stringify(json).substring(0, 300)}`);
    continue;
  }
  const artifact = {
    name: plan.name,
    description: plan.description,
    table: TABLE,
    sql: plan.sql,
    lookupColumn: LOOKUP.name,
    lookupType: LOOKUP.type,
    proofPlan: json.result.proofPlan,
    chainStateAt: json.result.at,
    rpcEndpoint: RPC,
    generatedAt: new Date().toISOString(),
    proofPlanBytes: (json.result.proofPlan.length - 2) / 2,
    note: 'Drop the proofPlan into a Solidity contract as `bytes public constant QUERY_PLAN = hex"<plan-without-0x>";` then submit via IQueryRouter.requestQuery() per the SXT onchain_hello_world_query tutorial.',
  };
  const outPath = join(OUT_DIR, `${plan.name}.json`);
  writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n');
  console.log(`✓ ${outPath} (${artifact.proofPlanBytes} bytes plan, at ${artifact.chainStateAt?.substring(0, 14) ?? '?'}...)`);
}
