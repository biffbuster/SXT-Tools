#!/usr/bin/env node
/**
 * First-run setup + status check for the SXT Tools demo.
 *
 * Usage:
 *   node bootstrap.mjs                  Check prereqs, create .env if missing,
 *                                       run all balance probes, print GO/NOT-GO.
 *   node bootstrap.mjs --new-wallet     Generate a fresh ETH key, write to .env,
 *                                       print address only. Funding instructions
 *                                       follow.
 *   node bootstrap.mjs --status         Skip setup; just rerun the probes.
 *   node bootstrap.mjs --run            After GO state, run the full pipeline:
 *                                       publish → render → deploy → query.
 *
 * No private-key data is ever printed to stdout, written to logs, or echoed
 * back. The key is held in `.env` (gitignored) and read directly by ethers.
 */
import { existsSync, copyFileSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { JsonRpcProvider, Wallet, Contract, formatUnits, formatEther } from 'ethers';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1');
const ENV_PATH = ROOT + '.env';
const ENV_EXAMPLE = ROOT + '.env.example';
const CONTRACTS_DIR = ROOT + '../contracts/sxt-onchain-query';
const SXT_TOKEN = '0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8'; // SXT ERC-20 on Base
const QUERY_ROUTER = '0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB';
const REQUIRED_NODE_MAJOR = 18;
const PUBLISH_FEE_FLOOR = 10n ** 15n; // 0.001 SxT chain native
const ETH_FLOOR = 3n * 10n ** 15n;    // 0.003 ETH on Base for deploy + approve + query (real cost ~0.001 ETH; ~3× headroom)
const SXT_FLOOR = 100n * 10n ** 18n;  // 100 SXT per query() call

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

if (flag('--help') || flag('-h')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/Usage:\n([\s\S]*?)\n \*\//)?.[1] ?? '');
  process.exit(0);
}

const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => console.log(`  ✗ ${msg}`);
const info = (msg) => console.log(`  · ${msg}`);
const section = (title) => console.log(`\n▶ ${title}`);

let blockers = [];

// ─── Prerequisites ──────────────────────────────────────────────────────
section('Prerequisites');
{
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= REQUIRED_NODE_MAJOR) ok(`node ${process.versions.node}`);
  else { bad(`node ${process.versions.node} — need ≥ ${REQUIRED_NODE_MAJOR}`); blockers.push('upgrade-node'); }

  const forge = spawnSync('forge --version', { encoding: 'utf8', shell: true });
  if (forge.status === 0) ok(`forge ${forge.stdout.split('\n')[0].replace('forge ', '')}`);
  else { bad('forge not found — install via https://getfoundry.sh'); blockers.push('install-forge'); }

  if (existsSync(ROOT + 'node_modules')) ok('npm dependencies installed');
  else { bad('npm dependencies missing — run `npm install` in examples/scripts/'); blockers.push('npm-install'); }

  if (existsSync(CONTRACTS_DIR + '/dependencies/@openzeppelin-contracts-5.2.0')) ok('soldeer dependencies installed');
  else { bad('soldeer deps missing — run `forge soldeer install` in examples/contracts/sxt-onchain-query/'); blockers.push('soldeer-install'); }
}

// ─── .env handling ──────────────────────────────────────────────────────
section('Environment file');
if (!existsSync(ENV_PATH)) {
  if (existsSync(ENV_EXAMPLE)) {
    copyFileSync(ENV_EXAMPLE, ENV_PATH);
    info(`created .env from .env.example`);
  } else {
    bad('.env missing and .env.example absent — cannot bootstrap');
    process.exit(1);
  }
}

