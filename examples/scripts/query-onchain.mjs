#!/usr/bin/env node
/**
 * Submit a proven query against the deployed OnchainQuery contract
 * (default StakersQuery for this repo):
 *   1. Approve 100 SXT (only if existing allowance is short).
 *   2. Call query() — dispatches the Proof of SQL request to QueryRouter.
 *   3. Poll for the executor's callback (QueryRow / QueryEmpty event,
 *      or MembershipProven / MembershipNotFound for the StakersQuery
 *      contract specifically) up to MAX_WAIT_MS.
 *   4. Print the proven result and the four transaction hashes.
 *
 * Env:
 *   PRIVATE_KEY    Wallet that owns the SXT to spend (typically the deployer).
 *   ETH_RPC        Must match the chainId in .deploy-state.json.
 *   MAX_WAIT_MS    Callback wait window in ms. Default: 180000.
 */
import 'dotenv/config';
import { JsonRpcProvider, Wallet, Contract, formatUnits, formatEther } from 'ethers';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_DIR = '../contracts/sxt-onchain-query';
const STATE_FILE = `${PROJECT_DIR}/.deploy-state.json`;
const LAST_RENDERED = `${PROJECT_DIR}/.last-rendered.json`;
const CONTRACT_NAME = existsSync(LAST_RENDERED)
  ? JSON.parse(readFileSync(LAST_RENDERED, 'utf8')).contractName
  : 'StakersQuery';
const ARTIFACT = `${PROJECT_DIR}/out/${CONTRACT_NAME}.sol/${CONTRACT_NAME}.json`;
const SXT_TOKEN = '0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8'; // SXT ERC-20 on Base
const RPC = process.env.ETH_RPC ?? 'https://base.publicnode.com';
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS ?? 180_000);

if (!process.env.PRIVATE_KEY) { console.error('✗ PRIVATE_KEY not set'); process.exit(1); }
if (!existsSync(STATE_FILE))  { console.error(`✗ Deploy state missing at ${STATE_FILE}. Run deploy-onchain-query.mjs first.`); process.exit(1); }

const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
const provider = new JsonRpcProvider(RPC);
const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
const network = await provider.getNetwork();

if (Number(network.chainId) !== state.chainId) {
  console.error(`✗ Chain mismatch. Deploy was on chainId ${state.chainId}, current RPC is chainId ${network.chainId}. Set ETH_RPC to match.`);
  process.exit(1);
}

console.log(`▶ Network:   ${network.name} (chainId ${state.chainId})`);
console.log(`  Caller:    ${wallet.address}`);
console.log(`  Contract:  ${state.address}`);

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
const sxt = new Contract(SXT_TOKEN, ERC20_ABI, wallet);
const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
const stakers = new Contract(state.address, artifact.abi, wallet);

const PAYMENT = 100n * 10n ** 18n; // 100 SXT
const [bal, allowance, ethBal] = await Promise.all([
  sxt.balanceOf(wallet.address),
  sxt.allowance(wallet.address, state.address),
  provider.getBalance(wallet.address),
]);
console.log(`  ETH:       ${formatEther(ethBal)}`);
console.log(`  SXT:       ${formatUnits(bal, 18)}`);
console.log(`  Allowance: ${formatUnits(allowance, 18)} → ${state.address}`);

if (bal < PAYMENT) {
  console.error(`\n✘ SXT balance is short by ${formatUnits(PAYMENT - bal, 18)}. Need 100 SXT.`);
  process.exit(1);
}
if (ethBal < 5n * 10n ** 15n) {
  console.error(`\n✘ ETH balance < 0.005 — likely insufficient for approve + query gas.`);
  process.exit(1);
}

if (allowance < PAYMENT) {
  console.log(`\n▶ Approving 100 SXT for ${state.address}…`);
  const approveTx = await sxt.approve(state.address, PAYMENT);
  console.log(`  Tx: ${approveTx.hash}`);
  const r = await approveTx.wait();
  console.log(`  ✓ Approved in block ${r?.blockNumber}, gas ${r?.gasUsed?.toString()}`);
} else {
  console.log(`  ✓ Allowance already covers 100 SXT — skipping approve`);
}

