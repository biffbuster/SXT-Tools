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
 *   node render-onchain-query.mjs                            # auto-pick from handoff
 *   node render-onchain-query.mjs --plan PATH --schema PATH --name NAME
 *
 * Resolution order for plan + schema paths:
 *   1. Explicit --plan / --schema CLI flags
 *   2. examples/data/.last-publish.json handoff (written by publish-dataset-cli.mjs).
 *      Plan path is derived via planDirFor(<table>) — points at the proof-plans
 *      subdir that save-proof-plans.mjs writes for the active dataset.
 *   3. Legacy canonical-demo defaults (STAKERS) — preserved so the bundled
 *      demo arc keeps working with zero env / zero args.
 *
 * The repo's canonical demo contract `StakersQuery.sol` is hand-curated
 * and is NEVER overwritten by this renderer; runs always write to
 * src/OnchainQuery/ (or src/<name>/ if --name is passed).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress } from 'ethers';
import { readLastPublish, planDirFor } from './lib/last-publish.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_BASIC  = '../contracts/sxt-onchain-query/templates/OnchainQuery.sol.template';
const TEMPLATE_PARAMS = '../contracts/sxt-onchain-query/templates/OnchainQueryParameterized.sol.template';
const SRC_DIR  = '../contracts/sxt-onchain-query/src';
const BASE_PLAN_DIR  = resolvePath(HERE, '..', 'data', 'proof-plans');
const LEGACY_PLAN    = resolvePath(HERE, '..', 'data', 'proof-plans', 'point-lookup.json');
const LEGACY_SCHEMA  = resolvePath(HERE, '..', 'data', 'sxt_stakers.schema.json');

// SQL → ParamsBuilder mapping. Matches the canonical SXT ParamsBuilder
// API at sxt-proof-of-sql-0.123.10/src/client/ParamsBuilder.post.sol —
// see SDK reference cited in the chain-data-query SKILL.md.
//   solType    = the user-facing function-arg type (use as `<solType> arg`)
//   structType = the same type but for struct fields (no `memory` keyword)
//   builder    = the ParamsBuilder method name to encode the value
const PARAM_BUILDERS = {
  VARCHAR:   { solType: 'string memory', structType: 'string', builder: 'varCharParam' },
  BIGINT:    { solType: 'int64',         structType: 'int64',  builder: 'bigIntParam' },
  INT:       { solType: 'int32',         structType: 'int32',  builder: 'intParam' },
  INTEGER:   { solType: 'int32',         structType: 'int32',  builder: 'intParam' },
  TINYINT:   { solType: 'int8',          structType: 'int8',   builder: 'tinyIntParam' },
  SMALLINT:  { solType: 'int16',         structType: 'int16',  builder: 'smallIntParam' },
  BOOLEAN:   { solType: 'bool',          structType: 'bool',   builder: 'boolParam' },
  TIMESTAMP: { solType: 'int64',         structType: 'int64',  builder: 'unixTimestampMillisParam' },
  BINARY:    { solType: 'bytes memory',  structType: 'bytes',  builder: 'varBinaryParam' },
};

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// Resolve plan + schema using the handoff for forked users who just
// published their own CSV. Explicit flags always win.
let handoff = readLastPublish();
// An indexed-sci handoff (written by index-contract.mjs) is not consumable by
// the CSV proof pipeline — SCI tables aren't zk-provable yet. Ignore it so
// env vars / legacy defaults win instead of resolving to an unprovable table.
if (handoff?.kind === 'indexed-sci') handoff = null;
const handoffPlanPath = handoff?.tableRef
  ? join(planDirFor(handoff.tableRef, BASE_PLAN_DIR), 'point-lookup.json')
  : null;

let planSource = 'default (canonical STAKERS demo)';
let schemaSource = 'default (canonical STAKERS demo)';
if (process.argv.includes('--plan')) planSource = '--plan flag';
else if (handoffPlanPath && existsSync(handoffPlanPath)) planSource = '.last-publish.json handoff';
if (process.argv.includes('--schema')) schemaSource = '--schema flag';
else if (handoff?.schemaPath && existsSync(handoff.schemaPath)) schemaSource = '.last-publish.json handoff';

const PLAN_PATH   = arg('--plan',   (handoffPlanPath && existsSync(handoffPlanPath)) ? handoffPlanPath : LEGACY_PLAN);
const SCHEMA_PATH = arg('--schema', (handoff?.schemaPath && existsSync(handoff.schemaPath)) ? handoff.schemaPath : LEGACY_SCHEMA);
const NAME_OVERRIDE = arg('--name', null);

