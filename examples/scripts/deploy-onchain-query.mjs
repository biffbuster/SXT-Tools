#!/usr/bin/env node
/**
 * Deploy the most recently rendered OnchainQuery contract (default
 * StakersQuery for this repo) to Base mainnet from the
 * forge build artifact. Reads the contract name from .last-rendered.json
 * (written by render-onchain-query.mjs); falls back to StakersQuery if
 * absent. Idempotent: writes the deployed address to .deploy-state.json
 * and skips on subsequent runs if code is still present at that address.
 *
 * Env:
 *   PRIVATE_KEY        Deployer's Ethereum private key.
 *   ETH_RPC            JSON-RPC endpoint. Default: https://base.publicnode.com (Base mainnet).
 *                      Override to a different EVM chain if you maintain that QueryRouter wiring.
 *   ETHERSCAN_API_KEY  Optional. Enables source verification via `cast`.
 */
import 'dotenv/config';
import { JsonRpcProvider, Wallet, ContractFactory, formatEther } from 'ethers';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PROJECT_DIR = '../contracts/sxt-onchain-query';
const STATE_FILE = `${PROJECT_DIR}/.deploy-state.json`;
const LAST_RENDERED = `${PROJECT_DIR}/.last-rendered.json`;
const CONTRACT_NAME = existsSync(LAST_RENDERED)
  ? JSON.parse(readFileSync(LAST_RENDERED, 'utf8')).contractName
  : 'StakersQuery';
const ARTIFACT = `${PROJECT_DIR}/out/${CONTRACT_NAME}.sol/${CONTRACT_NAME}.json`;
const RPC = process.env.ETH_RPC ?? 'https://base.publicnode.com';

if (!process.env.PRIVATE_KEY) {
  console.error('✗ PRIVATE_KEY not set');
  process.exit(1);
}
if (!existsSync(ARTIFACT)) {
  console.error(`✗ Forge artifact missing at ${ARTIFACT}. Run \`forge build\` in examples/contracts/sxt-onchain-query/ first.`);
  process.exit(1);
}

const provider = new JsonRpcProvider(RPC);
const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
const network = await provider.getNetwork();
const chainId = Number(network.chainId);

console.log(`▶ Network:  ${network.name} (chainId ${chainId})`);
console.log(`  RPC:      ${RPC}`);
console.log(`  Deployer: ${wallet.address}`);

const ethBal = await provider.getBalance(wallet.address);
console.log(`  ETH:      ${formatEther(ethBal)}`);
if (ethBal < 2n * 10n ** 15n) { // < 0.002 ETH
  console.error('✘ ETH balance < 0.002 — likely insufficient for the contract deploy on Base. Top up before retrying.');
  process.exit(1);
}

// Idempotency: skip if a deployment for this chain already exists and the code is still there.
if (existsSync(STATE_FILE)) {
  const prev = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  if (prev.chainId === chainId && prev.address) {
    const code = await provider.getCode(prev.address);
    if (code && code !== '0x') {
      console.log(`\n✓ Already deployed at ${prev.address} (block ${prev.deployBlock}). Skipping deploy.`);
      console.log(`  Tx: ${prev.deployTxHash}`);
      console.log(`  To re-deploy, delete ${STATE_FILE} first.`);
      process.exit(0);
    }
    console.log(`  ⚠ State file references ${prev.address} but no code at that address. Re-deploying.`);
  }
}

// Mainnet confirmation gate (per dreamspace-contracts:deploy-contract skill rule)
if (chainId === 8453 || chainId === 1) {
  const target = chainId === 8453 ? 'Base mainnet' : 'Ethereum mainnet';
  console.log(`\n⚠ TARGET IS ${target.toUpperCase()}.`);
  console.log(`  Deploy will permanently consume gas (~$1-5 on Base, ~$30-80 on Ethereum).`);
  console.log(`  Proceeding in 5 seconds — Ctrl+C to abort.\n`);
  await new Promise((r) => setTimeout(r, 5000));
}

const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, wallet);

console.log(`▶ Deploying ${CONTRACT_NAME} (${(artifact.bytecode.object.length - 2) / 2} bytes)…`);
const contract = await factory.deploy();
console.log(`  Tx submitted: ${contract.deploymentTransaction()?.hash}`);

const receipt = await contract.deploymentTransaction()?.wait();
const address = await contract.getAddress();

console.log(`\n✓ Deployed at ${address}`);
console.log(`  Block:  ${receipt?.blockNumber}`);
console.log(`  Gas:    ${receipt?.gasUsed?.toString()}`);
console.log(`  Tx:     ${receipt?.hash}`);

const state = {
  chainId,
  network: network.name,
  address,
  deployTxHash: receipt?.hash,
  deployBlock: receipt?.blockNumber,
  deployer: wallet.address,
  deployedAt: new Date().toISOString(),
};
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
console.log(`  Wrote ${STATE_FILE}`);

console.log(`\nNext step: run \`node query-stakers.mjs\` to approve 100 SXT and call query().`);
