#!/usr/bin/env node
/**
 * Check whether the SXT executor has fulfilled ANY queries on the
 * configured EVM network recently. Useful for diagnosing whether a
 * pending query is just slow (executor active, just queued) or whether
 * the executor doesn't service the network at all (no fulfillments
 * recently → ours won't land either).
 *
 * Scans the QueryRouter for recent QueryFulfilled and PayoutOccurred
 * events over the last N blocks (default ~last 24 hours).
 */
import 'dotenv/config';
import { JsonRpcProvider, Interface } from 'ethers';

const QR = '0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB';
const RPC = process.env.ETH_RPC ?? 'https://mainnet.base.org';
const HOURS_BACK = Number(process.argv[2] ?? 24);

const provider = new JsonRpcProvider(RPC);
const network = await provider.getNetwork();
const latest = await provider.getBlockNumber();

const blockTimeSeconds = Number(network.chainId) === 8453 ? 2 : 12;
const blocksBack = Math.floor((HOURS_BACK * 3600) / blockTimeSeconds);
const fromBlock = Math.max(0, latest - blocksBack);

console.log(`▶ Checking ${network.name} (chainId ${network.chainId}) via ${RPC}`);
console.log(`  Block range: ${fromBlock}…${latest} (${blocksBack} blocks ≈ last ${HOURS_BACK} hours)`);
console.log(`  QueryRouter: ${QR}`);
console.log('');

const iface = new Interface([
  'event QueryFulfilled(bytes32 indexed queryId, address indexed fulfiller, bytes result)',
  'event PayoutOccurred(bytes32 indexed queryId, address indexed fulfiller, address indexed refundRecipient, uint256 fulfillerAmount, uint256 refundAmount)',
  'event QueryRequested(bytes32 indexed queryId, uint64 indexed queryNonce, address indexed requester, tuple(bytes32,bytes,bytes,bytes) query, tuple(uint256,uint64,address,bytes4,bytes) callback, tuple(uint256,address,uint64) payment)',
]);

// eth_getLogs over a 24h range can be too big — page in 5000-block chunks.
const CHUNK = 5000;
async function scanEvent(name) {
  const topic = iface.getEvent(name).topicHash;
  const found = [];
  for (let start = fromBlock; start <= latest; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, latest);
    try {
      const logs = await provider.getLogs({ address: QR, topics: [topic], fromBlock: start, toBlock: end });
      found.push(...logs);
    } catch (e) {
      console.log(`  · ${name}: chunk ${start}-${end} failed (${e.shortMessage ?? e.message?.split('\n')[0]?.substring(0, 80)})`);
    }
  }
  return found;
}

const requested = await scanEvent('QueryRequested');
console.log(`▶ QueryRequested events: ${requested.length}`);
if (requested.length > 0) {
  const recent = requested.slice(-3);
  for (const l of recent) {
    console.log(`  · block ${l.blockNumber} tx ${l.transactionHash.substring(0, 10)}…`);
  }
}

const fulfilled = await scanEvent('QueryFulfilled');
console.log(`\n▶ QueryFulfilled events: ${fulfilled.length}`);
if (fulfilled.length > 0) {
  const recent = fulfilled.slice(-3);
  for (const l of recent) {
    const parsed = iface.parseLog(l);
    console.log(`  · block ${l.blockNumber} fulfiller ${parsed.args.fulfiller} tx ${l.transactionHash.substring(0, 10)}…`);
  }
} else {
  console.log(`  ⚠ ZERO fulfillments in the last ${HOURS_BACK}h on this network`);
}

const payouts = await scanEvent('PayoutOccurred');
console.log(`\n▶ PayoutOccurred events: ${payouts.length}`);

console.log('');
const ratio = requested.length === 0 ? '—' : `${((fulfilled.length / requested.length) * 100).toFixed(1)}%`;
console.log(`▶ Verdict`);
console.log(`  Requested: ${requested.length}`);
console.log(`  Fulfilled: ${fulfilled.length}  (${ratio} of requests)`);
if (requested.length > 0 && fulfilled.length === 0) {
  console.log(`  ⚠ Network has live requests but ZERO fulfillments — executor likely not servicing this chain.`);
} else if (fulfilled.length > 0) {
  console.log(`  ✓ Executor has fulfilled queries on this chain in the window — pending queries are likely just queued.`);
}