if (!existsSync(PLAN_PATH)) {
  console.error(`✗ Proof plan not found: ${PLAN_PATH}`);
  console.error('');
  console.error('  Source attempted: ' + planSource);
  if (planSource.startsWith('.last-publish')) {
    console.error('  The handoff points at a per-dataset plan dir that does not yet exist.');
    console.error('  Run `node save-proof-plans.mjs` first to generate plans for the active dataset.');
  } else {
    console.error('  Run `node save-proof-plans.mjs` to generate the canonical demo plans,');
    console.error('  or pass --plan PATH to point at a specific plan JSON.');
  }
  process.exit(1);
}
if (!existsSync(SCHEMA_PATH)) {
  console.error(`✗ Schema not found: ${SCHEMA_PATH}`);
  console.error('  Source attempted: ' + schemaSource);
  console.error('  Run `node publish-dataset-cli.mjs <csv> <PREFIX.TABLE>` to write the inferred schema,');
  console.error('  or pass --schema PATH explicitly.');
  process.exit(1);
}

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
if (!plan.proofPlan?.startsWith('0x')) throw new Error(`${PLAN_PATH} has no proofPlan`);
if (!plan.sql || !plan.table)         throw new Error(`${PLAN_PATH} missing sql/table`);

// Indexed-chain plans (`kind: "indexed"`) embed the table schema directly
// in the plan artifact — no separate schema file required because the
// schema comes from SXT's chain catalog, not a user CSV. Fall back to
// reading the schema file for legacy CSV plans.
const isIndexedPlan = plan.kind === 'indexed';
const isParameterized = Array.isArray(plan.paramTypes) && plan.paramTypes.length > 0;

let schema;
if (isIndexedPlan && plan.tableSchema) {
  schema = { columns: plan.tableSchema };
} else {
  schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  if (!schema.columns) throw new Error(`${SCHEMA_PATH} missing columns`);
}

console.log(`  Plan:    ${PLAN_PATH}  [${planSource}]`);
console.log(`  Kind:    ${plan.kind ?? 'csv (legacy)'}${isParameterized ? `  (parameterized, ${plan.paramTypes.length} param${plan.paramTypes.length === 1 ? '' : 's'})` : ''}`);
console.log(`  Schema:  ${isIndexedPlan ? '(embedded in plan)' : `${SCHEMA_PATH}  [${schemaSource}]`}`);
console.log('');

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

// Solidity reserved keywords that can't be used as parameter names.
// Community CSVs may have columns like ADDRESS, STRING, BOOL, FROM, TO, etc.
// — those lowercase to reserved words and break `forge build`. Trailing-`_`
// is the idiomatic OpenZeppelin convention for shadowed identifiers.
const SOL_RESERVED = new Set([
  'address','bool','string','bytes','int','uint','fixed','ufixed',
  'mapping','struct','function','contract','event','modifier','enum',
  'library','interface','pragma','import','using','assembly',
  'return','returns','if','else','for','while','do','break','continue',
  'throw','assert','require','revert','this','super','new','delete',
  'var','let','try','catch','emit','payable','pure','view',
  'external','internal','private','public','constant','immutable',
  'memory','storage','calldata','indexed','anonymous','virtual','override',
  'abstract','final','unchecked','as','is','from','to','after',
  'true','false','null','wei','gwei','ether','seconds','minutes','hours','days','weeks',
]);
function safeParamName(raw) {
  const lower = raw.toLowerCase();
  if (SOL_RESERVED.has(lower)) return `${lower}_`;
  if (/^(int|uint)\d+$/.test(lower)) return `${lower}_`;
  if (/^bytes([1-9]|[12]\d|3[0-2])$/.test(lower)) return `${lower}_`;
  return lower;
}

// Resolve input parameters (parameterized plans only). Derive argument
// names from the SQL predicate so the BaseScan event log is self-
// describing — e.g. `FROM_ADDRESS = $1` → arg name `from_address`,
// `BLOCK_NUMBER >= $2` → `block_number`. Falls back to `arg0`, `arg1`
// if a placeholder can't be matched to a column.
function deriveInputParams() {
  if (!isParameterized) return [];
  const predicate = plan.predicate ?? plan.sql;
  const matches = [...predicate.matchAll(/\b([A-Z][A-Z0-9_]*)\s*(?:=|>=?|<=?|<>|!=|\bIN\b|\bBETWEEN\b)\s*\$(\d+)/gi)];
  const byIndex = {};
  for (const m of matches) {
    const idx = Number(m[2]);
    if (!byIndex[idx]) byIndex[idx] = m[1].toUpperCase();
  }
  return plan.paramTypes.map((t, i) => {
    const upper = String(t).toUpperCase();
    const builder = PARAM_BUILDERS[upper];
    if (!builder) {
      throw new Error(`Unsupported param type "${t}" — supported: ${Object.keys(PARAM_BUILDERS).join(', ')}`);
    }
    const colName = byIndex[i + 1] ?? `arg${i}`;
    return {
      paramIndex: i,
      placeholder: `$${i + 1}`,
      sqlType: upper,
      argName: safeParamName(colName),
      solType: builder.solType,
      structType: builder.structType,
      builder: builder.builder,
    };
  });
}

