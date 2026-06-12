#!/usr/bin/env node
/**
 * index-contract.mjs
 *
 * Register an EVM smart contract's events for Space and Time Smart Contract
 * Indexing (SCI) from the CLI — signed with a standard Ethereum private key.
 *
 * Submits `tables.createTableWithSciMetadata` per event (the same extrinsic
 * the chain.spaceandtime.io Studio UI uses — verified by reading live
 * `api.query.tables.tableMetadata` entries on SXT mainnet, June 2026). The
 * per-event metadata JSON byte-matches the observed on-chain format:
 *
 *   {"columns":[["STAKER","BINARY"],["AMOUNT","DECIMAL(75,0)"],
 *               ["BLOCK_NUMBER"],["TIME_STAMP"]],
 *    "contract_address":"0x93d1…",
 *    "event_signature":"event Staked(address staker, uint248 amount)",
 *    "starting_position":24986157}
 *
 * Usage (keyless — recommended; what you type is exactly what's stored):
 *   node index-contract.mjs --address 0x… --chain ethereum \
 *     --event-signature "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)" \
 *     [--namespace MY_PROJECT]
 *
 * Usage (ABI-fetch mode — requires ETHERSCAN_API_KEY, contract must be verified):
 *   node index-contract.mjs --address 0x… --chain ethereum --events Transfer,Approval
 *
 * Other flags:
 *   --starting-block N   Index from block N instead of the current head.
 *                        NOTE: SXT SCI is live-only today — historical backfill
 *                        is "coming soon" per the Studio UI. A past block here
 *                        is not guaranteed to backfill.
 *   --dry-run            Print the full plan incl. encoded extrinsics; sign nothing.
 *   --yes                Skip the confirmation prompt (scripted use).
 *
 * Required env vars:
 *   PRIVATE_KEY    Ethereum private key (0x-prefixed) funded with SXT chain
 *                  credits at https://chain.spaceandtime.io.
 *
 * Optional env vars:
 *   SXT_RPC             Default: wss://rpc.mainnet.sxt.network
 *                       Rehearse on testnet first: wss://rpc.testnet.sxt.network
 *   ETHERSCAN_API_KEY   Only needed for --events (ABI-fetch) mode. One v2 key
 *                       covers all supported chains via the chainid param.
 *
 * IMPORTANT:
 *   - Supported chains = the SXT chain's Source enum: ethereum, sepolia,
 *     polygon, zksync. There is NO Base variant on-chain today (verified
 *     against live chain metadata, June 2026) — `--chain base` is rejected.
 *   - SCI tables are NOT on the zk-proven surface yet. Registration + data
 *     ingestion work; /v1/zkquery proofs and on-chain query() do NOT until
 *     SXT promotes SCI tables to the zk-committed catalog.
 *   - Tables start indexing only after their funding account holds >=100 SXT.
 *     The funding-account derivation is not exposed on-chain
 *     (TODO(discovery): not in Tables pallet events/constants — the Studio UI
 *     displays it); this script prints instructions to fund via the UI.
 *   - All columns are NOT NULL and there is NEVER a PRIMARY KEY clause —
 *     tables created with a PRIMARY KEY fail to promote into the dreamspace
 *     MAINNET catalog (the indexer skips them silently).
 */

import 'dotenv/config';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Wallet, EventFragment, getAddress } from 'ethers';
import { createInterface } from 'node:readline/promises';
import { EthEcdsaSigner } from './ethecdsa_signer.mjs';
import { writeLastPublish, readLastPublish, extractPrefix } from './lib/last-publish.mjs';

const RPC = process.env.SXT_RPC ?? 'wss://rpc.mainnet.sxt.network';

