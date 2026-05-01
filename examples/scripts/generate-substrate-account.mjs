#!/usr/bin/env node
/**
 * generate-substrate-account.mjs
 *
 * Generate a fresh sr25519 Substrate account for use as the SXT chain table owner.
 * Prints a 12-word mnemonic and the corresponding SS58 address, so you can:
 *   1. Save the mnemonic offline (your secret).
 *   2. Send SXT testnet tokens from your MetaMask account to the SS58 address.
 *   3. Use the mnemonic as SXT_OWNER_SEED when running publish-dataset-cli.mjs.
 *
 * Usage:
 *   node generate-substrate-account.mjs
 *
 * Optional env vars:
 *   SXT_KEY_TYPE   "sr25519" or "ed25519". Default: "sr25519"
 *   SXT_SS58_FORMAT  Numeric SS58 prefix. Default: 42 (generic Substrate)
 *
 * SECURITY:
 *   The mnemonic this script prints is a private key. Treat it like one:
 *     - Save it offline (password manager or paper backup).
 *     - Never commit it, never paste it into a chat / Slack / issue tracker.
 *     - Don't share screenshots of the terminal output.
 *   This script doesn't write the mnemonic to disk — it only prints it once.
 */

import { mnemonicGenerate, cryptoWaitReady } from '@polkadot/util-crypto';
import { Keyring } from '@polkadot/keyring';

const KEY_TYPE = process.env.SXT_KEY_TYPE ?? 'sr25519';
const SS58_FORMAT = process.env.SXT_SS58_FORMAT
  ? Number(process.env.SXT_SS58_FORMAT)
  : 42;

await cryptoWaitReady();

const mnemonic = mnemonicGenerate(12);
const keyring = new Keyring({ type: KEY_TYPE, ss58Format: SS58_FORMAT });
const account = keyring.addFromUri(mnemonic);

const publicKeyHex = '0x' + Buffer.from(account.publicKey).toString('hex');

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Fresh Substrate account (${KEY_TYPE}) generated`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('  Mnemonic (12 words) — save offline, never share:');
console.log('');
console.log(`    ${mnemonic}`);
console.log('');
console.log('  SS58 address (send SXT testnet tokens here):');
console.log('');
console.log(`    ${account.address}`);
console.log('');
console.log('  Public key (hex, for chain explorers / debugging):');
console.log('');
console.log(`    ${publicKeyHex}`);
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('Next steps:');
console.log('  1. Copy the mnemonic into a secure place (password manager).');
console.log('  2. On chain.spaceandtime.io (connected with MetaMask), find the');
console.log('     transfer / send function and send testnet SXT tokens to the');
console.log('     SS58 address above. A small amount is plenty — table creation');
console.log('     and inserts cost a tiny fraction of a credit per call.');
console.log('  3. In your terminal:');
console.log('       export SXT_OWNER_SEED="<the 12 words>"');
console.log('  4. Publish your CSV:');
console.log('       node publish-dataset-cli.mjs \\');
console.log('         ../data/known-exploits-sample.csv \\');
console.log('         MY_AUDIT.KNOWN_EXPLOITS \\');
console.log('         --schema ../data/known-exploits-sample.schema.json');
console.log('');
console.log('Security reminder: the mnemonic above is the ONLY way to control');
console.log('this account. Anyone who sees it controls anything funded to it.');
console.log('');
