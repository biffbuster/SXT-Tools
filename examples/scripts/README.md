# Example scripts

Vanilla Node.js scripts that drive the publish-and-prove pipeline against Space and Time mainnet (SXT chain) and Base mainnet (EVM). Reproducible end-to-end from a fresh clone — see the root [`README.md`](../../README.md) for the five-command quickstart.

## Setup

```bash
cd examples/scripts
npm install
cp .env.example .env
# edit .env to add PRIVATE_KEY, or run `node bootstrap.mjs --new-wallet`
```

The scripts use a single Ethereum private key. SXT chain accepts a special `EthEcdsa` signature variant for EVM-derived accounts (per the official `chain.spaceandtime.io` "Programmatic Table Creation" tutorial), so one key signs both Substrate extrinsics on the SXT chain and EVM transactions on Base. The `ethecdsa_signer.mjs` helper is lifted verbatim from those docs.

**Recommended:** dedicate a fresh Ethereum account to this work, not your main MetaMask. Reveal the private key for that account only, fund it on three networks (`bootstrap.mjs --status` reports exact shortfalls), and put the key in `.env`.

## Scripts

### Pipeline — run in order via `bootstrap.mjs --run`

| Script | Step | What it does |
|---|---|---|
| `publish-dataset-cli.mjs` | 1 | CSV → SXT chain-secured table. Auto-suffixes the namespace with the wallet address (chain rule), renders all columns `NOT NULL` (Proof of SQL rule), submits via `tables.createTables` + `indexing.submitData`. |
| `save-proof-plans.mjs` | 2 | Calls `commitments_v1_evmProofPlan` on the SXT chain RPC for three queries (point-lookup, count, negative-lookup) and writes the EVM-encoded proof plans to `../data/proof-plans/`. |
| `render-onchain-query.mjs` | 3 | Substitutes a proof plan + schema into `templates/OnchainQuery.sol.template` and writes `src/OnchainQuery/OnchainQuery.sol`. The hand-curated `StakersQuery.sol` is never overwritten. |
| `deploy-onchain-query.mjs` | 4 | `forge create` wrapper that deploys whichever contract was last rendered (defaults to `StakersQuery` if no render has run). Writes `.deploy-state.json` for idempotency. Defaults to Base mainnet. |
| `query-onchain.mjs` | 5 | Approves 100 SXT, calls `query()`, polls for the verified callback (`QueryRow` / `QueryEmpty` for `OnchainQuery`, `MembershipProven` / `MembershipNotFound` for `StakersQuery`). |

### Orchestration

| Script | Purpose |
|---|---|
| `bootstrap.mjs` | First-run setup + GO/NOT-GO probe. `--new-wallet` generates a fresh key, `--status` re-runs the probe, `--run` executes the full pipeline. |

### Diagnostics

| Script | Purpose |
|---|---|
| `poll-callback.mjs` | Standalone poller for the `query()` callback. Use when `query-onchain.mjs` crashed mid-poll and you don't want to re-fire `query()` and burn another 100 SXT. Defaults to a different RPC for resilience. |
| `inspect-query.mjs` | Reads a `query()` tx receipt, extracts the queryId, and scans the QueryRouter for `QueryRequested` / `QueryFulfilled` / `PayoutOccurred` / `QueryCancelled` events. Use to diagnose whether the executor has picked up your request. |
| `check-balance.mjs` | SXT chain native balance for the wallet. |
| `check-eth-sxt-balance.mjs` | Base ETH + SXT (ERC-20) balance + QueryRouter allowance. |

### Off-chain alternates

For cases where you want to validate the publish + plan steps without spending 100 SXT for an on-chain proof:

| Script | Purpose |
|---|---|
| `audit-with-sxt.mjs` | REST API version of the audit cross-reference. Computes a contract bytecode hash and queries the published `KNOWN_EXPLOITS` table via the Studio REST API. Requires `SXT_API_KEY` from `app.spaceandtime.ai`. |
| `verify-stakers.mjs` | REST API version of the membership query. Same proof, delivered as a JSON receipt instead of an on-chain event. Requires `SXT_API_KEY`. |

## Configuration

All scripts read from `.env` (gitignored). The full set of variables:

| Variable | Used by | Default |
|---|---|---|
| `PRIVATE_KEY` | all on-chain scripts | (required) |
| `SXT_API_KEY` | `audit-with-sxt.mjs`, `verify-stakers.mjs` | (required for off-chain scripts only) |
| `SXT_RPC` | publish, balance, proof-plan scripts | `wss://rpc.mainnet.sxt.network` |
| `ETH_RPC` | deploy, query, balance, poll, inspect | `https://base.publicnode.com` |
| `MAX_WAIT_MS` | `query-onchain.mjs`, `poll-callback.mjs` | `180000` (3 minutes) |

## Common workflows

### From scratch, end-to-end

```bash
node bootstrap.mjs --new-wallet     # generate ETH key, write to .env
# fund the printed address per bootstrap output
node bootstrap.mjs --status         # confirm GO state
node bootstrap.mjs --run            # publish → render → deploy → query
```

### Re-query the same address (no redeploy)

If you've already deployed and want to fire another proof for the same query:

```bash
node query-onchain.mjs
# costs another 100 SXT; emits a fresh callback event
```

### Query a different address

The proof plan binds the address as a literal — to prove membership of a different address you must regenerate the plan and redeploy:

```bash
# 1. Edit the SQL in save-proof-plans.mjs to use the new address
# 2. Regenerate the plan + chain state hash
node save-proof-plans.mjs
# 3. Re-render the contract
node render-onchain-query.mjs
# 4. Recompile + redeploy
cd ../contracts/sxt-onchain-query && forge build && cd ../../scripts
rm ../contracts/sxt-onchain-query/.deploy-state.json
node deploy-onchain-query.mjs
# 5. Approve + query against the new contract
node query-onchain.mjs
```

### Diagnose a stuck query

```bash
node inspect-query.mjs 0x<queryTxHash>
# shows queryId, callback config, payment timeout, and whether
# QueryRouter has seen QueryFulfilled / PayoutOccurred / QueryCancelled
```

If the executor never fulfills, the contract's payment timeout (1 hour) lets you call `cancelQuery` on QueryRouter for a 100 SXT refund.

## Don't commit secrets

`.env` is gitignored. The repo's root `.gitignore` also excludes `node_modules/` and forge build artifacts. Don't commit your `PRIVATE_KEY` or `SXT_API_KEY`.
