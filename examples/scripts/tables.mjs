#!/usr/bin/env node
/**
 * List and describe public tables on the SXT MAINNET catalog.
 *
 *   sxt tables                      every public community table (needs SXT_API_KEY)
 *   sxt tables iris                 filter by PREFIX.TABLE substring
 *   sxt tables --schema MY_SCHEMA   one namespace
 *   sxt tables --describe A.B       provable? + live columns (keyless)
 *   add --json for machine-readable output
 *
 * Listing uses the MakeInfinite discovery API, the same requests as the MCP
 * server's sxt.list_tables (packages/mcp/sxt-mcp/src/lib/discovery.ts):
 *   GET /v2/discover/schema?scope=PUBLIC&sourceNetwork=MAINNET&sxtOwned=false
 *   GET /v2/discover/table?scope=PUBLIC&sourceNetwork=MAINNET&schema=<S>
 * Both need a JWT from the free /auth/apikey exchange and spend no query
 * credit. There is no "all tables" call, so a full listing is one request per
 * schema (~90), sent four at a time.
 *
 * Describing compiles SELECT * on the chain RPC (lib/plan-columns.mjs): free,
 * keyless, and the same check the prover's catalog applies.
 */
import 'dotenv/config';
import { describeTable, NOT_COMMITTED } from './lib/plan-columns.mjs';

const PROVER = process.env.SXT_PROVER ?? 'https://api.makeinfinite.dev';
const AUTH = process.env.SXT_AUTH ?? 'https://proxy.api.makeinfinite.dev/auth/apikey';
const BASE = 'scope=PUBLIC&sourceNetwork=MAINNET';
const IDENT = /^[A-Z][A-Z0-9_]{0,127}$/;
const CONCURRENCY = 4;

// SXT-owned tables verified end to end (2026-11-19). The other ETHEREUM.*
// tables plan but fail at the prover or are unverified (see the MCP's
// UNSTABLE_TABLES and UNVERIFIED_TABLES).
const CURATED = ['ETHEREUM.BLOCKS', 'ETHEREUM.NATIVE_WALLETS', 'ETHEREUM.ERC173_OWNERSHIP_TRANSFERRED'];

function parseArgs(argv) {
  const args = { search: null, schema: null, describe: null, json: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--schema') args.schema = argv[++i]?.toUpperCase();
    else if (a === '--describe') args.describe = argv[++i]?.toUpperCase();
    else if (a === '--json') args.json = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (!a.startsWith('--')) args.search = a.toLowerCase();
  }
  return args;
}

async function describeCmd(tableRef, json) {
  if (!/^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/.test(tableRef ?? '')) {
    console.error('✗ --describe needs PREFIX.TABLE');
    process.exit(1);
  }
  const d = await describeTable(tableRef);
  if (json) {
    console.log(JSON.stringify({ table: tableRef, ...d }, null, 2));
    process.exit(d.provable ? 0 : 1);
  }
  if (!d.provable) {
    console.error(`✗ ${tableRef} is not provable${d.error.code === NOT_COMMITTED ? ': not in the catalog, or no proof commitments yet' : `: ${d.error.message}`}`);
    process.exit(1);
  }
  console.log(`✓ ${tableRef} is provable`);
  const pad = Math.max(...d.columns.map((c) => c.name.length)) + 2;
  for (const c of d.columns) console.log(`  ${c.name.padEnd(pad)}${c.type}`);
  const cols = d.columns.slice(0, 3).map((c) => c.name).join(', ');
  console.log('');
  console.log('  Prove a sample (free, 1 API quota tick):');
  console.log(`    sxt verify --sql "SELECT ${cols} FROM ${tableRef} LIMIT 5"`);
  if (d.columns.some((c) => c.type.startsWith('DECIMAL') || c.type === 'TIMESTAMP')) {
    console.log('  DECIMAL and TIMESTAMP columns can be selected but not compared in WHERE.');
  }
  if (d.columns.some((c) => c.type === 'VARBINARY')) {
    console.log("  VARBINARY literals are hex: X'ab12…' or 0xab12… unquoted.");
  }
}

async function getJson(path, token) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${PROVER}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`), { fatal: true });
      return await res.json();
    } catch (err) {
      if (err.fatal || attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
    }
  }
}

async function listCmd(args) {
  const apiKey = process.env.SXT_API_KEY ?? process.env.MAKEINFINITE_API_KEY;
  if (!apiKey) {
    console.error('✗ Listing public tables needs SXT_API_KEY in examples/scripts/.env (no query credit is spent).');
    console.error('  Without a key you can still check one table:  sxt tables --describe PREFIX.TABLE');
    process.exit(1);
  }
  const auth = await fetch(AUTH, { method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' } });
  if (!auth.ok) {
    console.error(`✗ SXT rejected the API key (HTTP ${auth.status}).`);
    process.exit(1);
  }
  const { accessToken } = await auth.json();

  const schemaRows = await getJson(`/v2/discover/schema?${BASE}&sxtOwned=false`, accessToken);
  let schemas = schemaRows.map((r) => r?.schema).filter((s) => typeof s === 'string' && IDENT.test(s)).sort();
  if (args.schema) schemas = schemas.filter((s) => s === args.schema);

  const tables = [];
  for (let i = 0; i < schemas.length; i += CONCURRENCY) {
    const batch = schemas.slice(i, i + CONCURRENCY);
    const lists = await Promise.all(
      batch.map((s) => getJson(`/v2/discover/table?${BASE}&schema=${encodeURIComponent(s)}`, accessToken)),
    );
    lists.forEach((rows, j) => {
      for (const r of Array.isArray(rows) ? rows : []) {
        if (typeof r?.table !== 'string' || !IDENT.test(r.table)) continue;
        tables.push({ table: `${batch[j]}.${r.table}`, size: r.size ?? null, created: r.created ?? null });
      }
    });
    if (!args.json) process.stderr.write(`\r  scanned ${Math.min(i + CONCURRENCY, schemas.length)}/${schemas.length} schemas`);
  }
  if (!args.json) process.stderr.write('\n');

  const match = (t) => !args.search || t.toLowerCase().includes(args.search);
  const curated = args.schema ? [] : CURATED.filter(match);
  const community = tables.filter((t) => match(t.table)).sort((a, b) => a.table.localeCompare(b.table));

  if (args.json) {
    console.log(JSON.stringify({ curated, community }, null, 2));
    return;
  }
  for (const t of curated) console.log(`  ${t}  (SXT, curated)`);
  const pad = Math.max(0, ...community.map((t) => t.table.length)) + 2;
  for (const t of community) console.log(`  ${t.table.padEnd(pad)}${(t.size ?? '').padStart(10)}  ${t.created?.slice(0, 10) ?? ''}`);
  console.log('');
  console.log(`${curated.length + community.length} table(s). Next:  sxt tables --describe PREFIX.TABLE`);
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log('Usage: sxt tables [search] [--schema S] [--describe PREFIX.TABLE] [--json]');
  process.exit(0);
}
try {
  if (args.describe) await describeCmd(args.describe, args.json);
  else await listCmd(args);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
