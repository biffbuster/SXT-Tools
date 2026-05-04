#!/usr/bin/env node
/**
 * Standalone poller: watches the most recently deployed OnchainQuery / StakersQuery
 * contract for QueryRow / QueryEmpty / MembershipProven / MembershipNotFound events
 * after a query() has already been dispatched. Use when query-onchain.mjs crashed
 * mid-poll and you don't want to re-fire query() and burn another 100 SXT.
 *
 * Usage: node poll-callback.mjs [--from-block N] [--rpc URL]
 */
import 'dotenv/config';
import { JsonRpcProvider, Contract } from 'ethers';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_DIR = '../contracts/sxt-onchain-query';
const STATE_FILE = `${PROJECT_DIR}/.deploy-state.json`;
const LAST_RENDERED = `${PROJECT_DIR}/.last-rendered.json`;
const CONTRACT_NAME = existsSync(LAST_RENDERED)
  ? JSON.parse(readFileSync(LAST_RENDERED, 'utf8')).contractName
  : 'StakersQuery';
const ARTIFACT = `${PROJECT_DIR}/out/${CONTRACT_NAME}.sol/${CONTRACT_NAME}.json`;

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const RPC = arg('--rpc', process.env.ETH_RPC ?? 'https://mainnet.base.org');
const FROM_BLOCK = Number(arg('--from-block', '0')) || null;
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS ?? 300_000);

if (!existsSync(STATE_FILE)) { console.error(`✗ ${STATE_FILE} missing`); process.exit(1); }
const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
const provider = new JsonRpcProvider(RPC);
const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
const c = new Contract(state.address, artifact.abi, provider);

const eventNames = artifact.abi.filter(x => x.type === 'event').map(e => e.name);
const successEvent = eventNames.find(n => n === 'MembershipProven') ?? eventNames.find(n => n === 'QueryRow');
const emptyEvent   = eventNames.find(n => n === 'MembershipNotFound') ?? eventNames.find(n => n === 'QueryEmpty');

console.log(`▶ Polling contract  ${state.address}`);
console.log(`  RPC:              ${RPC}`);
console.log(`  Watching events:  ${successEvent} / ${emptyEvent}`);
console.log(`  fromBlock:        ${FROM_BLOCK ?? state.deployBlock}`);

const fromBlock = FROM_BLOCK ?? state.deployBlock;
const start = Date.now();
let result = null;
while (Date.now() - start < MAX_WAIT_MS) {
  try {
    const [proven, notFound] = await Promise.all([
      c.queryFilter(c.filters[successEvent](), fromBlock),
      c.queryFilter(c.filters[emptyEvent](), fromBlock),
    ]);
    if (proven.length || notFound.length) { result = { proven, notFound }; break; }
  } catch (e) {
    process.stdout.write('?');
  }
  await new Promise(r => setTimeout(r, 5000));
  process.stdout.write('.');
}
console.log('');

if (!result) { console.error(`✘ Timed out after ${MAX_WAIT_MS/1000}s. Try a longer wait or check basescan directly.`); process.exit(2); }

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  ✅ ONCHAIN PROOF OF SQL CALLBACK FIRED');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for (const ev of result.proven) {
  const fields = ev.args.map((v, i) => `  arg${i}:    ${v}`).join('\n');
  console.log(`\n${successEvent}\n${fields}\n  callback: ${ev.transactionHash} (block ${ev.blockNumber})`);
}
for (const ev of result.notFound) {
  console.log(`\n${emptyEvent}\n  queryId:  ${ev.args[0]}\n  callback: ${ev.transactionHash} (block ${ev.blockNumber})`);
}
const verdict = result.proven.length ? `${result.proven.length} verified row(s)` : '0 rows (negative membership)';
console.log(`\nVerdict: ${verdict}.`);