if (flag('--new-wallet')) {
  const env = readFileSync(ENV_PATH, 'utf8');
  const hasKey = /^PRIVATE_KEY=0x[0-9a-fA-F]{64}/m.test(env);
  if (hasKey && !flag('--force')) {
    bad('.env already has a PRIVATE_KEY. Pass --force to overwrite (your existing key will be lost).');
    process.exit(1);
  }
  const w = Wallet.createRandom();
  const newEnv = env.replace(/^PRIVATE_KEY=.*$/m, `PRIVATE_KEY=${w.privateKey}`);
  writeFileSync(ENV_PATH, newEnv);
  console.log('');
  console.log(`  Generated wallet address: ${w.address}`);
  console.log(`  PRIVATE_KEY written to ${ENV_PATH}`);
  console.log('');
  console.log('  Back up examples/scripts/.env now if you may need recovery.');
  console.log('  The private key will not be printed again.');
  console.log('');
  console.log('  Next: fund this address on three networks (run `node bootstrap.mjs --status`');
  console.log('  for current balances and exact shortfalls).');
  process.exit(0);
}

// Load .env
await import('dotenv/config');
const pk = process.env.PRIVATE_KEY?.trim();
if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  bad('PRIVATE_KEY missing or malformed in .env');
  info('Either edit examples/scripts/.env to add an existing key,');
  info('or run `node bootstrap.mjs --new-wallet` to generate a fresh one.');
  process.exit(1);
}
const wallet = new Wallet(pk);
ok(`PRIVATE_KEY present, derived address ${wallet.address}`);

// ─── Network probes ─────────────────────────────────────────────────────
let canPublish = false, canDeploy = false, canQuery = false;

section('SXT chain (publish prerequisites)');
try {
  const { ApiPromise, WsProvider } = await import('@polkadot/api');
  const { EthEcdsaSigner } = await import('./ethecdsa_signer.mjs');
  const SXT_RPC = process.env.SXT_RPC ?? 'wss://rpc.mainnet.sxt.network';
  const api = await ApiPromise.create({ provider: new WsProvider(SXT_RPC), noInitWarn: true });
  const signer = new EthEcdsaSigner(wallet, api);
  const acct = await api.query.system.account(signer.address);
  const free = BigInt((acct.data ?? acct).free.toString());
  ok(`connected to ${(await api.rpc.system.chain()).toString()} via ${SXT_RPC}`);
  if (free >= PUBLISH_FEE_FLOOR) {
    ok(`native balance ${formatUnits(free, 18)} SxT — sufficient for publish (~0.001 SxT per run)`);
    canPublish = true;
  } else {
    bad(`native balance ${formatUnits(free, 18)} SxT — need ≥ 0.001 SxT for publish fees`);
    info('Fund via SXTChainFunding mainnet contract: 0xb1bc1d7eb1e6c65d0de909d8b4f27561ef568199');
    info('  → approve + fundAddress against the SXT token on Ethereum mainnet (0xE6Bf...B195) to credit your SxT chain account');
  }
  await api.disconnect();
} catch (e) {
  bad(`SXT chain probe failed: ${e.message}`);
}

section('Base (deploy + query prerequisites)');
try {
  const ETH_RPC = process.env.ETH_RPC ?? 'https://base.publicnode.com';
  const provider = new JsonRpcProvider(ETH_RPC);
  const network = await provider.getNetwork();
  ok(`connected to ${network.name} (chainId ${network.chainId}) via ${ETH_RPC}`);

  const ethBal = await provider.getBalance(wallet.address);
  if (ethBal >= ETH_FLOOR) {
    ok(`ETH balance ${formatEther(ethBal)} — sufficient for deploy + approve + query on Base (~0.003 ETH floor, ~0.001 ETH realistic cost)`);
    canDeploy = true;
  } else {
    bad(`ETH balance ${formatEther(ethBal)} — need ≥ ${formatEther(ETH_FLOOR)} for the deploy + 2 txs`);
    info('Bridge ETH to Base (e.g., bridge.base.org) and send to ' + wallet.address);
  }

  const erc20 = ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'];
  const token = new Contract(SXT_TOKEN, erc20, provider);
  const sxtBal = await token.balanceOf(wallet.address);
  const allowance = await token.allowance(wallet.address, QUERY_ROUTER);
  if (sxtBal >= SXT_FLOOR) {
    ok(`SXT (ERC-20 on Base) ${formatUnits(sxtBal, 18)} — covers ${sxtBal / SXT_FLOOR} query() call(s) at 100 SXT each`);
    canQuery = canDeploy; // query() requires deploy first AND ETH for the approve+query gas
  } else {
    bad(`SXT (ERC-20 on Base) ${formatUnits(sxtBal, 18)} — need ≥ 100 SXT per query() call`);
    info('Acquire SXT on Base (token contract ' + SXT_TOKEN + ')');
  }
  if (allowance >= SXT_FLOOR) info(`existing QueryRouter allowance: ${formatUnits(allowance, 18)} SXT (approve step will be skipped)`);
} catch (e) {
  bad(`Base probe failed: ${e.message}`);
}

