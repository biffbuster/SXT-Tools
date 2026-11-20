#!/usr/bin/env node
/**
 * Off-chain Proof of SQL verification for the published table via the
 * `sxt-proof-of-sql-sdk` npm package. The SDK exchanges a Studio API
 * key for a short-lived JWT at /auth/apikey, submits the SQL to the
 * prover at /v1/prove, and returns the verified result.
 *
 * Schema-agnostic: the SQL for Q1/Q2/Q3 is read from the proof-plan JSON
 * files written by save-proof-plans.mjs (column names + literal values
 * already match the published table — same SQL the on-chain contract
 * has baked into its QUERY_PLAN). For arbitrary community CSVs:
 *   1. publish-dataset-cli.mjs → writes table + inferred-schema.json
 *   2. save-proof-plans.mjs    → writes proof plans (schema-aware SQL)
 *   3. verify-table.mjs        → this script; reads each plan's SQL, runs it
 *
 * Any public table, no plans needed:
 *   sxt verify --table PREFIX.TABLE            proves SELECT * ... LIMIT 5
 *   sxt verify --sql "SELECT ... FROM ..."     proves exactly that SQL
 * Find tables with `sxt tables`.
 *
 * Env:
 *   SXT_API_KEY    Studio API key (app.spaceandtime.ai → API Authentication).
 *   SXT_PROVER     Default: https://api.makeinfinite.dev
 *   SXT_AUTH       Default: https://proxy.api.makeinfinite.dev/auth/apikey
 *   SXT_RPC_HTTP   Default: https://rpc.mainnet.sxt.network/
 *   SXT_TABLE      Override the queried table reference (used only by
 *                  Q1 fallback when no proof-plan files exist).
 *   SXT_PLAN_DIR   Override proof-plan directory (default: ../data/proof-plans).
 */
import 'dotenv/config';
import { SxTClient } from 'sxt-proof-of-sql-sdk';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLastPublish, planDirFor } from './lib/last-publish.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROVER = process.env.SXT_PROVER ?? 'https://api.makeinfinite.dev';
const AUTH   = process.env.SXT_AUTH   ?? 'https://proxy.api.makeinfinite.dev/auth/apikey';
const RPC    = process.env.SXT_RPC_HTTP ?? 'https://rpc.mainnet.sxt.network/';

// Resolution order: env > .last-publish.json handoff > canonical demo.
let handoff = readLastPublish();
// An indexed-sci handoff (written by index-contract.mjs) is not consumable by
// the CSV proof pipeline: it has no inferred-schema file and its address
// columns are BINARY, which formatLiteral has not been proven against. Ignore
// it so env vars / legacy defaults win.
if (handoff?.kind === 'indexed-sci') handoff = null;
const BASE_PLAN_DIR = join(HERE, '..', 'data', 'proof-plans');
const HANDOFF_TABLE = handoff?.tableRef;
const PLAN_DIR = process.env.SXT_PLAN_DIR
  ? resolvePath(process.env.SXT_PLAN_DIR)
  : (HANDOFF_TABLE ? planDirFor(HANDOFF_TABLE, BASE_PLAN_DIR) : BASE_PLAN_DIR);

function flag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const FLAG_SQL = flag('--sql');
const FLAG_TABLE = (flag('--table') ?? FLAG_SQL?.match(/\bFROM\s+([A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*)/i)?.[1])?.toUpperCase();

const apiKey = process.env.SXT_API_KEY;
if (!apiKey) {
  console.error('✗ SXT_API_KEY env var is not set. Add it to examples/scripts/.env.');
  process.exit(1);
}

function loadPlan(name) {
  const p = join(PLAN_DIR, `${name}.json`);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return { sql: j.sql, table: j.table };
  } catch (e) {
    console.error(`  ⚠ ${name}.json exists but failed to parse: ${e.message}`);
    return null;
  }
}

