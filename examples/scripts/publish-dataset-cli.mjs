#!/usr/bin/env node
/**
 * publish-dataset-cli.mjs
 *
 * Publish a CSV to Space and Time as a chain-secured table from the CLI —
 * signed with a standard Ethereum private key (no Substrate seed needed).
 *
 * Uses the official SxT EthEcdsa signing pattern documented at
 * chain.spaceandtime.io → "Programmatic Table Creation" tutorial.
 *
 * Usage:
 *   node publish-dataset-cli.mjs <csv-path> <PREFIX.TABLE> [--schema <schema.json>]
 *
 * Example:
 *   node publish-dataset-cli.mjs \
 *     ../data/known-exploits-sample.csv \
 *     MY_AUDIT.KNOWN_EXPLOITS \
 *     --schema ../data/known-exploits-sample.schema.json
 *
 * Required env vars (use a .env file or export them):
 *   PRIVATE_KEY    Ethereum private key (0x-prefixed) of an account that
 *                  has SxT chain credits funded. Recommended: a fresh ETH
 *                  key dedicated to SxT testnet, NOT your main MetaMask.
 *
 * Optional env vars:
 *   SXT_RPC        WebSocket endpoint. Default: wss://rpc.testnet.sxt.network
 *   SXT_TABLE_TYPE "Community" | "OwnerPermissioned" | "UserVerified". Default: Community
 *
 * IMPORTANT:
 *   - Namespaces on SxT chain MUST end with the wallet address (without 0x).
 *     This script auto-appends the address suffix to your <PREFIX>.
 *     Effective namespace: <PREFIX>_<UPPERCASE_HEX_ADDRESS>
 *   - All columns must be NOT NULL (chain rule for Proof of SQL).
 *     This script renders NOT NULL on every column automatically.
 *   - Data insertion requires the IndexingPallet.SubmitDataForPrivilegedQuorum
 *     permission. If your account lacks it, table creation succeeds but the
 *     insert step fails — use the chain.spaceandtime.io UI for the data load,
 *     or contact SxT to request the permission.
 */

import 'dotenv/config';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { tableFromJSON, tableToIPC } from 'apache-arrow';
import { parse as parseCsv } from 'csv-parse/sync';
import { Wallet } from 'ethers';
import { readFileSync, existsSync } from 'node:fs';
import { EthEcdsaSigner } from './ethecdsa_signer.mjs';

const RPC = process.env.SXT_RPC ?? 'wss://rpc.testnet.sxt.network';
const TABLE_TYPE = process.env.SXT_TABLE_TYPE ?? 'Community';

// ───────────────────────────────────────────────────────────────────────────
// Argument parsing

function parseArgs(argv) {
  const args = { csvPath: null, tableRef: null, schemaPath: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--schema') args.schemaPath = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else if (!args.csvPath) args.csvPath = a;
    else if (!args.tableRef) args.tableRef = a;
  }
  return args;
}

function printUsage() {
  console.error('Usage:');
  console.error('  node publish-dataset-cli.mjs <csv-path> <PREFIX.TABLE> [--schema <schema.json>]');
  console.error('');
  console.error('Example:');
  console.error('  node publish-dataset-cli.mjs \\');
  console.error('    ../data/known-exploits-sample.csv \\');
  console.error('    MY_AUDIT.KNOWN_EXPLOITS \\');
  console.error('    --schema ../data/known-exploits-sample.schema.json');
  console.error('');
  console.error('Required: PRIVATE_KEY env var (0x-prefixed Ethereum private key).');
}

// ───────────────────────────────────────────────────────────────────────────
// Schema inference (used when --schema is not provided)

function inferColumnTypes(rows) {
  if (rows.length === 0) {
    throw new Error('CSV has no rows — cannot infer schema. Pass --schema explicitly.');
  }
  const cols = Object.keys(rows[0]);
  const types = {};
  for (const c of cols) {
    const v = rows[0][c];
    if (v === '' || v === null || v === undefined) {
      types[c] = 'VARCHAR';
    } else if (/^-?\d+$/.test(String(v))) {
      types[c] = 'BIGINT';
    } else if (/^-?\d+\.\d+$/.test(String(v))) {
      types[c] = 'DECIMAL(38,10)';
    } else if (/^(true|false)$/i.test(String(v))) {
      types[c] = 'BOOLEAN';
    } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(String(v))) {
      types[c] = 'TIMESTAMP';
    } else {
      types[c] = 'VARCHAR';
    }
  }
  return types;
}

function buildCreateStatement(namespace, table, columnTypes, primaryKey) {
  // Chain rule: every column must be NOT NULL for Proof of SQL determinism.
  const lines = Object.entries(columnTypes).map(([col, t]) => `  ${col} ${t} NOT NULL`);
  lines.push(`  PRIMARY KEY (${primaryKey})`);
  return `CREATE TABLE ${namespace}.${table} (\n${lines.join(',\n')}\n)`;
}

