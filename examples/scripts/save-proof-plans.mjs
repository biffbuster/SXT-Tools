#!/usr/bin/env node
/**
 * Build EVM proof plans for a published SXT table by calling
 * `commitments_v1_evmProofPlan` on the SXT chain RPC. Writes one JSON
 * artifact per query to examples/data/proof-plans/.
 *
 * SXT Toolkit quickstart — pointing this at your own data:
 *   1. Set SXT_TABLE in .env to your full table reference, e.g.:
 *        SXT_TABLE=MY_PROJECT_<UPPERCASE_HEX_ADDRESS>.MY_TABLE
 *   2. (Optional) Set SXT_POINT_LOOKUP to an address you expect IS in the table
 *      (used for the positive-membership proof). Default is the demo's known
 *      staker.
 *   3. (Optional) Edit the `plans` array below if your queries differ from the
 *      generic membership/count/non-membership template (e.g., your column is
 *      not named STAKER).
 *
 * Defaults preserve the canonical demo's behavior so re-running with no env
 * overrides reproduces the proof plans baked into the existing
 * StakersQuery.sol / OnchainQuery.sol contracts.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RPC = process.env.SXT_RPC_HTTP ?? 'https://rpc.mainnet.sxt.network';
const TABLE = process.env.SXT_TABLE ?? 'MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS';
const POINT_LOOKUP = process.env.SXT_POINT_LOOKUP ?? '0x45c56e138881fd3ff46359ba1826d5fc6fccaedc';
const OUT_DIR = '../data/proof-plans';

// To customize for a non-STAKERS schema, edit the SQL below. Only the
// canonical membership/count/non-membership shapes are wired through to the
// renderer + Solidity templates; richer queries (GROUP BY, JOIN, SUM) work as
// proof plans but require a matching contract.
const plans = [
  {
    name: 'point-lookup',
    description: 'Verify a specific known address is in the table (positive membership proof).',
    sql: `SELECT STAKER FROM ${TABLE} WHERE STAKER = '${POINT_LOOKUP}'`,
  },
  {
    name: 'count',
    description: 'Verify the table has exactly the row count it was published with (cardinality proof).',
    sql: `SELECT COUNT(*) AS N FROM ${TABLE}`,
  },
  {
    name: 'negative-lookup',
    description: 'Verify a specific address is NOT in the table (non-membership proof).',
    sql: `SELECT STAKER FROM ${TABLE} WHERE STAKER = '0x0000000000000000000000000000000000000000'`,
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
    proofPlan: json.result.proofPlan,
    chainStateAt: json.result.at,
    rpcEndpoint: RPC,
    generatedAt: new Date().toISOString(),
    proofPlanBytes: (json.result.proofPlan.length - 2) / 2,
    note: 'Drop the proofPlan into a Solidity contract as `bytes public constant QUERY_PLAN = hex"<plan-without-0x>";` then submit via IQueryRouter.requestQuery() per the SXT onchain_hello_world_query tutorial.',
  };
  writeFileSync(join(OUT_DIR, `${plan.name}.json`), JSON.stringify(artifact, null, 2) + '\n');
  console.log(`✓ ${plan.name}.json (${artifact.proofPlanBytes} bytes plan, at ${artifact.chainStateAt.substring(0, 14)}...)`);
}
