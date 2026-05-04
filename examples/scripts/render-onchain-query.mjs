#!/usr/bin/env node
/**
 * Render src/<ContractName>/<ContractName>.sol from
 * templates/OnchainQuery.sol.template by substituting fields from a
 * proof-plan JSON and a schema JSON.
 *
 * Resolves the SELECT projection by parsing the plan's `sql` field, then
 * looks up each projected column in the schema. Aggregates (`COUNT(*)`,
 * `SUM(col)`) are mapped to BIGINT.
 *
 * Usage:
 *   node render-onchain-query.mjs                            # defaults below
 *   node render-onchain-query.mjs --plan PATH --schema PATH --name NAME
 *
 * Default plan:    ../data/proof-plans/point-lookup.json
 * Default schema:  ../data/sxt_stakers.schema.json
 * Default name:    OnchainQuery
 *
 * The repo's canonical demo contract `StakersQuery.sol` is hand-curated
 * and is NEVER overwritten by this renderer; runs always write to
 * src/OnchainQuery/ (or src/<name>/ if --name is passed).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAddress } from 'ethers';

const TEMPLATE = '../contracts/sxt-onchain-query/templates/OnchainQuery.sol.template';
const SRC_DIR  = '../contracts/sxt-onchain-query/src';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const PLAN_PATH   = arg('--plan',   '../data/proof-plans/point-lookup.json');
const SCHEMA_PATH = arg('--schema', '../data/sxt_stakers.schema.json');
const NAME_OVERRIDE = arg('--name', null);

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
if (!plan.proofPlan?.startsWith('0x')) throw new Error(`${PLAN_PATH} has no proofPlan`);
if (!plan.sql || !plan.table)         throw new Error(`${PLAN_PATH} missing sql/table`);
if (!schema.columns)                   throw new Error(`${SCHEMA_PATH} missing columns`);

// SQL → ProofOfSqlTable reader + Solidity element type
const READERS = {
  BOOLEAN:   { reader: 'readBooleanColumn',   solType: 'bool',    arrayType: 'bool[]'    },
  TINYINT:   { reader: 'readTinyIntColumn',   solType: 'int8',    arrayType: 'int8[]'    },
  SMALLINT:  { reader: 'readSmallIntColumn',  solType: 'int16',   arrayType: 'int16[]'   },
  INT:       { reader: 'readIntColumn',       solType: 'int32',   arrayType: 'int32[]'   },
  INTEGER:   { reader: 'readIntColumn',       solType: 'int32',   arrayType: 'int32[]'   },
  BIGINT:    { reader: 'readBigIntColumn',    solType: 'int64',   arrayType: 'int64[]'   },
  VARCHAR:   { reader: 'readVarCharColumn',   solType: 'string',  arrayType: 'string[]'  },
  TIMESTAMP: { reader: 'readTimeStampColumn', solType: 'int64',   arrayType: 'int64[]'   },
  BINARY:    { reader: 'readVarBinaryColumn', solType: 'bytes',   arrayType: 'bytes[]'   },
};

// Parse SELECT projection from SQL.
// Handles:  SELECT <col>, COUNT(*) AS N, SUM(<col>) AS total FROM ...
function parseProjection(sql) {
  const m = sql.match(/SELECT\s+(.+?)\s+FROM\s+/is);
  if (!m) throw new Error('Could not extract SELECT projection from SQL');
  return m[1].split(/,(?![^()]*\))/).map(seg => seg.trim()).map(parseColumnExpr);
}

function parseColumnExpr(expr) {
  const aliasMatch = expr.match(/^(.+?)\s+AS\s+([A-Z_][A-Z0-9_]*)$/i);
  const aliased = aliasMatch ? aliasMatch[2].toUpperCase() : null;
  const body = aliasMatch ? aliasMatch[1].trim() : expr;

  if (/^COUNT\s*\(\s*\*\s*\)$/i.test(body)) {
    return { name: aliased ?? 'CNT', sqlType: 'BIGINT', source: 'COUNT(*)' };
  }
  const sumMatch = body.match(/^SUM\s*\(\s*([A-Z_][A-Z0-9_]*)\s*\)$/i);
  if (sumMatch) {
    return { name: aliased ?? `SUM_${sumMatch[1].toUpperCase()}`, sqlType: 'BIGINT', sourceCol: sumMatch[1].toUpperCase() };
  }
  if (/^[A-Z_][A-Z0-9_]*$/i.test(body)) {
    return { name: aliased ?? body.toUpperCase(), sqlType: null, sourceCol: body.toUpperCase() };
  }
  throw new Error(`Unsupported SELECT expression: "${expr}"`);
}

// Resolve sqlType for projected columns by looking up sourceCol in schema.
function resolveTypes(projection, schemaColumns) {
  const upperSchema = Object.fromEntries(
    Object.entries(schemaColumns).map(([k, v]) => [k.toUpperCase(), String(v).toUpperCase().split('(')[0]]),
  );
  return projection.map(p => {
    if (p.sqlType) return p;
    const t = upperSchema[p.sourceCol];
    if (!t) throw new Error(`Column ${p.sourceCol} not in schema`);
    return { ...p, sqlType: t };
  });
}

const projection = resolveTypes(parseProjection(plan.sql), schema.columns);
projection.forEach((col, i) => {
  const r = READERS[col.sqlType];
  if (!r) throw new Error(`No reader mapping for SQL type ${col.sqlType} (column ${col.name})`);
  Object.assign(col, { reader: r.reader, solType: r.solType, arrayType: r.arrayType, varName: `_col${i}` });
});

// The hand-curated `StakersQuery.sol` is the canonical demo contract and
// must not be clobbered by re-renders. Default to "OnchainQuery"; the
// caller can pass --name to render under any other identifier (still
// rejected if it equals "StakersQuery").
const contractName = NAME_OVERRIDE ?? 'OnchainQuery';
if (contractName === 'StakersQuery') {
  console.error('✗ Refusing to render to StakersQuery — that contract is hand-curated for the canonical demo.');
  console.error('  Pass a different --name (e.g. --name MyQuery) or omit it to default to OnchainQuery.');
  process.exit(1);
}

// Generate the rendered blocks.
const decodeBlock = projection
  .map(c => `        ${c.arrayType} memory ${c.varName} = ProofOfSqlTable.${c.reader}(tableResult, ${projection.indexOf(c)});`)
  .join('\n');
const eventParams = projection.map(c => `${c.solType} ${c.name.toLowerCase()}`).join(', ');
const rowFields = projection.map(c => `${c.varName}[i]`).join(', ');
const rowCountExpr = `${projection[0].varName}.length`;
const callbackGasLimit = `${100_000 + projection.length * 20_000}`;

const tpl = readFileSync(TEMPLATE, 'utf8');
const rendered = tpl
  .replaceAll('__CONTRACT_NAME__', contractName)
  .replaceAll('__QUERY_PLAN_HEX__', plan.proofPlan.slice(2))
  .replaceAll('__TABLE_REFERENCE__', plan.table)
  .replaceAll('__SQL_TEXT__', plan.sql)
  .replaceAll('__CHAIN_STATE_AT__', plan.chainStateAt ?? '<unknown>')
  .replaceAll('__EVENT_PARAMS__', eventParams)
  .replaceAll('__COLUMN_DECODE_BLOCK__', decodeBlock)
  .replaceAll('__ROW_COUNT_EXPR__', rowCountExpr)
  .replaceAll('__ROW_FIELDS__', rowFields)
  .replaceAll('__CALLBACK_GAS_LIMIT__', callbackGasLimit);

const outDir = `${SRC_DIR}/${contractName}`;
const outPath = `${outDir}/${contractName}.sol`;
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, rendered);

// Record what was last rendered so deploy / query scripts know which forge
// artifact to read. Format kept minimal so other tooling can extend it.
const STATE = '../contracts/sxt-onchain-query/.last-rendered.json';
writeFileSync(STATE, JSON.stringify({
  contractName,
  table: plan.table,
  planPath: PLAN_PATH,
  schemaPath: SCHEMA_PATH,
  renderedAt: new Date().toISOString(),
}, null, 2) + '\n');

console.log(`Rendered ${outPath}`);
console.log(`  Contract:        ${contractName}`);
console.log(`  Table:           ${plan.table}`);
console.log(`  Chain state at:  ${plan.chainStateAt}`);
console.log(`  Projection:      ${projection.map(c => `${c.name}: ${c.sqlType}`).join(', ')}`);
console.log(`  QUERY_PLAN:      ${(plan.proofPlan.length - 2) / 2} bytes`);
console.log(`  Callback gas:    ${callbackGasLimit}`);
console.log(``);
console.log(`Next: cd ../contracts/sxt-onchain-query && forge build`);