// ───────────────────────────────────────────────────────────────────────────
// Promise-wrapped signAndSend

function submitTx(label, tx, signer, signerAddress, api) {
  return new Promise((resolve, reject) => {
    let unsub = null;
    tx.signAndSend(signerAddress, { signer }, ({ status, dispatchError }) => {
      if (dispatchError) {
        if (dispatchError.isModule) {
          const decoded = api.registry.findMetaError(dispatchError.asModule);
          reject(new Error(
            `${label} module error: ${decoded.section}.${decoded.name}` +
            (decoded.docs?.length ? ` — ${decoded.docs.join(' ')}` : ''),
          ));
        } else {
          reject(new Error(`${label} dispatch error: ${dispatchError.toString()}`));
        }
        if (unsub) unsub();
        return;
      }
      if (status.isInBlock) {
        console.log(`  ${label} included in block: ${status.asInBlock.toHex()}`);
      } else if (status.isFinalized) {
        console.log(`  ${label} finalized in block: ${status.asFinalized.toHex()}`);
        if (unsub) unsub();
        resolve(status.asFinalized.toHex());
      } else if (status.isInvalid || status.isDropped) {
        if (unsub) unsub();
        reject(new Error(`${label} ${status.type}`));
      }
    }).then((u) => { unsub = u; }).catch(reject);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Main

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.csvPath || !args.tableRef) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('✗ PRIVATE_KEY env var is not set.');
    console.error('');
    console.error('  Set a 0x-prefixed Ethereum private key for an account funded with');
    console.error('  SxT testnet credits. Recommended: a fresh ETH key dedicated to SxT,');
    console.error('  NOT your main MetaMask account.');
    console.error('');
    console.error('  Create a .env file in this directory:');
    console.error('    echo "PRIVATE_KEY=0xyour_ethereum_private_key" > .env');
    process.exit(1);
  }

  const [prefix, table] = args.tableRef.split('.');
  if (!prefix || !table) {
    console.error(`✗ Table reference must be PREFIX.TABLE format. Got: "${args.tableRef}"`);
    process.exit(1);
  }

  if (!existsSync(args.csvPath)) {
    console.error(`✗ CSV file not found: ${args.csvPath}`);
    process.exit(1);
  }

  // ─── Load CSV ─────────────────────────────────────────────────────────
  console.log(`▶ Reading ${args.csvPath}`);
  const csvText = readFileSync(args.csvPath, 'utf8');
  const rows = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  console.log(`  Parsed ${rows.length} rows`);

  // ─── Determine schema ─────────────────────────────────────────────────
  let columnTypes;
  let primaryKey;

  if (args.schemaPath) {
    if (!existsSync(args.schemaPath)) {
      console.error(`✗ Schema file not found: ${args.schemaPath}`);
      process.exit(1);
    }
    const schemaJson = JSON.parse(readFileSync(args.schemaPath, 'utf8'));
    columnTypes = schemaJson.columns;
    primaryKey = schemaJson.primaryKey;
    if (!columnTypes || !primaryKey) {
      console.error('✗ Schema file must contain "columns" object and "primaryKey" string.');
      process.exit(1);
    }
    console.log(`  Loaded explicit schema from ${args.schemaPath}`);
  } else {
    columnTypes = inferColumnTypes(rows);
    primaryKey = Object.keys(columnTypes)[0];
    console.log('  Inferred column types (pass --schema for explicit control):');
    for (const [c, t] of Object.entries(columnTypes)) {
      console.log(`    ${c}: ${t}${c === primaryKey ? ' (PRIMARY KEY, default)' : ''}`);
    }
  }

  // ─── Connect to SxT chain ─────────────────────────────────────────────
  console.log('');
  console.log(`▶ Connecting to ${RPC}`);
  const provider = new WsProvider(RPC);
  const api = await ApiPromise.create({ provider, noInitWarn: true });
  const chainName = (await api.rpc.system.chain()).toString();
  console.log(`  Connected. Chain: ${chainName}`);

  // ─── Build wallet + EthEcdsa signer ───────────────────────────────────
  const wallet = new Wallet(privateKey);
  const signer = new EthEcdsaSigner(wallet, api);
  console.log(`  Signer ETH address: ${wallet.address}`);
  console.log(`  Signer SxT address: ${signer.address} (12 zero bytes + ETH addr)`);

  // ─── Compute namespace per chain rule ─────────────────────────────────
  // Rule: namespace must end with wallet address (without 0x), uppercase.
  const addressSuffix = wallet.address.slice(2).toUpperCase();
  const namespace = `${prefix}_${addressSuffix}`;
  console.log('');
  console.log(`▶ Effective namespace: ${namespace}`);
  console.log(`  Effective table reference: ${namespace}.${table}`);

  const createStatement = buildCreateStatement(namespace, table, columnTypes, primaryKey);
  console.log('');
  console.log('▶ CREATE TABLE statement:');
  console.log(createStatement.split('\n').map((l) => `    ${l}`).join('\n'));

  // ─── Build createNamespace + createTables (batched) ───────────────────
  if (!api.tx.tables?.createNamespace || !api.tx.tables?.createTables) {
    console.error('');
    console.error('✗ api.tx.tables.{createNamespace, createTables} not available on this chain.');
    console.error('  Available methods on api.tx.tables:');
    if (api.tx.tables) {
      for (const m of Object.keys(api.tx.tables)) {
        console.error(`    api.tx.tables.${m}`);
      }
    }
    await api.disconnect();
    process.exit(1);
  }

  const createNamespaceTx = api.tx.tables.createNamespace(
    namespace,
    0,
    `CREATE SCHEMA IF NOT EXISTS ${namespace}`,
    TABLE_TYPE,
    { UserCreated: 'dreamspace-ai-cli-v0.1' },
  );

  const createTablesTx = api.tx.tables.createTables([
    {
      ident: { namespace, name: table },
      createStatement,
      tableType: TABLE_TYPE,
      commitment: { Empty: { hyperKzg: true } },
      source: { UserCreated: 'dreamspace-ai-cli-v0.1' },
    },
  ]);

  const batchTx = api.tx.utility.batchAll([createNamespaceTx, createTablesTx]);

  console.log('');
  console.log('▶ Submitting batched CREATE NAMESPACE + CREATE TABLE transaction...');
  await submitTx('createTable batch', batchTx, signer, signer.address, api);

  // ─── Insert data ──────────────────────────────────────────────────────
  // Note: data insertion requires IndexingPallet.SubmitDataForPrivilegedQuorum.
  // If your account lacks this permission, the call below will fail with a
  // BadOrigin or permission error. In that case, the table is created — load
  // data via the chain.spaceandtime.io CSV upload UI instead.
  console.log('');
  console.log(`▶ Encoding ${rows.length} rows as Apache Arrow IPC...`);
  const arrowTable = tableFromJSON(rows);
  const ipc = tableToIPC(arrowTable);
  console.log(`  Encoded ${ipc.byteLength} bytes`);

  const candidateMethods = ['insertIntoTable', 'insertData', 'insert', 'insertRows', 'append'];
  let insertMethod = null;
  for (const m of candidateMethods) {
    if (typeof api.tx.tables[m] === 'function') {
      insertMethod = m;
      break;
    }
  }

  if (!insertMethod) {
    console.error('');
    console.error('⚠ No matching insert method found on api.tx.tables.');
    console.error(`  Tried: ${candidateMethods.join(', ')}`);
    console.error('  Available methods:');
    for (const m of Object.keys(api.tx.tables)) {
      console.error(`    api.tx.tables.${m}`);
    }
    console.error('');
    console.error('  TABLE WAS CREATED SUCCESSFULLY — only the insert step is missing.');
    console.error('  Load data via the chain.spaceandtime.io CSV upload UI:');
    console.error(`    Schema: ${namespace}`);
    console.error(`    Table:  ${table}`);
    await api.disconnect();
    process.exit(0);
  }

  console.log('');
  console.log(`▶ Submitting INSERT transaction via api.tx.tables.${insertMethod}...`);
  console.log('  (requires IndexingPallet.SubmitDataForPrivilegedQuorum permission)');
  try {
    const insertTx = api.tx.tables[insertMethod](
      { namespace, name: table },
      Array.from(ipc),
    );
    await submitTx('insert', insertTx, signer, signer.address, api);
  } catch (err) {
    console.error('');
    console.error(`⚠ Insert failed: ${err.message}`);
    console.error('  TABLE WAS CREATED SUCCESSFULLY — load data via chain.spaceandtime.io UI:');
    console.error(`    Schema: ${namespace}`);
    console.error(`    Table:  ${table}`);
    await api.disconnect();
    process.exit(0);
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✅ Published ${rows.length} rows to ${namespace}.${table}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('Verify with a proven SELECT:');
  console.log('');
  console.log(`  curl -sS -X POST "https://api.makeinfinite.dev/v2/sql" \\`);
  console.log(`    -H "Authorization: Bearer $SXT_API_KEY" \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"sqlText": "SELECT COUNT(*) AS ROWS FROM ${namespace}.${table}", "proveExecution": true}'`);
  console.log('');

  await api.disconnect();
}

main().catch(async (err) => {
  console.error('');
  console.error('✗ Failed:');
  console.error(`  ${err.message}`);
  if (process.env.DEBUG && err.stack) {
    console.error('');
    console.error(err.stack);
  }
  console.error('');
  console.error('  Run with DEBUG=1 to see the full stack trace.');
  process.exit(1);
});