// Source enum variants verified against live SXT chain metadata (June 2026):
// Ethereum | Sepolia | Bitcoin | Polygon | ZkSyncEra | UserCreated.
// Bitcoin has no EVM events; Base does not exist as a Source variant.
const CHAIN_CONFIG = {
  ethereum: { source: 'Ethereum', etherscanChainId: 1, evmRpc: 'https://ethereum.publicnode.com' },
  sepolia: { source: 'Sepolia', etherscanChainId: 11155111, evmRpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
  polygon: { source: 'Polygon', etherscanChainId: 137, evmRpc: 'https://polygon-bor-rpc.publicnode.com' },
  zksync: { source: 'ZkSyncEra', etherscanChainId: 324, evmRpc: 'https://mainnet.era.zksync.io' },
};

// ───────────────────────────────────────────────────────────────────────────
// Argument parsing

function parseArgs(argv) {
  const args = {
    address: null, chain: null, events: null, signatures: [],
    namespace: null, startingBlock: null, dryRun: false, yes: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--address') args.address = argv[++i];
    else if (a === '--chain') args.chain = argv[++i];
    else if (a === '--events') args.events = argv[++i];
    else if (a === '--event-signature') args.signatures.push(argv[++i]);
    else if (a === '--namespace') args.namespace = argv[++i];
    else if (a === '--starting-block') args.startingBlock = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else {
      console.error(`✗ Unknown argument: ${a}`);
      args.help = true;
    }
  }
  return args;
}

function printUsage() {
  console.error('Usage:');
  console.error('  node index-contract.mjs --address <0x…> --chain <ethereum|sepolia|polygon|zksync> \\');
  console.error('    ( --event-signature "event Name(type name, …)" [--event-signature …] | --events Name1,Name2 ) \\');
  console.error('    [--namespace MY_PROJECT] [--starting-block N] [--dry-run] [--yes]');
  console.error('');
  console.error('Examples:');
  console.error('  # Keyless mode (recommended) — the signature you type is stored verbatim on chain.');
  console.error('  node index-contract.mjs --address 0xBd3531dA5CF5857e7CfAA92426877b022e612cf8 \\');
  console.error('    --chain ethereum \\');
  console.error('    --event-signature "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"');
  console.error('');
  console.error('  # ABI-fetch mode — needs ETHERSCAN_API_KEY; contract must be source-verified.');
  console.error('  node index-contract.mjs --address 0x… --chain ethereum --events Transfer');
  console.error('');
  console.error('  # Testnet rehearsal (separate credits from mainnet):');
  console.error('  SXT_RPC=wss://rpc.testnet.sxt.network node index-contract.mjs \\');
  console.error('    --address 0x… --chain sepolia --event-signature "event …" --dry-run');
  console.error('');
  console.error('Required: PRIVATE_KEY env var (0x-prefixed, funded with SXT chain credits).');
  console.error('');
  console.error('Note: SCI tables are NOT zk-provable yet — registration + ingestion only.');
  console.error('For proofs that work today use the chain-data-query skill (ETHEREUM.BLOCKS /');
  console.error('ETHEREUM.TRANSACTIONS).');
}

// ───────────────────────────────────────────────────────────────────────────
// ABI acquisition (Etherscan v2, --events mode only)

async function fetchVerifiedAbi(address, chainId, apiKey) {
  const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getabi&address=${address}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Etherscan v2 HTTP ${res.status}`);
  const body = await res.json();
  if (body.status !== '1') {
    const msg = String(body.result ?? body.message ?? 'unknown error');
    if (/not verified/i.test(msg)) {
      throw new Error(
        `Contract ${address} is not source-verified on the explorer.\n` +
        '  Use --event-signature "event Name(type name, …)" instead — it needs no ABI.',
      );
    }
    if (/rate limit/i.test(msg)) throw new Error(`Etherscan rate limit hit: ${msg}. Retry in a few seconds.`);
    throw new Error(`Etherscan getabi failed: ${msg}`);
  }
  return JSON.parse(body.result);
}

async function hintIfProxy(address, chainId, apiKey) {
  try {
    const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
    const body = await (await fetch(url)).json();
    const impl = body?.result?.[0]?.Implementation;
    if (impl && impl !== '' && impl.toLowerCase() !== address.toLowerCase()) {
      console.error(`  Hint: this looks like a proxy. Events are usually declared on the`);
      console.error(`  implementation at ${impl} — try --address ${impl}, or pass the`);
      console.error('  event declaration directly via --event-signature.');
    }
  } catch { /* hint only — never fail the run over this */ }
}

function resolveEventFragments({ abi, eventNames, signatures }) {
  const fragments = [];
  for (const sig of signatures) {
    fragments.push(EventFragment.from(sig));
  }
  if (eventNames) {
    if (!abi) throw new Error('internal: --events mode requires a fetched ABI');
    const abiEvents = abi.filter((e) => e.type === 'event');
    for (const name of eventNames.split(',').map((s) => s.trim()).filter(Boolean)) {
      const matches = abiEvents.filter((e) => e.name === name);
      if (matches.length === 0) {
        throw new Error(
          `Event "${name}" not found in the verified ABI.\n` +
          `  Events available: ${abiEvents.map((e) => e.name).join(', ') || '(none — proxy?)'}`,
        );
      }
      if (matches.length > 1) {
        throw new Error(
          `Event "${name}" is overloaded (${matches.length} declarations). Disambiguate with --event-signature:\n` +
          matches.map((m) => `    --event-signature "${EventFragment.from(m).format('full')}"`).join('\n'),
        );
      }
      fragments.push(EventFragment.from(matches[0]));
    }
  }
  for (const f of fragments) {
    if (f.anonymous) {
      throw new Error(`Event ${f.name} is anonymous — it has no topic0, so SXT cannot index it.`);
    }
  }
  return fragments;
}

// ───────────────────────────────────────────────────────────────────────────
// Event params → SXT columns

// SQL reserved words that would corrupt the generated DDL as bare column
// names. FROM/TO get SXT's own pre-indexed naming convention (the
// ETHEREUM.ERC*_TRANSFERS tables use FROM_ADDRESS / TO_ADDRESS); the rest are
// suffixed _COL. The SCI metadata's columns array carries these final names,
// so renaming here is the CLI equivalent of the Studio UI's column-rename step.
const RESERVED_RENAMES = { FROM: 'FROM_ADDRESS', TO: 'TO_ADDRESS' };
const RESERVED_WORDS = new Set([
  'FROM', 'TO', 'SELECT', 'WHERE', 'GROUP', 'ORDER', 'BY', 'TABLE', 'VALUES',
  'USER', 'INDEX', 'KEY', 'PRIMARY', 'AND', 'OR', 'NOT', 'NULL', 'IN', 'AS',
  'JOIN', 'ON', 'BETWEEN', 'LIKE', 'LIMIT', 'OFFSET', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'COUNT', 'SUM', 'MIN', 'MAX', 'AVG', 'TIMESTAMP', 'DATE',
]);

// camelCase → UPPER_SNAKE, matching observed Studio-registered SCI tables
// (roundId → ROUND_ID, startedBy → STARTED_BY).
function toColumnName(param, i) {
  const raw = param.name && param.name.length ? param.name : null;
  if (!raw) {
    console.error(`  ⚠ Param #${i} has no name in the declaration — column will be ARG${i}.`);
    return `ARG${i}`;
  }
  let name = raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  if (RESERVED_WORDS.has(name)) {
    const renamed = RESERVED_RENAMES[name] ?? `${name}_COL`;
    console.error(`  ⚠ Param "${raw}" maps to SQL reserved word ${name} — renamed to ${renamed}.`);
    name = renamed;
  }
  return name;
}

