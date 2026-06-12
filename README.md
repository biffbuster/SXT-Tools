# sxt CLI

Proof of SQL tooling for Space and Time. Publish data, register contracts for indexing, and run cryptographically proven SQL: off-chain in seconds, or delivered to your smart contract on Base with on-chain verification in about 150K gas.

![version](https://img.shields.io/badge/version-0.2.0--beta.1-blue) ![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen) ![license](https://img.shields.io/badge/license-MIT-lightgrey) ![platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-informational)

> Community-built, powered by Space and Time's public infrastructure. Not officially endorsed by Space and Time. Every command, cost, and limitation in this document was verified live on mainnet, most recently 2026-06-11 ([evidence](./CHANGELOG.md)). Reviewing this repo? Start at [`REVIEW.md`](./docs/REVIEW.md).

```
$ sxt query
▶ Calling query() — submits Proof of SQL request to QueryRouter…
  ✓ requestQuery confirmed in block 47203126
▶ Waiting for SXT executor's callback…
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ ONCHAIN PROOF OF SQL CALLBACK FIRED        (~8s)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QueryRow  0x6de6e901bbefd26a9888798a25e4a49309d04ca9
Verdict: 1 verified row(s) returned for the proven query.
```

## Why this matters

Smart contracts can't read databases, and oracles ask you to trust an operator. Proof of SQL removes the trust: every query result carries a ZK proof that the data was never tampered with and the SQL executed correctly. Anyone can check it in milliseconds, and a contract on Base can check it in about 150K gas. Not even the database operator can forge an answer. This CLI is the working pipeline from raw data to that proof.

## What you can build

| Use case | The unlock | How | Status |
|---|---|---|---|
| **Token gates and airdrops** that grant mints, access, or claims from an off-chain allowlist | No merkle snapshots, no signer backend; the list stays updatable off-chain | `sxt publish` your list, then the contract proves membership via `sxt query` | ✅ verified on mainnet |
| **Compliance with cryptographic receipts**: prove an address is NOT on a sanctions or drainer list | Negative proofs are first-class; absence of a row is as provable as presence | `sxt publish`, then a negative lookup via `sxt verify` or `sxt query` | ✅ negative proofs verified |
| **Wallet reputation from L1 history**: a Base contract reacts to proven Ethereum facts ("has this wallet ever used protocol X?") | One deployed contract answers for any wallet and any target; parameters bind at call time | `sxt chain-plan` on `ETHEREUM.TRANSACTIONS`, then `sxt query` | ✅ proofs and contract verified; on-chain parameterized callback pending first run |
| **Verifiable data feeds**: any tabular dataset becomes an oracle whose answers carry math, not reputation | Prices, scores, attestations, game state. Consumers verify instead of trusting | `sxt publish`, consumers run `sxt verify` or on-chain `query()` | ✅ |
| **AI agents that can't lie about data**: agent answers arrive with proofs attached | The MCP server returns proof-backed query results to any MCP client | `sxt parity` proves the wrapping; see [AI-native interfaces](#ai-native-interfaces) | ✅ |
| **Your contract's events as queryable tables** | Any EVM contract's history becomes SQL without building an indexer | `sxt index` | ✅ registration live; proofs pending SXT's SCI promotion |

---

## Install

Requires Node 20+. Foundry is only needed for the contract-deploy path (`curl -L https://foundry.paradigm.xyz | bash && foundryup`).

```bash
git clone https://github.com/biffbuster/sxt-tools.git
cd sxt-tools/examples/scripts
npm install
npm link          # `sxt <command>` available globally (or use `node sxt.mjs <command>`)

cp .env.example .env
sxt preflight     # validates the install end-to-end
```

Works identically on macOS, Linux, and Windows.

> **Windows note:** examples written as `SXT_RPC=… sxt <cmd>` use Unix shell syntax. In PowerShell, set the variable first: `$env:SXT_RPC='…'; sxt <cmd>`.

---

## Quickstart: first proof in 5 minutes, free

No wallet, no tokens. One free API key from [chain.spaceandtime.io](https://chain.spaceandtime.io) (API Authentication), set as `SXT_API_KEY` in `.env`:

```bash
sxt demo
```

This runs a real HyperKZG-proven SQL query against a live mainnet table and verifies the proof locally against the on-chain commitment, using the same prover and on-chain Verifier the full pipeline uses. If this passes, everything downstream is a question of funding, not setup.

```bash
sxt verify        # same proof, more detail: positive and negative membership
```

---

## Command reference

| Command | What it does | Cost |
|---|---|---|
| `sxt status` | Wallet and funding readiness across SXT chain, Base, Ethereum | free |
| `sxt init` | Generate a fresh wallet, write `.env` | free |
| `sxt preflight` | Install, manifest, and MCP health checks (21 checks) | free |
| `sxt demo` | Live proven query plus contract liveness rehearsal | free |
| `sxt publish <csv> [PREFIX.TABLE]` | CSV to chain-secured SXT table (schema auto-inferred) | **20 SXT burned** per table (+20 for a first namespace) |
| `sxt verify` | Off-chain Proof of SQL on the active table. **The zero-cost gate** | free |
| `sxt plan` | EVM proof plans for the active table | free |
| `sxt chain-plan --table … --predicate … --param-types …` | Parameterized plan against SXT-indexed chain tables (`$1`, `$2` bound at call time) | free |
| `sxt render` | Generate the typed Solidity consumer from a plan | free |
| `sxt deploy` | Deploy to Base (idempotent, gated confirmation) | ~0.001 ETH gas |
| `sxt query` | On-chain `query()`: proof verified on-chain, callback event fires | **100 SXT** plus gas |
| `sxt index --address 0x… --chain … --event-signature "event …"` | Register a contract's events for SCI indexing | 20 SXT burned per table |
| `sxt inspect <txHash>` | Decode a query's full lifecycle (debugging) | free |
| `sxt balance` | ETH and SXT balances plus QueryRouter allowance | free |
| `sxt pipeline` | Orchestrate the whole flow with prompts (`--auto`, `--skip-onchain`, `--from=N`) | up to ~100 SXT |

Every paid command is gated behind its own confirmation prompt; mainnet writes require typing `mainnet`. Where applicable, `--dry-run` prints exactly what would be submitted, including encoded extrinsics, without signing anything.

---

## Guide 1: your own dataset, proven on-chain

A CSV on your laptop becomes a row a smart contract can trust.

Fund first (`sxt status` reports exact shortfalls):
- SXT chain native: at least 40 SXT for a first publish. The chain burns 20 SXT per created object (namespace plus each table; measured live: 20.075 SXT including fees). Inserts into existing tables cost ~0.001 SXT. Fund via `SXTChainFunding` on Ethereum (`0xb1bc1d7eb1e6c65d0de909d8b4f27561ef568199`).
- Base: ~0.005 ETH gas plus 100 SXT ERC-20 per `query()`.

```bash
# 1. Publish. Pick any UPPERCASE_SNAKE prefix; the chain suffixes your wallet hex
sxt publish ./my-members.csv MY_PROJECT.MEMBERS --lookup-column EMAIL

# 2. THE GATE (free): a passing off-chain proof is mathematically guaranteed
#    to fulfill on-chain (same prover backend). Never skip this before spending.
sxt verify

# 3. Plan, typed Solidity, compile, deploy
sxt plan
sxt render
cd ../contracts/sxt-onchain-query && forge build && cd ../../scripts
sxt deploy

# 4. On-chain query: 100 SXT, proof verified on-chain, callback fires (~8s observed)
sxt query
```

Every step after `publish` auto-discovers the table, schema, and lookup column via `.last-publish.json` (override per-run with `SXT_TABLE`, `SXT_SCHEMA_PATH`, `SXT_LOOKUP_COLUMN`). A second publish from the same clone remembers your prefix: `sxt publish ./drainers.csv` publishes as `MY_PROJECT.DRAINERS`.

Supported CSV column types: `VARCHAR`, `BIGINT`, `BOOLEAN`, `TIMESTAMP`, `INT`, `BINARY`, `TINYINT`, `SMALLINT`. All columns are published `NOT NULL`, and the CLI never emits `PRIMARY KEY`: a PK silently blocks proof support and will strand 100 SXT per on-chain attempt (see Troubleshooting).

Reading the result: open the callback tx on BaseScan. The `QueryRow` event argument is the value the executor proved is in your table, verified by the on-chain Verifier inside QueryRouter before your contract was called. Negative lookups emit `QueryEmpty` with an equally valid proof. No trust in SXT's API, this CLI, or the publisher. Only the chain.

---

## Guide 2: prove Ethereum chain facts (no publishing required)

SXT pre-indexes Ethereum core data with zk commitments. The empirically proven surface today is `ETHEREUM.BLOCKS` and `ETHEREUM.TRANSACTIONS` (the wider catalog returns error 254018 until SXT promotes more tables).

The key feature is parameterization: `$1` and `$2` are bound at `query()` call time, so one deployed contract answers the question for any inputs. Example: "has wallet X ever transacted with collection Y?"

```bash
sxt chain-plan \
  --table ETHEREUM.TRANSACTIONS \
  --predicate "FROM_ADDRESS = \$1 AND TO_ADDRESS = \$2" \
  --param-types VARCHAR,VARCHAR \
  --projection "TRANSACTION_HASH" \
  --name collection-activity

sxt render --plan ../data/proof-plans/collection-activity.json --name CollectionActivity --params
# contract with query(string from_address, string to_address)
# forge build, sxt deploy, then call query(wallet, anyCollectionAddress)
```

Parameterization is a first-class SXT protocol feature. The rendered contract binds arguments via `ParamsBuilder` from SXT's own published Solidity client library, and the `$1`/`$2` plan comes from SXT's chain RPC. Status: plan generation, render, and compile are verified; the on-chain parameterized callback is the one leg not yet exercised by this repo's tests.

Known `ETHEREUM.TRANSACTIONS` columns: `TIME_STAMP`, `BLOCK_NUMBER`, `TRANSACTION_HASH`, `TRANSACTION_INDEX`, `TRANSACTION_FEE`, `FROM_ADDRESS`, `TO_ADDRESS`. Prefer row-returning projections over `COUNT(*)` while the prover's aggregate path recovers (see Limitations).

---

## Guide 3: index your own contract's events (SCI)

```bash
# Keyless mode (recommended): the event declaration you type is stored on-chain verbatim
sxt index \
  --address 0xBd3531dA5CF5857e7CfAA92426877b022e612cf8 \
  --chain ethereum \
  --event-signature "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)" \
  --namespace MY_PROJECT

# Or fetch the verified ABI (needs ETHERSCAN_API_KEY; one v2 key covers all chains)
sxt index --address 0x… --chain ethereum --events Transfer,Approval
```

The CLI submits the same `tables.createTableWithSciMetadata` extrinsic the SXT Studio UI uses (verified against live chain state; event params map to typed columns, and SQL reserved words auto-rename, e.g. `from`/`to` become `FROM_ADDRESS`/`TO_ADDRESS`). Supported chains are the SXT `Source` enum: `ethereum`, `sepolia`, `polygon`, `zksync`. Not Base (no enum variant on-chain yet).

Status (June 2026): registration and data ingestion work; SCI tables are not on the zk-proven surface yet ("coming soon" per SXT docs), so `sxt verify` returns 422 against them and on-chain `query()` would not fulfill. Indexing is also live-only (from the registration block forward, no historical backfill), and starting the indexer requires funding each table with at least 100 SXT via the per-table address shown at chain.spaceandtime.io. For chain-history proofs that work today, use Guide 2.

---

## Costs: every number measured on mainnet

| Action | Cost | How we know |
|---|---|---|
| Off-chain proven query | free (API quota) | verified continuously |
| Create namespace | 20 SXT burned | pallet source plus live `FundsUnavailable` |
| Create table (CSV or SCI) | 20 SXT burned each | balance delta measured: 20.075 SXT incl. fees |
| Insert rows into existing table | ~0.001 SXT | live publishes |
| Deploy consumer contract (Base) | ~1.1M gas (about $0.01 to $0.10) | tx `0x0d893d7d…` |
| `approve` plus `query()` (Base) | 46K + 134K gas plus 100 SXT | txs `0x9be4b387…`, `0x591f8513…` |
| Proof callback latency | ~8 seconds observed | callback `0x5294361f…` |
| Stuck query refund | `cancelQuery()` after the 1-hour timeout | `sxt inspect` decodes the Payment struct |

The 20 SXT creation burn (`CREATE_COST` in the sxt-node tables pallet) is undocumented by SXT and was discovered here. `sxt publish` pre-checks your balance and fails fast with funding instructions instead of a cryptic `FundsUnavailable`.

---

## Known limitations (verified 2026-06-11)

- Aggregates (`COUNT`, `SUM`) are mid-recovery at SXT's prover. They're in the official [PoSQL syntax spec](https://github.com/spaceandtimefdn/sxt-proof-of-sql/blob/main/docs/SQLSyntaxSpecification.md) and recovering table by table (`ETHEREUM.BLOCKS` works again; user tables pending). Point lookups and scans prove reliably. The prover also has brief instability windows while SXT deploys fixes; the CLI retries transient failures once automatically.
- The proven chain-data surface is narrow: `ETHEREUM.BLOCKS` plus `ETHEREUM.TRANSACTIONS` end-to-end. The rest of the catalog awaits commitment coverage.
- SCI tables aren't provable yet (registration works; proofs "coming soon" per SXT).
- SDK version is pinned at or below 0.55: `sxt-proof-of-sql-sdk` 0.56.1/0.57.1 ship a broken wasm bundle.
- The SXT testnet WS RPC drops large frames (hangs every standard Substrate client on `state_getMetadata`); the CLI works around it by prefetching metadata over HTTP.

---

## AI-native interfaces

The same pipeline is exposed as Claude Code skills (7 skills, 3 plugins) and a typed MCP server:

```
/plugin marketplace add biffbuster/sxt-tools
/plugin install dreamspace-data@sxt-tools      # dataset-publish, index-contract
/plugin install dreamspace-query@sxt-tools     # proof-of-sql-foundations, run-proven-query, chain-data-query
/plugin install dreamspace-contracts@sxt-tools # pre-deploy-audit, deploy-contract
```

The MCP server (`packages/mcp/sxt-mcp/`, stdio plus read-only HTTP) exposes `publish_dataset`, `run_proven_query`, `audit_contract`, and `deploy_contract`. It is testnet-default and mainnet double-gated (`mainnet: true` per call AND `SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` in env). Setup and security model: [`packages/mcp/sxt-mcp/README.md`](./packages/mcp/sxt-mcp/README.md), [`SAFETY.md`](./packages/mcp/sxt-mcp/SAFETY.md). Parity between MCP and direct SDK output is proven by `sxt parity`.

---

## Architecture

```
        SXT chain (Substrate)                Base mainnet (EVM)
        ─────────────────────                ──────────────────
 CSV ──publish──► table commitment           your consumer contract
 events ─index─►  (HyperKZG, finalized)        │ approve(100 SXT) + query()
                       │                       ▼
                       │                    QueryRouter ──► executor runs SQL,
                       │                       │            generates Proof of SQL
                       │                       ▼
                       └── proof plan ──► OnchainVerifier (~150K gas)
                           (free RPC)          │
                                               ▼
                                        callback → QueryRow event
                                        (the cryptographic receipt)
```

Deep-dive: [`HOW_IT_WORKS.md`](./docs/HOW_IT_WORKS.md). Doc-conformance audit with live-chain evidence: [`docs-conformance.md`](./docs/docs-conformance.md).

---

## Live mainnet addresses (verified against SXT docs 2026-06-10)

| Artifact | Address |
|---|---|
| QueryRouter (Base + Ethereum) | `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB` |
| Verifier (Base) | `0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518` |
| Verifier (Ethereum) | `0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9` |
| SXT ERC-20 (Base) | `0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8` |
| SXT ERC-20 (Ethereum) | `0xE6Bfd33F52d82Ccb5b37E16D3dD81f9FFDAbB195` |
| SXTChainFunding (Ethereum) | `0xb1bc1d7eb1e6c65d0de909d8b4f27561ef568199` |
| Live demo consumer (verification artifact) | `0x3cE11F70FdDbb69994431c24C74f66D7016f7b73` (Base) |

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `FundsUnavailable` on publish/index | The 20 SXT per-object creation burn. Fund SXT chain native (at least 40 for a first publish). `sxt publish` pre-checks and tells you exactly. |
| `failed to deserialize prover response json: … AttestedCommitments` | Aggregate query during the prover's rolling recovery. Rewrite as a point lookup or scan, or wait. |
| `/v1/zkquery` returns `422 "does not exist in source network MAINNET"` | Table not promoted into the proven catalog. For your own tables: a `PRIMARY KEY` clause in the DDL (this CLI never emits one; applies to tables made elsewhere). For SCI tables: expected until SXT promotes SCI. |
| `query()` times out at 1h, no callback | Same root cause as the 422, which is why `sxt verify` is mandatory before `sxt query`. Refund: `cancelQuery(queryId, payment)` after the timeout; `sxt inspect <txHash>` decodes the Payment struct. |
| `401 SECURITY: Invalid JWT` | Raw API key used as Bearer. Exchange at `proxy.api.makeinfinite.dev/auth/apikey` first; all CLI commands do this automatically. |
| `fetch failed` / `TIMEOUT` once, works on retry | Cold-connection flake (slow resolver or IPv6 routes). Demo, verify, and parity retry once automatically; just re-run other commands. |
| `forge build`: "Identifier already declared" | `forge clean && forge soldeer install` |
| Hangs connecting to `wss://rpc.testnet.sxt.network` | SXT's testnet WS drops the metadata frame. `sxt index` has a built-in HTTP-prefetch workaround; other scripts: use mainnet or wait for SXT's fix. |
| `npm install` pulls a broken `sxt-proof-of-sql-sdk` | Don't upgrade past 0.55.x; 0.56.1/0.57.1 ship a broken wasm bundle. The lockfile pins 0.54.0. |

---

## For reviewers and contributors

- [`REVIEW.md`](./docs/REVIEW.md): end-to-end walkthrough, every feature tested via CLI with expected outputs, exact costs, and the mainnet evidence from our own runs.
- [`BETA.md`](./docs/BETA.md): beta onboarding plus the GA promotion checklist.
- [`CHANGELOG.md`](./CHANGELOG.md): versioned history with verification evidence.
- [`CONTRIBUTING.md`](./.github/CONTRIBUTING.md) · [`SECURITY.md`](./.github/SECURITY.md)
- Verification suite: `sxt preflight` (21 checks), `node --check` over all scripts, `forge build`, `sxt parity`.

## References

- [Space and Time docs](https://docs.spaceandtime.io) · [PoSQL syntax spec](https://github.com/spaceandtimefdn/sxt-proof-of-sql/blob/main/docs/SQLSyntaxSpecification.md)
- [`spaceandtimefdn/sxt-chain-examples`](https://github.com/spaceandtimefdn/sxt-chain-examples): canonical examples this CLI's publish flow mirrors
- [`spaceandtimefdn/sxt-proof-of-sql-sdk`](https://github.com/spaceandtimefdn/sxt-proof-of-sql-sdk): the SDK wrapped by `sxt verify` and `sxt demo`

## License

MIT. See [`LICENSE`](./LICENSE).