// --table / --sql target an arbitrary table, so the active table's plans do not apply.
const usePlans = !FLAG_TABLE && !FLAG_SQL;
const countPlan    = usePlans ? loadPlan('count') : null;
const pointPlan    = usePlans ? loadPlan('point-lookup') : null;
const negativePlan = usePlans ? loadPlan('negative-lookup') : null;
const TABLE = FLAG_TABLE
  ?? process.env.SXT_TABLE
  ?? countPlan?.table
  ?? pointPlan?.table
  ?? HANDOFF_TABLE
  ?? 'MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS';

const client = new SxTClient(PROVER, AUTH, RPC, apiKey);

async function provenQuery(label, sql) {
  console.log(`\n▶ ${label}`);
  console.log(`  SQL: ${sql}`);
  // Cold first connections (slow resolver / IPv6-broken routes) fail with a
  // ~10s connect timeout then succeed — retry once so this zero-cost gate
  // doesn't spuriously scare users off a healthy table before a 100 SXT spend.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await client.queryAndVerify(sql);
      console.log(`  ✓ Proof verified locally.`);
      console.log(`  Result: ${JSON.stringify(result, null, 2).split('\n').slice(0, 20).join('\n  ')}`);
      return result;
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (attempt === 1 && /fetch failed|TIMEOUT|ECONN|ETIMEDOUT/i.test(msg)) {
        console.log('  · transient network error — retrying once…');
        continue;
      }
      console.error(`  ✗ ${msg}`);
      return null;
    }
  }
}

console.log(`SXT Prover:  ${PROVER}`);
console.log(`Auth:        ${AUTH}`);
console.log(`RPC:         ${RPC}`);
console.log(`Table:       ${TABLE}`);
console.log(`Plan dir:    ${PLAN_DIR}${countPlan || pointPlan || negativePlan ? '' : ' (no plans found — Q2/Q3 will be skipped)'}`);

if (FLAG_SQL) {
  const ok = await provenQuery('Proven query', FLAG_SQL);
  process.exit(ok ? 0 : 1);
}

// An aggregate with no GROUP BY (the count plan) plans but fails at the
// prover's execution step today (verified 2026-11-17), so Q1 proves a sample
// of rows instead. `sxt upstream` reports when whole-table counts work again.
const SAMPLE_SQL = `SELECT * FROM ${TABLE} LIMIT 5`;
await provenQuery('Q1 — proven sample rows', SAMPLE_SQL);
if (countPlan && !FLAG_TABLE) {
  console.log(`  · ${join(PLAN_DIR, 'count.json')} skipped: whole-table COUNT(*) fails at the prover today.`);
}
if (FLAG_TABLE) process.exit(0);

if (pointPlan) {
  await provenQuery('Q2 — proven point lookup', pointPlan.sql);
} else {
  console.log(`\n▶ Q2 — proven point lookup`);
  console.log(`  ⊘ skipped: ${join(PLAN_DIR, 'point-lookup.json')} not found.`);
  console.log(`    Run save-proof-plans.mjs first (auto-detects the schema's lookup column).`);
}

if (negativePlan) {
  await provenQuery('Q3 — proven negative lookup (should return 0 rows + valid proof)', negativePlan.sql);
} else {
  console.log(`\n▶ Q3 — proven negative lookup`);
  console.log(`  ⊘ skipped: ${join(PLAN_DIR, 'negative-lookup.json')} not found.`);
}

console.log(`\n──────────────────────────────────────────────────────────────`);
console.log(`Each result above carries a HyperKZG proof verified locally by the SDK`);
console.log(`against the on-chain commitment at:`);
console.log(`  Substrate state: commitments.commitmentStorageMap`);
console.log(`  Chain:           SXT Mainnet`);
console.log(``);
console.log(`The same proof can be verified onchain (~150K gas) via:`);
console.log(`  Ethereum verifier: 0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9`);
console.log(`  Base verifier:     0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518`);
console.log(`  QueryRouter:       0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB`);