// Solidity → SXT SQL type. uint*/int* → DECIMAL(75,0) and address → BINARY are
// verified against live Studio-registered SCI tables; the rest follow the
// repo's CSV-path conventions and are conservative.
function solTypeToSql(type, indexed, paramLabel) {
  if (type.endsWith(']') || type.startsWith('tuple')) {
    throw new Error(
      `Param ${paramLabel} has type "${type}" — arrays/tuples are refused: SXT's SCI\n` +
      '  flattening behavior for composite types is undocumented. Index a different\n' +
      '  event, or wait for SXT to document composite support.',
    );
  }
  if ((type === 'string' || type === 'bytes') && indexed) {
    throw new Error(
      `Param ${paramLabel} is "indexed ${type}" — the EVM log topic only carries the\n` +
      '  keccak hash of the value, not the value itself. SXT cannot reconstruct it.\n' +
      '  Index a non-indexed declaration of this event if one exists.',
    );
  }
  if (/^u?int\d*$/.test(type)) return 'DECIMAL(75,0)'; // verified live (uint256, uint248)
  if (type === 'address') return 'BINARY'; // verified live
  if (/^bytes\d+$/.test(type) || type === 'bytes') return 'BINARY';
  if (type === 'bool') return 'BOOLEAN';
  if (type === 'string') return 'VARCHAR';
  throw new Error(`Param ${paramLabel}: no SXT type mapping for Solidity type "${type}".`);
}

