#!/usr/bin/env node
/**
 * Report the SXT chain native balance for the wallet derived from
 * PRIVATE_KEY, plus an estimate of the fee for `tables.createNamespace`
 * + `tables.createTables`. Used to confirm a publish will succeed
 * before submission.
 *
 * Env:
 *   PRIVATE_KEY    Ethereum private key.
 *   SXT_RPC        Default: wss://rpc.testnet.sxt.network
 *                  Override to mainnet via wss://rpc.mainnet.sxt.network.
 */
import 'dotenv/config';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Wallet } from 'ethers';
import { EthEcdsaSigner } from './ethecdsa_signer.mjs';

const RPC = process.env.SXT_RPC ?? 'wss://rpc.testnet.sxt.network';

const api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });
const chain = (await api.rpc.system.chain()).toString();
console.log(`▶ Connected. Chain: ${chain}`);

const wallet = new Wallet(process.env.PRIVATE_KEY);
const signer = new EthEcdsaSigner(wallet, api);
const sxtAddr = signer.address;
console.log(`  ETH address: ${wallet.address}`);
console.log(`  SxT address: ${sxtAddr}`);

const acct = await api.query.system.account(sxtAddr);
const data = acct.data ?? acct;
const free = BigInt(data.free.toString());
const reserved = BigInt(data.reserved.toString());
const decimals = api.registry.chainDecimals?.[0] ?? 18;
const symbol = api.registry.chainTokens?.[0] ?? 'UNIT';
const denom = 10n ** BigInt(decimals);
const fmt = (v) => `${(Number(v) / Number(denom)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${symbol}`;

console.log(`\n▶ Balance for ${sxtAddr}:`);
console.log(`  Free:     ${free} (${fmt(free)})`);
console.log(`  Reserved: ${reserved} (${fmt(reserved)})`);
console.log(`  Decimals: ${decimals}, Token: ${symbol}`);

console.log(`\n▶ Fee estimate for the publish transactions...`);
try {
  const ns = `MY_AUDIT_${wallet.address.slice(2).toUpperCase()}`;
  const tbl = 'STAKERS';
  const createNs = api.tx.tables.createNamespace(
    ns, 0, `CREATE SCHEMA IF NOT EXISTS ${ns}`, 'Community', { UserCreated: 'agent' },
  );
  const createTbl = api.tx.tables.createTables([{
    ident: { namespace: ns, name: tbl },
    createStatement: `CREATE TABLE ${ns}.${tbl} (STAKER VARCHAR NOT NULL, PRIMARY KEY (STAKER))`,
    tableType: 'Community',
    commitment: { Empty: { hyperKzg: true } },
    source: { UserCreated: 'agent' },
  }]);
  const batched = api.tx.utility.batchAll([createNs, createTbl]);

  const info = await batched.paymentInfo(signer.address, { signer });
  const fee = BigInt(info.partialFee.toString());
  console.log(`  CREATE namespace+table partialFee: ${fee} (${fmt(fee)})`);
  console.log(`  Weight: ${info.weight.toString()}`);
  if (free >= fee) {
    console.log(`\n✔ Free balance covers the create-table fee with ${fmt(free - fee)} to spare.`);
  } else {
    console.log(`\n✘ Free balance is short by ${fmt(fee - free)} for just the create-table tx.`);
  }
} catch (e) {
  console.log(`  paymentInfo lookup failed: ${e.message}`);
}

await api.disconnect();
