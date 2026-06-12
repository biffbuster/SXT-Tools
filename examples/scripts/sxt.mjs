#!/usr/bin/env node
/**
 * sxt — unified CLI over the sxt-tools pipeline.
 *
 * Community-built tooling on public Space and Time protocol surfaces.
 * NOT endorsed or supported by Space and Time. Every command is a thin
 * dispatcher onto the battle-tested script it names — no new protocol
 * logic lives here, so the underlying scripts remain the audit surface.
 *
 * Install (from examples/scripts/): npm link   → `sxt <command>` anywhere
 * Or run directly:                  node sxt.mjs <command>
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// command → [script, fixed-args, description, cost]
const COMMANDS = {
  status: ['bootstrap.mjs', ['--status'], 'Wallet + network readiness across SXT chain, Base, Ethereum', 'free'],
  init: ['bootstrap.mjs', ['--new-wallet'], 'Generate a fresh wallet and write .env', 'free'],
  preflight: ['preflight.mjs', ['--read-only'], 'Install/manifest/MCP readiness checks (use `preflight:full` for chain checks)', 'free'],
  'preflight:full': ['preflight.mjs', [], 'Preflight including forge + env checks', 'free'],
  demo: ['demo-rehearsal.mjs', [], 'Read-only demo: live Proof of SQL + contract liveness', 'free (API quota)'],
  publish: ['publish-dataset-cli.mjs', [], 'Publish a CSV as a chain-secured table:  sxt publish <csv> [PREFIX.TABLE]', '~0.001 SXT'],
  index: ['index-contract.mjs', [], 'Register a contract for SCI event indexing:  sxt index --address 0x… --chain ethereum --event-signature "event …"', '20 SXT burn/table'],
  verify: ['verify-table.mjs', [], 'Off-chain Proof of SQL against the active table (zero-cost gate before on-chain spend)', 'free (API quota)'],
  plan: ['save-proof-plans.mjs', [], 'Generate EVM proof plans for the active table', 'free'],
  'chain-plan': ['generate-chain-plan.mjs', [], 'Parameterized proof plan against SXT-indexed chain tables:  sxt chain-plan --table ETHEREUM.TRANSACTIONS --predicate "FROM_ADDRESS = $1 AND TO_ADDRESS = $2" --param-types VARCHAR,VARCHAR', 'free'],
  render: ['render-onchain-query.mjs', [], 'Render the typed Solidity consumer from the proof plan', 'free'],
  deploy: ['deploy-onchain-query.mjs', [], 'Deploy the rendered contract (idempotent via .deploy-state.json)', '~0.001 ETH gas'],
  query: ['query-onchain.mjs', [], 'On-chain query() with proof callback on Base', '100 SXT + gas'],
  inspect: ['inspect-query.mjs', [], 'Decode a query tx lifecycle:  sxt inspect <txHash>', 'free'],
  balance: ['check-eth-sxt-balance.mjs', [], 'ETH + SXT (ERC-20) balances and QueryRouter allowance', 'free'],
  parity: ['mcp-parity-test.mjs', [], 'Prove the MCP server matches direct SDK output', 'free (API quota)'],
  pipeline: ['demo-fullpipeline.mjs', [], 'Full pipeline orchestrator (publish → … → query). Flags: --auto --fresh --from=N --skip-onchain', 'up to ~100 SXT'],
};

function printHelp() {
  console.log(`
sxt — Space and Time Proof-of-SQL pipeline CLI  (community tool, not endorsed by SXT)

Usage: sxt <command> [args]

Commands:`);
  const pad = Math.max(...Object.keys(COMMANDS).map((c) => c.length)) + 2;
  for (const [cmd, [, , desc, cost]] of Object.entries(COMMANDS)) {
    console.log(`  ${cmd.padEnd(pad)}${desc}`);
    console.log(`  ${''.padEnd(pad)}cost: ${cost}`);
  }
  console.log(`
The zero-cost flow:    sxt status → sxt demo → sxt verify
The publish flow:      sxt publish data.csv MY_PROJECT.TABLE → sxt verify → sxt plan → sxt render → sxt deploy → sxt query
Every paid command is gated behind its own confirmation prompt.

Env lives in examples/scripts/.env (see .env.example). Docs: README.md, HOW_IT_WORKS.md.
`);
}

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  printHelp();
  process.exit(cmd ? 0 : 1);
}

const entry = COMMANDS[cmd];
if (!entry) {
  console.error(`✗ Unknown command "${cmd}". Run \`sxt help\` for the list.`);
  // cheap suggestion: prefix match
  const near = Object.keys(COMMANDS).filter((c) => c.startsWith(cmd[0] ?? ''));
  if (near.length) console.error(`  Did you mean: ${near.join(', ')}?`);
  process.exit(1);
}

const [script, fixedArgs] = entry;
const child = spawn(process.execPath, [resolve(HERE, script), ...fixedArgs, ...rest], {
  stdio: 'inherit',
  cwd: HERE, // scripts resolve .env and artifacts relative to examples/scripts/
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
child.on('error', (err) => {
  console.error(`✗ Failed to launch ${script}: ${err.message}`);
  process.exit(1);
});
