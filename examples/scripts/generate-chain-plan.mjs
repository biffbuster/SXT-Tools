#!/usr/bin/env node
/**
 * generate-chain-plan.mjs
 *
 * Build an EVM proof plan for a SELECT against an SXT-indexed *chain* table
 * (e.g. ETHEREUM.TRANSACTIONS, ETHEREUM.BLOCKS) — the trust-minimizing
 * counterpart to save-proof-plans.mjs, which works on user-published CSV
 * tables.
 *
 * Key differences vs save-proof-plans.mjs:
 *   1. No CSV / schema file required — the table's commitments live on
 *      SXT chain catalog directly, addressed by literal ref like
 *      "ETHEREUM.TRANSACTIONS" (no wallet-hex suffix).
 *   2. Supports parameterised plans (`$1`, `$2`, …) so a single deployed
 *      contract can prove arbitrary wallet/block combos at call time,
 *      not just one baked-in value.
 *   3. Restricts table refs to the empirically-confirmed zk-committed
 *      surface (see ZK_COMMITTED_TABLES). Probing un-committed tables
 *      returns chain error 254018 and wastes RPC quota.
 *
 * Usage:
 *   node generate-chain-plan.mjs \
 *     --table ETHEREUM.TRANSACTIONS \
 *     --predicate "FROM_ADDRESS = \$1 AND BLOCK_NUMBER >= \$2" \
 *     --param-types VARCHAR,BIGINT \
 *     --projection "COUNT(*)" \
 *     --name wallet-activity \
 *     [--out ./examples/data/proof-plans/wallet-activity.json]
 *
 * Sensible defaults (so a tutorial can run end-to-end with one flag):
 *   --projection defaults to "COUNT(*)" (always provable, single BIGINT result)
 *   --name defaults to a slug of the predicate
 *   --out defaults to ../data/proof-plans/<name>.json
 *   --param-types defaults to empty (literal SQL with no placeholders)
 *
 * Output: a JSON artifact that `render-onchain-query.mjs --params` consumes
 * to render a contract whose `query()` accepts the parameter values at
 * call time and emits a proven result event in its callback.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.SXT_RPC_HTTP ?? 'https://rpc.mainnet.sxt.network';

// ─── ZK-committed surface (validated empirically 2026-06-01) ──────────
// The SXT Studio catalog advertises ~22 indexed chain tables, but only
// this subset has HyperKZG commitments and therefore returns a valid
// proof plan from `commitments_v1_evmProofPlan`. Probing other tables
// returns chain error 254018: "tables do not exist or have incomplete
// commitment coverage for all schemes". See memory:
// feedback_zk_committed_surface_narrow.md.
const ZK_COMMITTED_TABLES = {
  'ETHEREUM.BLOCKS': {
    // Columns derived from successful proof plans against this table.
    // Update as SXT publishes more.
    columns: {
      BLOCK_NUMBER: 'BIGINT',
    },
    description: 'Ethereum mainnet block index (zk-verified).',
  },
  'ETHEREUM.TRANSACTIONS': {
    // Schema discovered via deliberate error response from the chain
    // RPC (a query referencing a non-existent column returns the valid
    // column list). Types inferred from canonical SXT example queries.
    columns: {
      TIME_STAMP:        'TIMESTAMP',
      BLOCK_NUMBER:      'BIGINT',
      TRANSACTION_HASH:  'VARCHAR',
      TRANSACTION_INDEX: 'INT',
      TRANSACTION_FEE:   'BIGINT',
      FROM_ADDRESS:      'VARCHAR',
      TO_ADDRESS:        'VARCHAR',
    },
    description: 'Ethereum mainnet transaction index (zk-verified).',
  },
};

// ─── Argument parsing ─────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    table: null,
    predicate: null,
    projection: 'COUNT(*)',
    paramTypes: [],
    name: null,
    out: null,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--table') args.table = argv[++i];
    else if (a === '--predicate') args.predicate = argv[++i];
    else if (a === '--projection') args.projection = argv[++i];
    else if (a === '--param-types') args.paramTypes = argv[++i].split(',').map((s) => s.trim().toUpperCase());
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function printUsage() {
  console.error('Usage:');
  console.error('  node generate-chain-plan.mjs --table <REF> [--predicate "<SQL>"] [--projection "<EXPR>"] [--param-types T1,T2] [--name NAME] [--out PATH]');
  console.error('');
  console.error('Flagship demo (wallet activity prover):');
  console.error('  node generate-chain-plan.mjs \\');
  console.error('    --table ETHEREUM.TRANSACTIONS \\');
  console.error('    --predicate "FROM_ADDRESS = \\$1 AND BLOCK_NUMBER >= \\$2" \\');
  console.error('    --param-types VARCHAR,BIGINT \\');
  console.error('    --name wallet-activity');
  console.error('');
  console.error('Other ready-to-use queries against the zk-committed surface:');
  console.error('  # L1 transaction receipt proof');
  console.error('  --table ETHEREUM.TRANSACTIONS --predicate "TRANSACTION_HASH = \\$1" --param-types VARCHAR --name tx-receipt');
  console.error('');
  console.error('  # L1 block finality proof');
  console.error('  --table ETHEREUM.BLOCKS --predicate "BLOCK_NUMBER = \\$1" --param-types BIGINT --name block-finality');
  console.error('');
  console.error('Currently zk-committed tables (validated 2026-06-01):');
  for (const [ref, def] of Object.entries(ZK_COMMITTED_TABLES)) {
    console.error(`  • ${ref}  — ${def.description}`);
    console.error(`    columns: ${Object.keys(def.columns).join(', ')}`);
  }
  console.error('');
  console.error('Other ETHEREUM.* / BASE.* tables visible in the SXT Studio catalog');
  console.error('are NOT yet zk-committed (chain returns error 254018). Stick to the');
  console.error('list above until SXT expands commitment coverage.');
}

// ─── SQL validation against the proven surface ────────────────────────

const FORBIDDEN_PATTERNS = [
  { pattern: /\bORDER\s+BY\b/i, reason: 'ORDER BY is not provable' },
  { pattern: /\bDISTINCT\b/i, reason: 'DISTINCT is not provable' },
  { pattern: /\b(AVG|MIN|MAX)\s*\(/i, reason: 'AVG/MIN/MAX are not provable — use SUM + COUNT and divide client-side' },
  { pattern: /\bJOIN\b/i, reason: 'JOIN is not on the proven SQL surface — split into multiple proven queries' },
  { pattern: /\bUNION\b/i, reason: 'UNION is not provable' },
  { pattern: /\bHAVING\b/i, reason: 'HAVING is not provable' },
  { pattern: /\bWITH\b.*\bAS\b/i, reason: 'CTEs are not on the proven surface' },
  { pattern: /\bover\s*\(/i, reason: 'window functions (OVER ...) are not on the proven surface' },
];

function validateProvenSurface(sql) {
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(sql)) {
      throw new Error(`SQL outside the proven surface: ${reason}\n  query: ${sql}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.table) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const tableRef = args.table.toUpperCase();
  if (!(tableRef in ZK_COMMITTED_TABLES)) {
    console.error(`✗ Table "${tableRef}" is not in the zk-committed surface.`);
    console.error('');
    console.error('  The SXT Studio catalog advertises many indexed tables, but only a');
    console.error('  subset has HyperKZG commitments today (validated empirically). Using');
    console.error('  an un-committed table will fail with chain error 254018 — the table');
    console.error('  exists for analytics SQL but not for Proof of SQL.');
    console.error('');
    console.error('  Currently committed:');
    for (const ref of Object.keys(ZK_COMMITTED_TABLES)) {
      console.error(`    • ${ref}`);
    }
    console.error('');
    console.error('  Need a different table? Check periodically — SXT is rolling out');
    console.error('  commitments to the broader catalog over time. Or publish your own');
    console.error('  CSV via dataset-publish skill for full control of the data.');
    process.exit(1);
  }

  const tableDef = ZK_COMMITTED_TABLES[tableRef];

  // Validate referenced columns exist in the known schema.
  const wholeSql = `${args.projection}${args.predicate ? ` ${args.predicate}` : ''}`;
  for (const col of Object.keys(tableDef.columns)) {
    // Just here for the type-mapping later; no validation needed.
    void col;
  }
  const referencedColumns = [
    ...new Set(
      (wholeSql.match(/\b[A-Z][A-Z0-9_]*\b/g) ?? []).filter(
        (tok) => !['AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE', 'SELECT', 'FROM', 'WHERE', 'COUNT', 'SUM', 'AS', 'BETWEEN', 'IN', 'IS'].includes(tok),
      ),
    ),
  ];
  const unknownColumns = referencedColumns.filter((c) => !(c in tableDef.columns));
  if (unknownColumns.length > 0) {
    console.error(`✗ Predicate / projection references column(s) not in ${tableRef}: ${unknownColumns.join(', ')}`);
    console.error(`  Known columns: ${Object.keys(tableDef.columns).join(', ')}`);
    console.error('  (Heuristic check — uppercase identifiers in SQL are matched against the schema.)');
    process.exit(1);
  }

  // Build the full SQL.
  const sql = args.predicate
    ? `SELECT ${args.projection} FROM ${tableRef} WHERE ${args.predicate}`
    : `SELECT ${args.projection} FROM ${tableRef}`;

  validateProvenSurface(sql);

  // Validate parameter count matches the SQL placeholders.
  const placeholders = [...new Set((sql.match(/\$\d+/g) ?? []))];
  if (placeholders.length !== args.paramTypes.length) {
    console.error(`✗ Found ${placeholders.length} placeholder(s) (${placeholders.join(', ')}) but ${args.paramTypes.length} --param-types declared.`);
    console.error('  Each $1, $2, ... in the SQL needs a corresponding type in --param-types.');
    process.exit(1);
  }
  const allowedParamTypes = new Set(['VARCHAR', 'BIGINT', 'INT', 'INTEGER', 'BOOLEAN', 'BINARY', 'TIMESTAMP', 'TINYINT', 'SMALLINT']);
  for (const pt of args.paramTypes) {
    if (!allowedParamTypes.has(pt)) {
      console.error(`✗ Unknown --param-types entry "${pt}". Allowed: ${[...allowedParamTypes].join(', ')}`);
      process.exit(1);
    }
  }

  // Derive name + output path if not supplied.
  const name = args.name ?? sql
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const outPath = args.out
    ? resolvePath(args.out)
    : resolvePath(HERE, '..', 'data', 'proof-plans', `${name}.json`);

  console.log(`▶ Generating proof plan against zk-committed table.`);
  console.log(`  Table:        ${tableRef}`);
  console.log(`  Projection:   ${args.projection}`);
  console.log(`  Predicate:    ${args.predicate ?? '(none)'}`);
  console.log(`  Parameters:   ${args.paramTypes.length ? args.paramTypes.join(', ') : '(none — literal SQL)'}`);
  console.log(`  Full SQL:     ${sql}`);
  console.log('');

  // Call the SXT chain RPC.
  const rpcRes = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: name,
      method: 'commitments_v1_evmProofPlan',
      params: { query: sql },
    }),
  });
  const rpcJson = await rpcRes.json();

  if (rpcJson.error) {
    console.error(`✗ Chain RPC returned error ${rpcJson.error.code}: ${rpcJson.error.message}`);
    if (rpcJson.error.code === 254018) {
      console.error('');
      console.error('  Error code 254018 = "incomplete commitment coverage." The table exists');
      console.error('  in SXT\'s catalog (analytics SQL would work) but no HyperKZG commitment');
      console.error('  has been published for it yet. Stick to the validated zk-committed list.');
    } else if (rpcJson.error.code === 254017) {
      console.error('');
      console.error('  Error code 254017 = "schema error." Usually a misspelled column name.');
      console.error(`  Known columns for ${tableRef}: ${Object.keys(tableDef.columns).join(', ')}`);
    }
    process.exit(1);
  }

  if (!rpcJson.result?.proofPlan) {
    console.error('✗ RPC succeeded but returned no proofPlan field.');
    console.error('  Raw response:', JSON.stringify(rpcJson).slice(0, 300));
    process.exit(1);
  }

  const proofPlan = rpcJson.result.proofPlan;
  const chainStateAt = rpcJson.result.at;
  const proofPlanBytes = (proofPlan.length - 2) / 2;

  // Compose the artifact. `kind: "indexed"` distinguishes this from the CSV-
  // backed plans written by save-proof-plans.mjs; the renderer branches on it.
  const artifact = {
    kind: 'indexed',
    name,
    description: `Proof plan against zk-committed ${tableRef}: ${sql.replace(/\s+/g, ' ')}`,
    table: tableRef,
    tableDescription: tableDef.description,
    tableSchema: tableDef.columns,
    sql,
    projection: args.projection,
    predicate: args.predicate ?? null,
    paramTypes: args.paramTypes,
    proofPlan,
    chainStateAt,
    rpcEndpoint: RPC,
    generatedAt: new Date().toISOString(),
    proofPlanBytes,
    note: 'Drop the proofPlan into a Solidity contract as `bytes public constant QUERY_PLAN = hex"<plan-without-0x>";`. For parameterised plans, encode args via ParamsBuilder at call time. Submit via IQueryRouter.requestQuery() per the canonical SXT onchain example.',
  };

  // Ensure the output directory exists.
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n');

  console.log(`✓ Wrote proof plan to ${outPath}`);
  console.log(`  Plan size:        ${proofPlanBytes} bytes`);
  console.log(`  Chain state at:   ${chainStateAt?.slice(0, 18)}…`);
  console.log(`  Kind:             indexed (no schema file needed — schema embedded in plan)`);
  console.log('');
  console.log('Next steps:');
  console.log('  • Off-chain pre-flight (free, ~1s):');
  console.log(`      SXT_PLAN=${outPath} node verify-stakers.mjs --params "<arg1>[,<arg2>...]"`);
  console.log('');
  console.log('  • Render Solidity contract (once render-onchain-query.mjs --params support lands):');
  console.log(`      node render-onchain-query.mjs --plan ${outPath} --name <ContractName> --params`);
}

main().catch((err) => {
  console.error('');
  console.error('✗ Failed:');
  console.error(`  ${err.message}`);
  if (process.env.DEBUG && err.stack) {
    console.error('');
    console.error(err.stack);
  }
  process.exit(1);
});