// ─── Verdict ────────────────────────────────────────────────────────────
section('Verdict');
const allReady = canPublish && canDeploy && canQuery && blockers.length === 0;
if (allReady) {
  console.log('  GO — all prerequisites met. Pipeline can run end-to-end.');
  console.log('');
  console.log('  Next: `node bootstrap.mjs --run` to execute publish → render → deploy → query');
  console.log('  Or run each step manually per README.md.');
} else {
  console.log('  NOT-GO — fix the items above before running the pipeline.');
  if (!canPublish) info('Publish step is blocked');
  if (!canDeploy)  info('Deploy step is blocked');
  if (!canQuery)   info('Query step is blocked');
  if (blockers.length) info(`Setup blockers: ${blockers.join(', ')}`);
}

if (!flag('--run') || !allReady) process.exit(allReady ? 0 : 1);

// ─── --run mode: execute the pipeline ───────────────────────────────────
section('Running pipeline');
function runStep(label, cmd, opts = {}) {
  console.log(`\n  ── ${label}`);
  console.log(`     $ ${cmd}`);
  const r = spawnSync(cmd, {
    stdio: 'inherit',
    shell: true,
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  if (r.status !== 0) {
    console.log(`\n  ✗ ${label} failed with exit code ${r.status}. Stopping.`);
    process.exit(r.status ?? 1);
  }
}

// Compute the table reference the publish step will create. publish-dataset-cli
// auto-suffixes the namespace with the wallet's uppercase hex address per chain
// rule, so we know the resulting reference up-front and can thread it into
// downstream steps that read SXT_TABLE.
const NAMESPACE_PREFIX = process.env.SXT_NAMESPACE_PREFIX ?? 'MY_AUDIT_V2';
const TABLE_NAME = process.env.SXT_TABLE_NAME ?? 'STAKERS';
const PUBLISHED_TABLE = `${NAMESPACE_PREFIX}_${wallet.address.slice(2).toUpperCase()}.${TABLE_NAME}`;
console.log(`\n  Pipeline target: ${PUBLISHED_TABLE}`);

runStep(
  '1. Publish CSV',
  `node publish-dataset-cli.mjs ../data/sxt_stakers.csv ${NAMESPACE_PREFIX}.${TABLE_NAME} --schema ../data/sxt_stakers.schema.json`,
  { env: {
      SXT_RPC: process.env.SXT_RPC ?? 'wss://rpc.mainnet.sxt.network',
      ETH_RPC: process.env.ETH_RPC ?? 'https://base.publicnode.com',
    } },
);
runStep('2. Save proof plans', 'node save-proof-plans.mjs', {
  env: { SXT_TABLE: PUBLISHED_TABLE },
});
runStep('3. Render contract', 'node render-onchain-query.mjs');
runStep('4. Compile', 'forge build', { cwd: CONTRACTS_DIR });
runStep('5. Deploy', 'node deploy-onchain-query.mjs');
runStep('6. Approve + query', 'node query-onchain.mjs');

console.log('\n  GO — pipeline complete. See script output for the verified-result event hash.');