const IMPLICIT_COLUMNS = ['BLOCK_NUMBER', 'TIME_STAMP'];

function buildEventColumns(fragment) {
  const cols = [];
  const seen = new Set();
  fragment.inputs.forEach((param, i) => {
    const name = toColumnName(param, i);
    if (IMPLICIT_COLUMNS.includes(name)) {
      throw new Error(
        `Event ${fragment.name} param "${param.name}" maps to column ${name}, which collides\n` +
        '  with the implicit SCI indexer column of the same name. Rename is not supported\n' +
        '  via CLI — register this event through the Studio UI (it allows column renames).',
      );
    }
    if (seen.has(name)) {
      throw new Error(`Event ${fragment.name}: two params map to the same column name ${name}.`);
    }
    seen.add(name);
    cols.push([name, solTypeToSql(param.type, param.indexed, `${fragment.name}.${param.name || i}`)]);
  });
  return cols;
}

// camelCase event name → UPPER_SNAKE table name (NewRound → NEW_ROUND,
// matching observed Studio-registered tables).
function toTableName(eventName) {
  return eventName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

// DDL matches the observed stored shape for SCI tables (single line,
// IF NOT EXISTS, implicit columns BLOCK_NUMBER BIGINT + TIME_STAMP TIMESTAMP,
// NOT NULL on everything). The chain appends the WITH (… TABLE_UUID …) clause
// itself — our own Community tables were submitted without one and the stored
// schema gained it, so we do NOT submit it.
// NEVER add a PRIMARY KEY clause — tables created with one fail to promote
// into the dreamspace MAINNET catalog (the indexer skips them silently and
// the on-chain QueryRouter executor drops queries against them).
function buildCreateStatement(namespace, table, columns) {
  const cols = [
    ...columns.map(([name, type]) => `${name} ${type} NOT NULL`),
    'BLOCK_NUMBER BIGINT NOT NULL',
    'TIME_STAMP TIMESTAMP NOT NULL',
  ];
  return `CREATE TABLE IF NOT EXISTS ${namespace}.${table} (${cols.join(', ')})`;
}

// Metadata JSON in the exact observed key order. The implicit columns appear
// as single-element arrays (no type) — that is the on-chain convention.
function buildSciMetadata({ columns, address, fragment, startingPosition }) {
  return JSON.stringify({
    columns: [...columns, ['BLOCK_NUMBER'], ['TIME_STAMP']],
    contract_address: address.toLowerCase(),
    event_signature: fragment.format('full'),
    starting_position: startingPosition,
  });
}

// The SXT testnet WS endpoint answers small RPCs but drops the large
// state_getMetadata response frame (verified June 2026), which hangs
// ApiPromise.create for 60s+ per attempt. Work around it by prefetching the
// metadata over the HTTP endpoint (which serves large bodies fine) and
// passing it to ApiPromise.create as a cache, so init never requests the
// big frame over WS. Falls back to plain create when HTTP is unreachable.
async function createApiResilient(rpcUrl) {
  const provider = new WsProvider(rpcUrl);
  const httpUrl = process.env.SXT_RPC_HTTP
    ?? rpcUrl.replace(/^wss:\/\//, 'https://').replace(/\/?$/, '/');
  const rpcPost = async (method) => {
    const res = await fetch(httpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json();
    if (!body.result) throw new Error(`${method} returned no result`);
    return body.result;
  };
  try {
    let metadataHex, genesisHash, runtimeVersion;
    // First connection to the SXT endpoints can time out (cold route);
    // one retry is enough in practice.
    for (let attempt = 1; ; attempt++) {
      try {
        [metadataHex, genesisHash, runtimeVersion] = await Promise.all([
          rpcPost('state_getMetadata'),
          (async () => {
            const r = await fetch(httpUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getBlockHash', params: [0] }),
              signal: AbortSignal.timeout(20000),
            });
            return (await r.json()).result;
          })(),
          rpcPost('state_getRuntimeVersion'),
        ]);
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
      }
    }
    return ApiPromise.create({
      provider,
      noInitWarn: true,
      metadata: { [`${genesisHash}-${runtimeVersion.specVersion}`]: metadataHex },
    });
  } catch {
    // HTTP prefetch unavailable — let the WS provider do the full init.
    return ApiPromise.create({ provider, noInitWarn: true });
  }
}

async function getStartingBlock(chainKey, override) {
  if (override != null) {
    const n = Number(override);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--starting-block must be a non-negative integer, got "${override}"`);
    return n;
  }
  const rpc = CHAIN_CONFIG[chainKey].evmRpc;
  // First connection to a cold host can time out (observed with undici on
  // Windows against several public RPCs) — retry a couple of times.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json();
      if (!body.result) throw new Error(`eth_blockNumber failed against ${rpc}: ${JSON.stringify(body).slice(0, 200)}`);
      return parseInt(body.result, 16);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`eth_blockNumber failed against ${rpc} after 3 attempts: ${lastErr?.cause?.message ?? lastErr?.message ?? lastErr}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Promise-wrapped signAndSend — copied from publish-dataset-cli.mjs (keep in
// sync; duplicated rather than extracted because that file is load-bearing).

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

const isAlreadyExistsError = (err) =>
  /VersionAlreadyExists|TableAlreadyExists|NamespaceAlreadyExists|already exists/i.test(
    String(err?.message ?? err),
  );

const isPermissionError = (err) =>
  /BadOrigin|Permission|NotAuthorized|Unauthorized/i.test(String(err?.message ?? err));

async function confirmOrAbort({ isMainnet, yes }) {
  if (yes) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (isMainnet) {
      const answer = await rl.question(
        '  This writes SCI tables to SXT MAINNET. Creation BURNS 20 SXT per table,\n' +
        '  and starting the indexer later needs >=100 SXT per table on top.\n' +
        '  Type "mainnet" to proceed: ',
      );
      if (answer.trim() !== 'mainnet') {
        console.error('  Aborted (did not receive "mainnet").');
        process.exit(1);
      }
    } else {
      const answer = await rl.question('  Proceed with registration? [y/N]: ');
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.error('  Aborted.');
        process.exit(1);
      }
    }
  } finally {
    rl.close();
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Main

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.address || !args.chain || (!args.events && args.signatures.length === 0)) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  if (args.chain === 'base') {
    console.error('✗ --chain base is not supported: the SXT chain\'s Source enum has no Base');
    console.error('  variant (verified against live chain metadata, June 2026 — variants are');
    console.error('  Ethereum, Sepolia, Bitcoin, Polygon, ZkSyncEra, UserCreated). When SXT adds');
    console.error('  Base to the enum, add it to CHAIN_CONFIG in this script.');
    process.exit(1);
  }
  const chainCfg = CHAIN_CONFIG[args.chain];
  if (!chainCfg) {
    console.error(`✗ Unknown --chain "${args.chain}". Supported: ${Object.keys(CHAIN_CONFIG).join(', ')}`);
    process.exit(1);
  }

  let address;
  try {
    address = getAddress(args.address); // checksum-validate
  } catch {
    console.error(`✗ "${args.address}" is not a valid EVM address.`);
    process.exit(1);
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('✗ PRIVATE_KEY env var is not set.');
    console.error('');
    console.error('  Set a 0x-prefixed Ethereum private key for an account funded with');
    console.error('  SXT chain credits via https://chain.spaceandtime.io.');
    process.exit(1);
  }

  // ─── Resolve event fragments ──────────────────────────────────────────
  let abi = null;
  if (args.events) {
    const apiKey = process.env.ETHERSCAN_API_KEY;
    if (!apiKey) {
      console.error('✗ --events mode fetches the verified ABI from Etherscan v2 and needs');
      console.error('  ETHERSCAN_API_KEY in the environment. Alternatively, skip the API');
      console.error('  entirely with --event-signature "event Name(type name, …)".');
      process.exit(1);
    }
    console.log(`▶ Fetching verified ABI for ${address} (chainid ${chainCfg.etherscanChainId})…`);
    try {
      abi = await fetchVerifiedAbi(address, chainCfg.etherscanChainId, apiKey);
    } catch (err) {
      console.error(`✗ ${err.message}`);
      await hintIfProxy(address, chainCfg.etherscanChainId, apiKey);
      process.exit(1);
    }
  }
  const fragments = resolveEventFragments({ abi, eventNames: args.events, signatures: args.signatures });
  if (abi && abi.filter((e) => e.type === 'event').length === 0) {
    console.error('✗ The verified ABI declares no events.');
    await hintIfProxy(address, chainCfg.etherscanChainId, process.env.ETHERSCAN_API_KEY);
    process.exit(1);
  }

  // ─── Resolve namespace prefix ─────────────────────────────────────────
  let prefix = args.namespace;
  let prefixSource = 'CLI arg';
  if (!prefix) {
    const handoff = readLastPublish();
    prefix = handoff?.tableRef ? extractPrefix(handoff.tableRef) : null;
    prefixSource = '.last-publish.json (remembered prefix)';
    if (!prefix) {
      console.error('✗ No --namespace provided and no prior publish to remember a prefix from.');
      console.error('  Pick an UPPERCASE_SNAKE_CASE prefix, e.g. --namespace MY_PROJECT');
      process.exit(1);
    }
    console.log(`▶ Reusing namespace prefix ${prefix} from prior publish. [override with --namespace]`);
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(prefix)) {
    console.error(`✗ Namespace prefix must be UPPERCASE_SNAKE_CASE. Got: "${prefix}"`);
    process.exit(1);
  }

  // ─── Build per-event registration plan ────────────────────────────────
  const startingPosition = await getStartingBlock(args.chain, args.startingBlock);
  const wallet = new Wallet(privateKey);
  const addressSuffix = wallet.address.slice(2).toUpperCase();
  // SXT chain rule: namespace must end with the signing wallet's uppercase hex.
  const namespace = `${prefix}_${addressSuffix}`;

  const plan = fragments.map((fragment) => {
    const table = toTableName(fragment.name);
    const columns = buildEventColumns(fragment);
    return {
      fragment,
      table,
      columns,
      createStatement: buildCreateStatement(namespace, table, columns),
      metadata: buildSciMetadata({ columns, address, fragment, startingPosition }),
    };
  });
  {
    const dupes = plan.map((p) => p.table).filter((t, i, a) => a.indexOf(t) !== i);
    if (dupes.length) {
      console.error(`✗ Two events map to the same table name: ${[...new Set(dupes)].join(', ')}.`);
      console.error('  Register them in separate runs under different --namespace prefixes.');
      process.exit(1);
    }
  }

  console.log('');
  console.log(`▶ Registration plan  [namespace prefix: ${prefix} — ${prefixSource}]`);
  console.log(`  SXT chain RPC:    ${RPC}`);
  console.log(`  Source chain:     ${args.chain} → Source::${chainCfg.source}`);
  console.log(`  Contract:         ${address}`);
  console.log(`  Starting block:   ${startingPosition}${args.startingBlock != null ? ' (override)' : ' (current head — SCI is live-only today)'}`);
  console.log(`  Namespace:        ${namespace}`);
  for (const p of plan) {
    console.log('');
    console.log(`  ── ${namespace}.${p.table}`);
    console.log(`     event:    ${p.fragment.format('full')}`);
    console.log(`     DDL:      ${p.createStatement}`);
    console.log(`     metadata: ${p.metadata}`);
  }
  console.log('');
  console.log('  ⚠ SCI tables are NOT zk-provable yet — this registers ingestion only.');
  console.log(`  ⚠ COST: the chain BURNS 20 SXT per created object — ${plan.length} table(s) = ${plan.length * 20} SXT,`);
  console.log(`    plus 20 SXT more if the namespace is new (sxt-node tables pallet CREATE_COST,`);
  console.log('    non-privileged accounts). FundsUnavailable means balance < the burn amount.');
  console.log('  ⚠ Each table starts indexing only once ALSO funded with >=100 SXT (see final step).');

  // ─── Connect + build extrinsics ───────────────────────────────────────
  console.log('');
  console.log(`▶ Connecting to ${RPC}`);
  const api = await createApiResilient(RPC);
  const chainName = (await api.rpc.system.chain()).toString();
  console.log(`  Connected. Chain: ${chainName}`);

  if (typeof api.tx.tables?.createTableWithSciMetadata !== 'function') {
    console.error('');
    console.error('✗ api.tx.tables.createTableWithSciMetadata not available on this chain.');
    console.error('  Available methods on api.tx.tables:');
    for (const m of Object.keys(api.tx.tables ?? {})) console.error(`    api.tx.tables.${m}`);
    await api.disconnect();
    process.exit(1);
  }

  const signer = new EthEcdsaSigner(wallet, api);
  console.log(`  Signer ETH address: ${wallet.address}`);
  console.log(`  Signer SxT address: ${signer.address}`);

  const buildNamespaceTx = (tableType) => api.tx.tables.createNamespace(
    namespace,
    0,
    `CREATE SCHEMA IF NOT EXISTS ${namespace}`,
    tableType,
    chainCfg.source,
  );
  const sciTxs = plan.map((p) => api.tx.tables.createTableWithSciMetadata(
    {
      ident: { namespace, name: p.table },
      createStatement: p.createStatement,
      source: chainCfg.source,
      commitmentSchemeFlags: { hyperKzg: true, dynamicDory: false },
    },
    p.metadata,
  ));

  if (args.dryRun) {
    console.log('');
    console.log('▶ --dry-run: encoded extrinsics (NOT signed, NOT submitted):');
    console.log(`  createNamespace:           ${buildNamespaceTx('SCI').method.toHex()}`);
    plan.forEach((p, i) => {
      console.log(`  createTableWithSciMetadata[${p.table}]: ${sciTxs[i].method.toHex()}`);
    });
    console.log('');
    console.log('  Re-run without --dry-run to submit. Rehearse on testnet first:');
    console.log('    SXT_RPC=wss://rpc.testnet.sxt.network … --chain sepolia');
    await api.disconnect();
    process.exit(0);
  }

  console.log('');
  await confirmOrAbort({ isMainnet: /mainnet/i.test(RPC), yes: args.yes });

  // ─── Submit: batchAll(namespace + all SCI tables), AlreadyExists fallback ──
  // Same canonical pattern as publish-dataset-cli.mjs: batchAll is atomic, so
  // if the namespace already exists (second-onward registration per wallet)
  // the whole batch rolls back and we resubmit the table txs individually.
  console.log('▶ Submitting batched CREATE NAMESPACE + SCI tables…');
  const results = plan.map((p) => ({ table: p.table, ok: false, preExisting: false, error: null }));
  let batchOk = false;
  try {
    await submitTx('SCI batch', api.tx.utility.batchAll([buildNamespaceTx('SCI'), ...sciTxs]), signer, signer.address, api);
    batchOk = true;
    results.forEach((r) => { r.ok = true; });
    console.log('  ✓ Namespace + all SCI tables registered in a single batch.');
  } catch (err) {
    if (isPermissionError(err)) {
      // The SCI namespace tableType may be restricted for user wallets (the
      // Tables pallet docs only promise create_tables parity for the table
      // extrinsic itself). Retry once with a Community namespace — the tables
      // themselves are still SCI via createTableWithSciMetadata.
      console.log(`  ⚠ Batch rejected with a permission error (${err.message}).`);
      console.log('  Retrying with tableType Community on the namespace (tables stay SCI)…');
      try {
        await submitTx('SCI batch (Community ns)', api.tx.utility.batchAll([buildNamespaceTx('Community'), ...sciTxs]), signer, signer.address, api);
        batchOk = true;
        results.forEach((r) => { r.ok = true; });
        console.log('  ✓ Namespace (Community) + all SCI tables registered.');
      } catch (err2) {
        if (!isAlreadyExistsError(err2)) throw err2;
        console.log(`  ⚠ Namespace ${namespace} already exists — batchAll rolled back.`);
      }
    } else if (!isAlreadyExistsError(err)) {
      throw err;
    } else {
      console.log(`  ⚠ Namespace ${namespace} already exists — batchAll rolled back.`);
    }
  }
  if (!batchOk) {
    console.log('  Re-submitting each SCI table individually against the existing namespace…');
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      try {
        await submitTx(`createTableWithSciMetadata ${p.table}`, sciTxs[i], signer, signer.address, api);
        results[i].ok = true;
        console.log(`  ✓ ${namespace}.${p.table} registered.`);
      } catch (err2) {
        if (isAlreadyExistsError(err2)) {
          results[i].ok = true;
          results[i].preExisting = true;
          console.log(`  ⚠ ${namespace}.${p.table} already exists — left as-is.`);
        } else {
          results[i].error = err2.message;
          console.error(`  ✗ ${namespace}.${p.table} failed: ${err2.message}`);
        }
      }
    }
  }

  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  // ─── Handoff ──────────────────────────────────────────────────────────
  let handoffPath = null;
  if (succeeded.length > 0) {
    const firstOk = plan.find((p) => results.find((r) => r.table === p.table)?.ok);
    handoffPath = writeLastPublish({
      kind: 'indexed-sci',
      tableRef: `${namespace}.${firstOk.table}`,
      prefix,
      contractAddress: address,
      chain: args.chain,
      source: chainCfg.source,
      startingPosition,
      events: plan
        .filter((p) => results.find((r) => r.table === p.table)?.ok)
        .map((p) => ({
          name: p.fragment.name,
          tableRef: `${namespace}.${p.table}`,
          signature: p.fragment.format('full'),
          columns: p.columns,
        })),
      wallet: wallet.address,
      network: RPC,
      publishedAt: new Date().toISOString(),
    });
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ${failed.length === 0 ? '✅' : '⚠'} Registered ${succeeded.length}/${plan.length} SCI table(s) under ${namespace}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const r of results) {
    console.log(`  ${r.ok ? (r.preExisting ? '⚠ pre-existing' : '✓ registered ') : '✗ FAILED     '}  ${namespace}.${r.table}${r.error ? ` — ${r.error}` : ''}`);
  }
  if (handoffPath) console.log(`\n  Handoff written: ${handoffPath} (kind: indexed-sci)`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. FUND each table with >=100 SXT to start its indexer. The per-table');
  console.log('     funding account is displayed at https://chain.spaceandtime.io (the');
  console.log('     derivation is not exposed on-chain, so this CLI cannot compute it).');
  console.log(`  2. Poll ingestion:  SELECT MIN(BLOCK_NUMBER), MAX(BLOCK_NUMBER), COUNT(*) FROM ${namespace}.${plan[0].table}`);
  console.log('  3. Gate test before ANY on-chain spend: run an off-chain /v1/zkquery against');
  console.log('     the table (node verify-table.mjs). Expect 422 today — SCI tables are not');
  console.log('     on the zk-proven surface yet. When SXT promotes them, the same pipeline');
  console.log('     (save-proof-plans → render-onchain-query → deploy → query) lights up.');
  console.log('');

  await api.disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
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