console.log(`\n▶ Calling query() — submits Proof of SQL request to QueryRouter…`);
const queryTx = await stakers.query();
console.log(`  Tx submitted: ${queryTx.hash}`);
const queryReceipt = await queryTx.wait();
console.log(`  ✓ requestQuery confirmed in block ${queryReceipt?.blockNumber}, gas ${queryReceipt?.gasUsed?.toString()}`);
console.log(`  Submitted at: ${new Date().toISOString()}`);

// Discover which result events the deployed contract actually defines.
// StakersQuery uses semantic events (MembershipProven / MembershipNotFound).
// OnchainQuery (rendered for any user) uses generic events (QueryRow / QueryEmpty).
const eventNames = artifact.abi.filter(x => x.type === 'event').map(e => e.name);
const successEvent = eventNames.find(n => n === 'MembershipProven') ?? eventNames.find(n => n === 'QueryRow');
const emptyEvent   = eventNames.find(n => n === 'MembershipNotFound') ?? eventNames.find(n => n === 'QueryEmpty');
if (!successEvent || !emptyEvent) {
  console.error(`✗ Deployed contract has no recognised result events (expected MembershipProven/MembershipNotFound or QueryRow/QueryEmpty). Found: ${eventNames.join(', ')}`);
  process.exit(1);
}

console.log(`\n▶ Waiting up to ${MAX_WAIT_MS / 1000}s for SXT executor's callback…`);
console.log(`  (Watching for ${successEvent} / ${emptyEvent} events on the contract)`);

const provenFilter = stakers.filters[successEvent]();
const notFoundFilter = stakers.filters[emptyEvent]();
const fromBlock = queryReceipt?.blockNumber ?? 'latest';

const start = Date.now();
let result = null;
while (Date.now() - start < MAX_WAIT_MS) {
  const [proven, notFound] = await Promise.all([
    stakers.queryFilter(provenFilter, fromBlock),
    stakers.queryFilter(notFoundFilter, fromBlock),
  ]);
  if (proven.length > 0 || notFound.length > 0) {
    result = { proven, notFound };
    break;
  }
  await new Promise((r) => setTimeout(r, 5000));
  process.stdout.write('.');
}
console.log('');

if (!result) {
  console.error(`\n✘ Timed out after ${MAX_WAIT_MS / 1000}s. Possible causes:`);
  console.error(`   - Executor service hasn't picked up the request yet — try increasing MAX_WAIT_MS.`);
  console.error(`   - Executor doesn't index this table type — check chain.spaceandtime.io for support.`);
  console.error(`   - Insufficient callback gas (raise gasLimit in the contract source and redeploy).`);
  console.error(`   The 100 SXT payment will be refunded after the contract's 1-hour timeout.`);
  process.exit(2);
}

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ✅ ONCHAIN PROOF OF SQL CALLBACK FIRED`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

if (result.proven.length > 0) {
  for (const ev of result.proven) {
    const fields = ev.args.map((v, i) => `  arg${i}:     ${v}`).join('\n');
    console.log(`\n${successEvent}\n${fields}`);
    console.log(`  callback:  ${ev.transactionHash}  (block ${ev.blockNumber})`);
  }
  console.log(`\nVerdict: ${result.proven.length} verified row(s) returned for the proven query.`);
}
if (result.notFound.length > 0) {
  for (const ev of result.notFound) {
    console.log(`\n${emptyEvent}`);
    console.log(`  queryId:  ${ev.args[0]}`);
    console.log(`  callback: ${ev.transactionHash}  (block ${ev.blockNumber})`);
  }
  console.log(`\nVerdict: 0 rows returned — the proven query found no matches.`);
}

console.log(`\n────────  Demo artifact summary  ────────`);
console.log(`Deploy:       ${state.deployTxHash}`);
console.log(`Approve:      (see above if executed)`);
console.log(`requestQuery: ${queryTx.hash}`);
console.log(`Callback:     ${(result.proven[0] ?? result.notFound[0])?.transactionHash}`);
console.log(`Contract:     ${state.address}`);
console.log(`\nThis whole sequence is the verifiable Proof of SQL receipt against your published table.`);
