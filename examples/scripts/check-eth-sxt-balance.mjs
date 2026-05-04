#!/usr/bin/env node
/**
 * Report Base mainnet ETH + SXT (ERC-20) balance for the wallet derived
 * from PRIVATE_KEY, plus the wallet's allowance to the QueryRouter
 * contract. SXT (ERC-20) on Base at 0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8
 * is distinct from the native SxT on the Substrate-based SXT chain;
 * the QueryRouter charges 100 SXT per request.
 *
 * Override ETH_RPC to point at any other EVM where the QueryRouter is
 * also deployed (e.g. Ethereum mainnet) — the SXT token address must
 * then be passed via SXT_TOKEN env var.
 */
import 'dotenv/config';
import { JsonRpcProvider, Contract, formatUnits, Wallet } from 'ethers';

const RPC = process.env.ETH_RPC ?? 'https://base.publicnode.com';
const SXT_TOKEN = process.env.SXT_TOKEN ?? '0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8';
const QUERY_ROUTER = '0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB';
const WALLET = process.env.PRIVATE_KEY
  ? new Wallet(process.env.PRIVATE_KEY).address
  : '0x5731Ec0bbeB5f7bcaA2e4bAf3179A7a4C59c2552';

const ERC20 = ['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function allowance(address,address) view returns (uint256)'];

const provider = new JsonRpcProvider(RPC);
const token = new Contract(SXT_TOKEN, ERC20, provider);
const [bal, ethBal, sym, dec, allowance] = await Promise.all([
  token.balanceOf(WALLET),
  provider.getBalance(WALLET),
  token.symbol(),
  token.decimals(),
  token.allowance(WALLET, QUERY_ROUTER),
]);

console.log(`Wallet:        ${WALLET}`);
console.log(`EVM RPC:       ${RPC}`);
console.log('');
console.log(`Native ETH:    ${formatUnits(ethBal, 18)} ETH`);
console.log(`SXT (${sym}):       ${formatUnits(bal, dec)} ${sym}  (raw: ${bal.toString()})`);
console.log(`SXT decimals:  ${dec}`);
console.log('');
console.log(`Allowance to QueryRouter (${QUERY_ROUTER}):`);
console.log(`  ${formatUnits(allowance, dec)} ${sym}`);
console.log('');
const need = 100n * 10n ** BigInt(dec);
console.log(`Needed for one query() call: 100 ${sym}`);
console.log(bal >= need
  ? `✓ SXT balance is sufficient (${formatUnits(bal - need, dec)} ${sym} surplus after one call).`
  : `✘ SXT balance is short by ${formatUnits(need - bal, dec)} ${sym}.`);
console.log(allowance >= need
  ? `✓ Allowance to QueryRouter already covers one call.`
  : `· Will need to call approve(${QUERY_ROUTER}, ≥100*1e18) on ${SXT_TOKEN} before query().`);
console.log(ethBal >= 5n * 10n ** 15n
  ? `✓ ETH balance ≥ 0.005 — should cover gas for approve + query (depends on gwei).`
  : `✘ ETH balance < 0.005 — likely insufficient gas for the approve+query sequence.`);
