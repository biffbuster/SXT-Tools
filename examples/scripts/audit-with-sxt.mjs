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

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const API_BASE = process.env.SXT_API_BASE ?? 'https://api.makeinfinite.dev';
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
  console.log(`  Endpoint: ${API_BASE}/v2/sql`);
  console.log(`  SQL: ${sql}`);
  console.log('');

  const url = `${API_BASE}/v2/sql`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sqlText: sql,
        proveExecution: true,
      }),
    });
  } catch (err) {
    console.error(`✗ Network error: ${err.message}`);
    console.error('  Confirm SXT_API_BASE is correct and your network can reach it.');
    process.exit(1);
  }

  const text = await response.text();
  if (!response.ok) {
    console.error(`✗ SXT API returned ${response.status}`);
    console.error(`  Body: ${text}`);
    console.error('');
    console.error('  Common causes:');
    console.error('    - Compute credits not funded. Top up at chain.spaceandtime.io.');
    console.error('    - Reference table does not exist yet. Publish MY_AUDIT.KNOWN_EXPLOITS first via chain.spaceandtime.io UI.');
    console.error('    - SXT_API_BASE or endpoint path is wrong. Confirm against current docs at docs.spaceandtime.io.');
    console.error('    - API key lacks dql_select permission on the table.');
    process.exit(1);
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    console.error('✗ SXT response was not valid JSON. Raw body:');
    console.error(text);
    process.exit(1);
  }

  console.log('--- Raw response ---');
  console.log(JSON.stringify(result, null, 2));
  console.log('');

  // Different SXT REST builds expose proof receipts under different keys.
  // Print whichever one we find.
  const proofReceipt =
    result.proofReceipt ??
    result.proof_receipt ??
    result.proof?.receipt ??
    result.proof?.hash ??
    null;

  const rows =
    result.rows ??
    result.data ??
    result.result?.rows ??
    [];

  console.log('--- Audit verdict ---');
  if (Array.isArray(rows) && rows.length > 0) {
    const match = rows[0];
    const exploitType = match.EXPLOIT_TYPE ?? match.exploit_type ?? '(unknown)';
    const severity = match.SEVERITY ?? match.severity ?? '(unknown)';
    const source = match.SOURCE_URL ?? match.source_url ?? '(none)';
    console.log(`⚠ MATCH FOUND in ${TABLE}`);
    console.log(`  Hash:       ${bytecodeHash}`);
    console.log(`  Exploit:    ${exploitType}`);
    console.log(`  Severity:   ${severity}`);
    console.log(`  Source:     ${source}`);
    console.log(`  Verdict:    BLOCK DEPLOY — investigate before proceeding`);
  } else {
    console.log(`✓ No match found for ${bytecodeHash} in ${TABLE}.`);
    console.log('  This does not mean the contract is safe — it only means the hash');
    console.log('  is not in your reference dataset. Combine with static analysis.');
  }

  console.log('');
  if (proofReceipt) {
    console.log(`Proof receipt: ${proofReceipt}`);
    console.log('Verify against the SxT Onchain Verifier:');
    console.log('  Ethereum: 0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9');
    console.log('  Base:     0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518');
  } else {
    console.log('Note: no proof receipt field found in the response.');
    console.log('Confirm `proveExecution: true` is the correct flag for your SxT API version.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
