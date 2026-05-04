#!/usr/bin/env node
/**
 * Inspect the QueryRouter to figure out where our query is in its lifecycle:
 *  - QueryRequested  → we sent it
 *  - QueryFulfilled  → executor fulfilled (callback may have reverted)
 *  - PayoutOccurred  → executor was paid (success or refund)
 *  - QueryCancelled  → we (or someone) cancelled and got a refund
 *
 * Reads the requester's query tx receipt to extract queryId, then scans
 * the QueryRouter for any events with that queryId.
 */
import 'dotenv/config';
import { JsonRpcProvider, Contract, Interface } from 'ethers';
import { readFileSync } from 'node:fs';

const QR = '0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB';
const RPC = process.env.ETH_RPC ?? 'https://mainnet.base.org';
const QUERY_TX = process.argv[2];
if (!QUERY_TX) { console.error('usage: node inspect-query.mjs <queryTxHash>'); process.exit(1); }

const provider = new JsonRpcProvider(RPC);

const iface = new Interface([
  'event QueryRequested(bytes32 indexed queryId, uint64 indexed queryNonce, address indexed requester, tuple(bytes32 version, bytes innerQuery, bytes parameters, bytes metadata) query, tuple(uint256 maxGasPrice, uint64 gasLimit, address callbackContract, bytes4 selector, bytes callbackData) callback, tuple(uint256 paymentAmount, address refundTo, uint64 timeout) payment)',
  'event QueryFulfilled(bytes32 indexed queryId, address indexed fulfiller, bytes result)',
  'event PayoutOccurred(bytes32 indexed queryId, address indexed fulfiller, address indexed refundRecipient, uint256 fulfillerAmount, uint256 refundAmount)',
  'event QueryCancelled(bytes32 indexed queryId, address indexed refundRecipient, uint256 indexed refundAmount)',
]);

const receipt = await provider.getTransactionReceipt(QUERY_TX);
if (!receipt) { console.error(`✗ tx ${QUERY_TX} not found`); process.exit(1); }
console.log(`▶ Query tx: ${QUERY_TX}`);
console.log(`  Block:     ${receipt.blockNumber}`);
console.log(`  Status:    ${receipt.status === 1 ? 'success' : 'reverted'}`);
console.log(`  Logs:      ${receipt.logs.length}`);

let queryId, queryNonce, callback, payment, query;
for (const log of receipt.logs) {
  if (log.address.toLowerCase() !== QR.toLowerCase()) continue;
  try {
    const parsed = iface.parseLog(log);
    if (parsed.name === 'QueryRequested') {
      queryId = parsed.args.queryId;
      queryNonce = parsed.args.queryNonce;
      callback = parsed.args.callback;
      payment = parsed.args.payment;
      query = parsed.args.query;
      console.log(`\n  ✓ QueryRequested found`);
      console.log(`    queryId:           ${queryId}`);
      console.log(`    queryNonce:        ${queryNonce}`);
      console.log(`    requester:         ${parsed.args.requester}`);
      console.log(`    callbackContract:  ${callback.callbackContract}`);
      console.log(`    callback selector: ${callback.selector}`);
      console.log(`    callback gasLimit: ${callback.gasLimit}`);
      console.log(`    callback maxGasPrice: ${callback.maxGasPrice} wei (${Number(callback.maxGasPrice) / 1e9} gwei)`);
      console.log(`    payment amount:    ${payment.paymentAmount}`);
      console.log(`    timeout:           ${new Date(Number(payment.timeout) * 1000).toISOString()}`);
    }
  } catch {}
}
if (!queryId) { console.error('✗ no QueryRequested event found in that tx'); process.exit(1); }

console.log(`\n▶ Scanning QueryRouter for follow-up events on this queryId…`);
const fromBlock = receipt.blockNumber;
const topic = queryId; // bytes32

for (const evName of ['QueryFulfilled', 'PayoutOccurred', 'QueryCancelled']) {
  const frag = iface.getEvent(evName);
  const sigTopic = frag.topicHash;
  const logs = await provider.getLogs({ address: QR, topics: [sigTopic, topic], fromBlock, toBlock: 'latest' });
  if (logs.length === 0) {
    console.log(`  · ${evName}: not seen`);
  } else {
    for (const log of logs) {
      const parsed = iface.parseLog(log);
      console.log(`  ✓ ${evName} at block ${log.blockNumber} tx ${log.transactionHash}`);
      console.log(`    args: ${JSON.stringify(parsed.args.toObject(), (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
    }
  }
}

const now = Math.floor(Date.now() / 1000);
const remaining = Number(payment.timeout) - now;
console.log(`\n▶ Payment timeout: ${remaining > 0 ? `${remaining}s remaining (${(remaining/60).toFixed(1)} min)` : `EXPIRED ${(-remaining/60).toFixed(1)} min ago — eligible for cancelQuery refund`}`);
