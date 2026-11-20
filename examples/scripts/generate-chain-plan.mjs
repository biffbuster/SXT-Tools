#!/usr/bin/env node
/**
 * generate-chain-plan.mjs
 *
 * Build an EVM proof plan for a SELECT against any provable table on the SXT
 * catalog: SXT-indexed chain tables (ETHEREUM.BLOCKS) or tables other users
 * published (find them with `sxt tables`). The trust-minimizing counterpart
 * to save-proof-plans.mjs, which works on the table you published yourself.
 *
 * Key differences vs save-proof-plans.mjs:
 *   1. No CSV / schema file required — the table's commitments live on
 *      SXT chain catalog directly, addressed by literal ref like
 *      "ETHEREUM.BLOCKS" or "PREFIX_<WALLET HEX>.TABLE".
 *   2. Supports parameterised plans (`$1`, `$2`, …) so a single deployed
 *      contract can prove arbitrary wallet/block combos at call time,
 *      not just one baked-in value.
 *   3. Reads the table's columns live (lib/plan-columns.mjs: SELECT * on
 *      commitments_v1_evmProofPlan). A table with no commitments returns
 *      chain error 254018 and is refused before anything else runs.
 *
 * Usage:
 *   node generate-chain-plan.mjs \
 *     --table ETHEREUM.BLOCKS \
 *     --predicate "BLOCK_NUMBER = \$1" \
 *     --param-types BIGINT \
 *     --projection "BLOCK_NUMBER, TRANSACTION_COUNT" \
 *     --name block-finality \
 *     [--out ./examples/data/proof-plans/block-finality.json]
 *
 * Sensible defaults (so a tutorial can run end-to-end with one flag):
 *   --projection defaults to "COUNT(*)" (single BIGINT result). The off-chain
 *     prover failed a whole-table COUNT(*) on 2026-11-17, so pre-flight the
 *     filtered count with `sxt verify --sql` before deploying a contract.
 *   --name defaults to a slug of the predicate
 *   --out defaults to ../data/proof-plans/<name>.json
 *   --param-types defaults to empty (literal SQL with no placeholders)
 *
 * Output: a JSON artifact that `render-onchain-query.mjs --params` consumes
 * to render a contract whose `query()` accepts the parameter values at
 * call time and emits a proven result event in its callback.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { describeTable, NOT_COMMITTED } from './lib/plan-columns.mjs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.SXT_RPC_HTTP ?? 'https://rpc.mainnet.sxt.network';

// ─── Table metadata ───────────────────────────────────────────────────
// Columns come from the live catalog (lib/plan-columns.mjs), so any provable
// table works. These only add a description for well-known tables.
const TABLE_DESCRIPTIONS = {
  'ETHEREUM.BLOCKS': 'Ethereum mainnet block index (zk-verified).',
  'ETHEREUM.NATIVE_WALLETS': 'Ethereum wallet ETH balances by block (zk-verified).',
  'ETHEREUM.ERC173_OWNERSHIP_TRANSFERRED': 'ERC-173 ownership transfer events (zk-verified).',
};

// Tables that plan but whose proofs currently fail at the SXT prover. A
// contract built on one would lock 100 SXT per query() until the 1-hour
// timeout, so the plan is refused unless --force is passed.
// Same list as the MCP's UNSTABLE_TABLES (packages/mcp/sxt-mcp/src/tools/catalog.ts).
const UNSTABLE_TABLES = {
  'ETHEREUM.TRANSACTIONS':
    'proofs against it fail at the SXT prover ("Query execution failed", 2026-11-10 and 2026-11-16)',
  ...Object.fromEntries(
    ['CONTRACTS', 'TOKEN_ERC20_CONTRACTS', 'NFT_ERC721_CONTRACTS', 'NFT_ERC1155_CONTRACTS', 'NFT_ERC721_APPROVAL',
      'NFT_ERC721_APPROVAL_FOR_ALL', 'NFT_ERC721_OWNERS', 'NFT_ERC1155_OWNERS', 'NFT_ERC721_TRANSFER', 'NFT_ERC1155_TRANSFER'].map((t) => [
      `ETHEREUM.${t}`,
      'proofs against it fail at the SXT prover ("Query execution failed"), even with a narrow WHERE filter (2026-11-19)',
    ]),
  ),
};

// The renderer (render-onchain-query.mjs) names the byte type BINARY; the
// chain catalog reports VARBINARY. Same type.
const RENDERER_TYPE = (t) => (t === 'VARBINARY' ? 'BINARY' : t);

// ─── Argument parsing ─────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    table: null,
    predicate: null,
    projection: 'COUNT(*)',
    paramTypes: [],
    name: null,
    out: null,
    force: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--table') args.table = argv[++i];
    else if (a === '--predicate') args.predicate = argv[++i];
    else if (a === '--projection') args.projection = argv[++i];
    else if (a === '--param-types') args.paramTypes = argv[++i].split(',').map((s) => RENDERER_TYPE(s.trim().toUpperCase()));
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function printUsage() {
  console.error('Usage:');
  console.error('  node generate-chain-plan.mjs --table <REF> [--predicate "<SQL>"] [--projection "<EXPR>"] [--param-types T1,T2] [--name NAME] [--out PATH]');
  console.error('');
  console.error('Any provable table works: SXT chain tables or tables other users published.');
  console.error('Find one with  sxt tables  and check its columns with  sxt tables --describe <REF>');
  console.error('');
  console.error('Examples:');
  console.error('  # L1 block finality proof');
  console.error('  --table ETHEREUM.BLOCKS --predicate "BLOCK_NUMBER = \\$1" --param-types BIGINT \\');
  console.error('    --projection "BLOCK_NUMBER, TRANSACTION_COUNT" --name block-finality');
  console.error('');
  console.error('  # Membership in a community table');
  console.error('  --table PREFIX_<WALLET HEX>.TABLE --predicate "NAME = \\$1" --param-types VARCHAR \\');
  console.error('    --projection "NAME" --name membership');
  console.error('');
  console.error('Param types: VARCHAR, BIGINT, INT, SMALLINT, TINYINT, BOOLEAN, TIMESTAMP, VARBINARY (alias BINARY).');
  console.error('DECIMAL and TIMESTAMP columns cannot be compared in WHERE on the live prover.');
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
  if (UNSTABLE_TABLES[tableRef] && !args.force) {
    console.error(`✗ ${tableRef}: ${UNSTABLE_TABLES[tableRef]}.`);
    console.error('  A contract built on it would lock 100 SXT per query() until the 1-hour timeout.');
    console.error('  Pass --force to generate the plan anyway.');
    process.exit(1);
  }
  const live = await describeTable(tableRef);
  if (!live.provable) {
    if (live.error.code === NOT_COMMITTED) {
      console.error(`✗ Table "${tableRef}" is not provable: it is not in the catalog or has no HyperKZG commitments.`);
      console.error('  Many ETHEREUM.* / BASE.* tables in SXT Studio are indexed for analytics SQL only.');
      console.error('  List provable candidates with  sxt tables  (check one with  sxt tables --describe <REF>).');
    } else {
      console.error(`✗ Chain RPC returned error ${live.error.code}: ${live.error.message}`);
    }
    process.exit(1);
  }

  const tableDef = {
    columns: Object.fromEntries(live.columns.map((c) => [c.name, RENDERER_TYPE(c.type)])),
    description: TABLE_DESCRIPTIONS[tableRef] ?? `Provable table ${tableRef} (columns read live).`,
  };

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
  if (/\b(COUNT|SUM)\s*\(/i.test(args.projection) && !/\bGROUP\s+BY\b/i.test(sql)) {
    console.log('⚠ Ungrouped aggregate projection. The off-chain prover failed a whole-table COUNT(*) on');
    console.log('  2026-11-17. Pre-flight the exact SQL with  sxt verify --sql "..."  (literal values in');
    console.log('  place of $1, $2) before deploying a contract that spends 100 SXT per query().');
    console.log('');
  }
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

  console.log(`▶ Generating proof plan against provable table.`);
  console.log(`  Table:        ${tableRef}`);
  console.log(`  Projection:   ${args.projection}`);
  console.log(`  Predicate:    ${args.predicate ?? '(none)'}`);
  console.log(`  Parameters:   ${args.paramTypes.length ? args.paramTypes.join(', ') : '(none — literal SQL)'}`);
  console.log(`  Full SQL:     ${sql}`);
  console.log('');

  // Call the SXT chain RPC. Cold first connections can time out and then
  // succeed (slow resolver / IPv6-broken routes) — retry once before failing.
  let rpcRes;
  for (let attempt = 1; ; attempt++) {
    try {
      rpcRes = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: name,
          method: 'commitments_v1_evmProofPlan',
          params: { query: sql },
        }),
        signal: AbortSignal.timeout(30000),
      });
      break;
    } catch (err) {
      if (attempt >= 2) throw err;
      console.log('  · transient network error — retrying once…');
    }
  }
  const rpcJson = await rpcRes.json();

  if (rpcJson.error) {
    console.error(`✗ Chain RPC returned error ${rpcJson.error.code}: ${rpcJson.error.message}`);
    if (rpcJson.error.code === 254018) {
      console.error('');
      console.error('  Error code 254018 = "incomplete commitment coverage." The table exists');
      console.error('  in SXT\'s catalog (analytics SQL would work) but no HyperKZG commitment');
      console.error('  has been published for it yet.');
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
    description: `Proof plan against ${tableRef}: ${sql.replace(/\s+/g, ' ')}`,
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
  console.log(`      sxt verify --sql "<the SQL above, with literal values in place of $1, $2>"`);
  console.log('');
  console.log('  • Render the parameterized Solidity consumer (verified working):');
  console.log(`      node render-onchain-query.mjs --plan ${outPath} --name <ContractName> --params`);
  console.log('    → query(<type> param1, …) bound at call time — one deployed contract, any inputs.');
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
