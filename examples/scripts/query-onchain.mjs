#!/usr/bin/env node
/**
 * Submit a proven query against the deployed OnchainQuery contract
 * (default StakersQuery for this repo):
 *   1. Approve 100 SXT (only if existing allowance is short).
 *   2. Call query(...) — dispatches the Proof of SQL request to QueryRouter.
 *      For parameterized contracts (rendered from indexed-table plans),
 *      pass --args "val1,val2,..." matching the inputParams in
 *      .last-rendered.json.
 *   3. Poll for the executor's callback (QueryRow / QueryEmpty event,
 *      or MembershipProven / MembershipNotFound for the StakersQuery
 *      contract specifically) up to MAX_WAIT_MS.
 *   4. Print the proven result and the four transaction hashes.
 *
 * Usage:
 *   # Non-parameterized (e.g. StakersQuery — back-compat):
 *   node query-onchain.mjs
 *
 *   # Parameterized — values forwarded to contract.query(...) typed per inputParams:
 *   node query-onchain.mjs --args "0xd8da6bf26964af9d7eed9e03e53415d37aa96045,21000000"
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
const rendered = existsSync(LAST_RENDERED) ? JSON.parse(readFileSync(LAST_RENDERED, 'utf8')) : {};
const CONTRACT_NAME = rendered.contractName ?? 'StakersQuery';
const INPUT_PARAMS = Array.isArray(rendered.inputParams) ? rendered.inputParams : [];
const IS_PARAMETERIZED = Boolean(rendered.parameterized) && INPUT_PARAMS.length > 0;
const ARTIFACT = `${PROJECT_DIR}/out/${CONTRACT_NAME}.sol/${CONTRACT_NAME}.json`;
const SXT_TOKEN = '0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8'; // SXT ERC-20 on Base
const RPC = process.env.ETH_RPC ?? 'https://base.publicnode.com';
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS ?? 180_000);

// Parse --args "val1,val2,...". When the deployed contract is parameterized,
// these are forwarded to query(...) in order, coerced to the Solidity arg
// types recorded in .last-rendered.json. Quoting any CSV value with embedded
// commas is the caller's responsibility — this is a CLI, not a CSV parser.
function parseCliArgs(argv) {
  const out = { args: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--args') out.args = argv[++i];
  }
  return out;
}

// Coerce a CLI string to the ABI-encodable value ethers expects for each
// supported Proof-of-SQL ParamsBuilder type. Mirrors the PARAM_BUILDERS
// table in render-onchain-query.mjs — keep in sync.
function coerceArgValue(raw, sqlType) {
  const v = String(raw).trim();
  switch (String(sqlType).toUpperCase()) {
    case 'VARCHAR':
      // SXT stores Ethereum addresses lowercased — match that when coercing
      // anything that looks like a hex address so downstream proof lookups
      // hit. Pass through other strings unchanged.
      return /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : v;
    case 'BIGINT':
    case 'TIMESTAMP':
      return BigInt(v); // int64 — ethers v6 accepts BigInt
    case 'INT':
    case 'INTEGER':
    case 'SMALLINT':
    case 'TINYINT':
      return Number(v);
    case 'BOOLEAN':
      return /^(true|1|yes)$/i.test(v);
    case 'BINARY':
      return v.startsWith('0x') ? v : `0x${v}`;
    default:
      throw new Error(`Unsupported sqlType "${sqlType}" in inputParams — cannot coerce CLI value.`);
  }
}

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

// Resolve query() arguments. For parameterized contracts, --args is REQUIRED
// (or the chain rejects the call with an arity mismatch); we surface a clear
// error and the expected shape rather than letting ethers throw a hex string.
const cliArgs = parseCliArgs(process.argv);
let queryArgs = [];
if (IS_PARAMETERIZED) {
  if (!cliArgs.args) {
    console.error('');
    console.error(`✘ ${CONTRACT_NAME} is parameterized. Pass --args "val1,val2,..." in this order:`);
    for (const [i, p] of INPUT_PARAMS.entries()) {
      console.error(`     [${i}] ${p.name}  (${p.sqlType} → Solidity ${p.solType})`);
    }
    console.error('');
    console.error('  Example:');
    console.error(`     node query-onchain.mjs --args "${INPUT_PARAMS.map((p) => p.sqlType === 'VARCHAR' ? '0x...' : '0').join(',')}"`);
    process.exit(1);
  }
  const rawArgs = cliArgs.args.split(',').map((s) => s.trim());
  if (rawArgs.length !== INPUT_PARAMS.length) {
    console.error(`✘ Expected ${INPUT_PARAMS.length} --args values, got ${rawArgs.length}.`);
    process.exit(1);
  }
  queryArgs = rawArgs.map((raw, i) => coerceArgValue(raw, INPUT_PARAMS[i].sqlType));
  console.log('\n  Query parameters:');
  for (const [i, p] of INPUT_PARAMS.entries()) {
    console.log(`    ${p.name} (${p.sqlType}) = ${queryArgs[i]}`);
  }
}

console.log(`\n▶ Calling query(${queryArgs.length ? '...' : ''}) — submits Proof of SQL request to QueryRouter…`);
const queryTx = await stakers.query(...queryArgs);
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
