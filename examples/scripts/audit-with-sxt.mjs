#!/usr/bin/env node
/**
 * Tier 3 demo script: audit a contract by cross-referencing its bytecode hash
 * against MY_AUDIT.KNOWN_EXPLOITS on Space and Time, with a Proof of SQL receipt.
 *
 * Usage:
 *   node examples/scripts/audit-with-sxt.mjs --demo
 *   node examples/scripts/audit-with-sxt.mjs ./examples/contracts/SampleToken.sol
 *   node examples/scripts/audit-with-sxt.mjs --hash 0xabc123...
 *
 * Required env vars:
 *   SXT_API_KEY  Your Space and Time API key (get from chain.spaceandtime.io)
 *
 * Optional env vars:
 *   SXT_API_BASE  Override the SXT REST endpoint. Default: https://api.makeinfinite.dev
 *   SXT_TABLE     Override the reference table. Default: MY_AUDIT.KNOWN_EXPLOITS
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SxTClient } from 'sxt-proof-of-sql-sdk';

const PROVER = process.env.SXT_PROVER ?? 'https://api.makeinfinite.dev';
const AUTH   = process.env.SXT_AUTH   ?? 'https://proxy.api.makeinfinite.dev/auth/apikey';
const RPC    = process.env.SXT_RPC_HTTP ?? 'https://rpc.mainnet.sxt.network/';
const TABLE = process.env.SXT_TABLE ?? 'MY_AUDIT.KNOWN_EXPLOITS';
const DEMO_HASH = '0xDEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0';

function parseArgs(argv) {
  const args = { demo: false, hash: null, source: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') args.demo = true;
    else if (a === '--hash') args.hash = argv[++i];
    else if (!args.source && !a.startsWith('--')) args.source = a;
  }
  return args;
}

function hashSource(path) {
  const buf = readFileSync(path);
  return '0x' + createHash('sha256').update(buf).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv);
  const apiKey = process.env.SXT_API_KEY;

  if (!apiKey) {
    console.error('✗ SXT_API_KEY env var is not set.');
    console.error('  Get a key from https://chain.spaceandtime.io after connecting your wallet.');
    process.exit(1);
  }

  let bytecodeHash;
  if (args.demo) {
    bytecodeHash = DEMO_HASH;
    console.log('▶ Running in demo mode — using the known demo-marker hash.');
  } else if (args.hash) {
    bytecodeHash = args.hash;
    console.log(`▶ Using provided hash: ${bytecodeHash}`);
  } else if (args.source) {
    if (!existsSync(args.source)) {
      console.error(`✗ Source file not found: ${args.source}`);
      process.exit(1);
    }
    bytecodeHash = hashSource(args.source);
    console.log(`▶ Computed SHA-256 of ${args.source}`);
    console.log(`  Hash: ${bytecodeHash}`);
    console.log('  (production audits should hash the compiled bytecode via solc; this demo hashes the source file for reproducibility without a solc install.)');
  } else {
    console.error('Usage:');
    console.error('  node examples/scripts/audit-with-sxt.mjs --demo');
    console.error('  node examples/scripts/audit-with-sxt.mjs <path-to-solidity-file>');
    console.error('  node examples/scripts/audit-with-sxt.mjs --hash <0x...>');
    process.exit(1);
  }

  const sql = `SELECT BYTECODE_HASH, EXPLOIT_TYPE, SEVERITY, SOURCE_URL, REPORTED_AT FROM ${TABLE} WHERE BYTECODE_HASH = '${bytecodeHash}'`;

  console.log('');
  console.log(`▶ Querying ${TABLE} via Proof of SQL...`);
  console.log(`  Prover:   ${PROVER}/v1/zkquery`);
  console.log(`  SQL:      ${sql}`);
  console.log('');

  const client = new SxTClient(PROVER, AUTH, RPC, apiKey);
  let result;
  try {
    result = await client.queryAndVerify(sql);
  } catch (err) {
    console.error(`✗ SXT prover error: ${err?.message ?? err}`);
    console.error('');
    console.error('  Common causes:');
    console.error('    - Reference table not in the MAINNET catalog (most often a PRIMARY KEY in the original DDL).');
    console.error('    - SXT_API_KEY is missing or expired.');
    console.error('    - Reference table does not exist yet. Publish MY_AUDIT.KNOWN_EXPLOITS first via the dataset-publish skill or chain.spaceandtime.io UI.');
    process.exit(1);
  }

  console.log('--- Verified result ---');
  console.log(JSON.stringify(result, null, 2));
  console.log('');

  const rows = Array.isArray(result?.rows) ? result.rows
    : Array.isArray(result?.data) ? result.data
    : [];

  console.log('--- Audit verdict ---');
  if (rows.length > 0) {
    const match = rows[0];
    const exploitType = match.EXPLOIT_TYPE ?? match.exploit_type ?? '(unknown)';
    const severity = match.SEVERITY ?? match.severity ?? '(unknown)';
    const source = match.SOURCE_URL ?? match.source_url ?? '(none)';
    console.log(`⚠ MATCH FOUND in ${TABLE}`);
    console.log(`  Hash:       ${bytecodeHash}`);
    console.log(`  Exploit:    ${exploitType}`);
    console.log(`  Severity:   ${severity}`);
    console.log(`  Source:     ${source}`);
    console.log(`  Verdict:    BLOCK DEPLOY. Investigate before proceeding.`);
  } else {
    console.log(`✓ No match found for ${bytecodeHash} in ${TABLE}.`);
    console.log('  This does not mean the contract is safe. It means the hash');
    console.log('  is not in your reference dataset. Combine with static analysis.');
  }

  console.log('');
  console.log('Proof verified locally by the SxT SDK. The receipt is also on-chain-verifiable via:');
  console.log('  Ethereum verifier: 0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9');
  console.log('  Base verifier:     0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