const inputParams = deriveInputParams();

// Generate the rendered blocks.
const decodeBlock = projection
  .map(c => `        ${c.arrayType} memory ${c.varName} = ProofOfSqlTable.${c.reader}(tableResult, ${projection.indexOf(c)});`)
  .join('\n');

// Event params: input params echo first (so BaseScan shows what was asked),
// then the proven output columns. For non-parameterized contracts the
// input list is empty and this collapses to the legacy behavior.
const projectionEventParams = projection.map(c => `${c.solType} ${safeParamName(c.name)}`);
const inputEventParams = inputParams.map(p => `${p.structType} ${p.argName}`);
const eventParams = [...inputEventParams, ...projectionEventParams].join(', ');

const projectionRowFields = projection.map(c => `${c.varName}[i]`);
const inputCtxFields = inputParams.map(p => `ctx.${p.argName}`);
const rowFields = [...inputCtxFields, ...projectionRowFields].join(', ');

const rowCountExpr = `${projection[0].varName}.length`;
const callbackGasLimit = `${100_000 + projection.length * 20_000 + inputParams.length * 5_000}`;

// Parameterized-only slots. Empty strings for non-parameterized template.
const queryFnArgs = inputParams.map(p => `${p.solType} ${p.argName}`).join(', ');
const paramCount = String(inputParams.length);
const paramBuilderCalls = inputParams
  .map(p => `        paramArr[${p.paramIndex}] = ParamsBuilder.${p.builder}(${p.argName});`)
  .join('\n');
const callbackContextFields = inputParams
  .map(p => `        ${p.structType} ${p.argName};`)
  .join('\n');
const callbackContextInit = inputParams.length
  ? ',\n' + inputParams.map(p => `            ${p.argName}: ${p.argName}`).join(',\n')
  : '';
const emptyEventExtraParams = inputParams.length
  ? ', ' + inputParams.map(p => `${p.structType} ${p.argName}`).join(', ')
  : '';
const emptyEventInitFields = inputParams.length
  ? ', ' + inputParams.map(p => `ctx.${p.argName}`).join(', ')
  : '';

// Pick template based on whether the plan is parameterized.
const TEMPLATE_PATH = isParameterized ? TEMPLATE_PARAMS : TEMPLATE_BASIC;
const tpl = readFileSync(TEMPLATE_PATH, 'utf8');
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
  .replaceAll('__CALLBACK_GAS_LIMIT__', callbackGasLimit)
  // Parameterized-only slots (no-op for the basic template).
  .replaceAll('__QUERY_FN_ARGS__', queryFnArgs)
  .replaceAll('__PARAM_COUNT__', paramCount)
  .replaceAll('__PARAM_BUILDER_CALLS__', paramBuilderCalls)
  .replaceAll('__CALLBACK_CONTEXT_FIELDS__', callbackContextFields)
  .replaceAll('__CALLBACK_CONTEXT_INIT__', callbackContextInit)
  .replaceAll('__EMPTY_EVENT_EXTRA_PARAMS__', emptyEventExtraParams)
  .replaceAll('__EMPTY_EVENT_INIT_FIELDS__', emptyEventInitFields);

const outDir = `${SRC_DIR}/${contractName}`;
const outPath = `${outDir}/${contractName}.sol`;
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, rendered);

// Record what was last rendered so deploy / query scripts know which forge
// artifact to read. Format kept minimal so other tooling can extend it.
// For parameterized plans we also persist the input-param spec so
// query-onchain.mjs can encode CLI args correctly without re-parsing the
// plan or the rendered Solidity source.
const STATE = '../contracts/sxt-onchain-query/.last-rendered.json';
writeFileSync(STATE, JSON.stringify({
  contractName,
  table: plan.table,
  planPath: PLAN_PATH,
  schemaPath: isIndexedPlan ? null : SCHEMA_PATH,
  parameterized: isParameterized,
  inputParams: inputParams.map(p => ({ name: p.argName, sqlType: p.sqlType, solType: p.solType })),
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
