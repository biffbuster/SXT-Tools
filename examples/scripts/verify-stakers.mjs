#!/usr/bin/env node
/**
 * Off-chain Proof of SQL verification for the published STAKERS table via
 * the `sxt-proof-of-sql-sdk` npm package. The SDK exchanges a Studio API
 * key for a short-lived JWT at /auth/apikey, submits the SQL to the
 * prover at /v1/prove, and returns the verified result.
 *
 * Note: this off-chain path applies to SXT-managed and Studio-registered
 * tables. Tables published via direct Substrate extrinsic (as STAKERS
 * was) verify through the on-chain QueryRouter path; see query-stakers.mjs.
 *
 * Env:
 *   SXT_API_KEY    Studio API key (app.spaceandtime.ai → API Authentication).
 *   SXT_PROVER     Default: https://api.makeinfinite.dev/v1/prove
 *   SXT_AUTH       Default: https://proxy.api.makeinfinite.dev/auth/apikey
 *   SXT_RPC_HTTP   Default: https://rpc.mainnet.sxt.network/
 *   SXT_TABLE      Override the queried table reference.
 */
import 'dotenv/config';
import { SxTClient } from 'sxt-proof-of-sql-sdk';

const PROVER = process.env.SXT_PROVER ?? 'https://api.makeinfinite.dev';
const AUTH   = process.env.SXT_AUTH   ?? 'https://proxy.api.makeinfinite.dev/auth/apikey';
const RPC    = process.env.SXT_RPC_HTTP ?? 'https://rpc.mainnet.sxt.network/';
const TABLE  = process.env.SXT_TABLE  ?? 'MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS';
const SAMPLE_STAKER = '0x6de6e901bbefd26a9888798a25e4a49309d04ca9'; // first row in the CSV

const apiKey = process.env.SXT_API_KEY;
if (!apiKey) {
  console.error('✗ SXT_API_KEY env var is not set. Add it to examples/scripts/.env.');
  process.exit(1);
}

const client = new SxTClient(PROVER, AUTH, RPC, apiKey);

async function provenQuery(label, sql) {
  console.log(`\n▶ ${label}`);
  console.log(`  SQL: ${sql}`);
  try {
    const result = await client.queryAndVerify(sql);
    console.log(`  ✓ Proof verified locally.`);
    console.log(`  Result: ${JSON.stringify(result, null, 2).split('\n').slice(0, 20).join('\n  ')}`);
    return result;
  } catch (err) {
    console.error(`  ✗ ${err?.message ?? err}`);
    return null;
  }
}

console.log(`SXT Prover:  ${PROVER}`);
console.log(`Auth:        ${AUTH}`);
console.log(`RPC:         ${RPC}`);
console.log(`Table:       ${TABLE}`);

await provenQuery(
  'Q1 — proven row count (should be 2062)',
  `SELECT COUNT(*) AS ROWS_PUBLISHED FROM ${TABLE}`,
);

await provenQuery(
  `Q2 — proven point lookup for ${SAMPLE_STAKER}`,
  `SELECT STAKER FROM ${TABLE} WHERE STAKER = '${SAMPLE_STAKER}'`,
);

await provenQuery(
  'Q3 — proven negative lookup (should return 0 rows + valid proof)',
  `SELECT STAKER FROM ${TABLE} WHERE STAKER = '0xnotanaddressdoesnotexist000000000000000000'`,
);

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
