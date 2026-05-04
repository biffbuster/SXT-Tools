# SXT Tools

An agent skills marketplace for the Space and Time stack. Five protocol-aware skills compose a publish-and-prove pipeline that takes a CSV from a local file to a Base-mainnet event a smart contract can verify cryptographically. The same pipeline runs on Ethereum mainnet too — Base is the project default for ~10× cheaper gas.

The skill format is portable Markdown — any agent that reads `SKILL.md` files can run the workflow. **This release ships a Claude Code marketplace as the first supported agent runtime.** Cursor and additional agent integrations are in scope for follow-on releases.

This repo is self-contained. No external SDK install, no separate tooling — clone, fund a wallet, run.

---

## Pipeline overview

Five skills, three networks, eight steps, one verifiable Base event.

| Phase | Step | Script | Cost |
|---|---|---|---|
| Publish | 1. `tables.createNamespace` + `tables.createTables` on SXT chain | `publish-dataset-cli.mjs` | <0.001 SxT chain native |
| Publish | 2. Apache Arrow IPC encode → `indexing.submitData` | `publish-dataset-cli.mjs` | <0.001 SxT chain native |
| Plan | 3. EVM proof plan via `commitments_v1_evmProofPlan` JSON-RPC | `save-proof-plans.mjs` | free |
| Render | 4. Substitute proof plan + schema into the OnchainQuery template (skip if using the canonical StakersQuery contract) | `render-onchain-query.mjs` | free |
| Audit | 5. `forge build` + manual review (slither optional) | `forge build` + `pre-deploy-audit` skill | free |
| Deploy | 6. `forge create` on Base mainnet (StakersQuery by default) | `deploy-onchain-query.mjs` | ~0.0003 ETH |
| Query | 7. `approve(QueryRouter, 100 SXT)` → `query()` | `query-onchain.mjs` | ~0.00005 ETH + 100 SXT |
| Verify | 8. SXT executor proves the SQL, calls back, contract emits result event | (executor side) | included in step 7 fee |

The QueryRouter contract on Base mainnet (`0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB`) verifies the Proof of SQL receipt onchain via the Base Verifier (`0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518`) before invoking the callback. The resulting event is trust-minimized. The same QueryRouter address is also deployed on Ethereum mainnet (Verifier `0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9`) for projects targeting that network instead.

---

## Architecture

```
              SXT chain (Substrate)               Base mainnet (EVM)
              ─────────────────────               ──────────────────

 CSV  ─publish─►  table commitment                StakersQuery contract
                  (HyperKZG, finalized)             │   │
                       │                            │   │ approve(100 SXT)
                       │                            │   │ query()
                       │                            │   ▼
                       │                          QueryRouter
                       │                            │
                       │              ┌─────────────┘
                       │              │
                       │              │ executor reads plan,
                       │              │ pulls table commitment,
                       │              │ runs SQL,
                       │              │ generates Proof of SQL
                       │              ▼
                       │           OnchainVerifier
                       │              │ (~150K gas)
                       ▼              ▼
              commitments_v1_     ProofOfSqlTable
              evmProofPlan        decode in callback
              (JSON-RPC)               │
                                       ▼
                                 MembershipProven
                                 event on Base
```

---

## Quickstart

Five commands from a fresh clone to a live proof on Base mainnet.

```bash
# 1. Clone + install deps
git clone https://github.com/biffbuster/sxt-tools.git
cd sxt-tools/examples/scripts && npm install
cd ../contracts/sxt-onchain-query && forge soldeer install && cd ../../scripts

# 2. Generate a fresh wallet (writes .env, prints address)
node bootstrap.mjs --new-wallet

# 3. Fund the printed address per the bootstrap output:
#    - SxT chain native (≥1 SxT for publish fees, via the SXTChainFunding
#      mainnet contract on Ethereum: 0xb1bc1d7eb1e6c65d0de909d8b4f27561ef568199)
#    - Base mainnet ETH (~0.005 ETH for deploy + approve + query gas)
#    - Base mainnet SXT ERC-20 (≥100 SXT per query() call;
#      token: 0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8)

# 4. Confirm everything's green
node bootstrap.mjs --status

# 5. Run the full pipeline in one command
node bootstrap.mjs --run
```

`--run` executes publish → save proof plans → render → compile → deploy → approve → query in sequence and stops on the first failure. The final output is the staker address read from the verified callback event, the four transaction hashes, and the deployed contract address.

---

## Prerequisites

- Node.js ≥ 18
- Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- A wallet funded on three networks (see step 3 above; `bootstrap.mjs --status` reports exact shortfalls)

Optional:
- `slither` (`pip install slither-analyzer`) for the audit skill's Phase 1 static analysis
- `ETHERSCAN_API_KEY` for source verification on deploy

---

## Two contracts, two purposes

Under `examples/contracts/sxt-onchain-query/src/`:

| Contract | Source | Use |
|---|---|---|
| `StakersQuery.sol` | hand-curated, semantic events (`MembershipProven`, `MembershipNotFound`) | Canonical reference for the demo. Audit-clean (`AUDIT_REPORT.md`). Reads as a single-purpose membership-proof contract. |
| `OnchainQuery.sol` | rendered from `templates/OnchainQuery.sol.template` by `render-onchain-query.mjs` | Generic — same pattern, parameterised by SQL column types. Generated for any user table + any SELECT projection. |

The deploy + query scripts target whichever contract was last rendered (via `.last-rendered.json`). When no render has been done they default to `StakersQuery` so the canonical demo runs out-of-the-box.

---

## Use a different CSV

Same scripts, different inputs — no source edits required. SXT auto-suffixes the namespace with the publishing wallet's address, so the published table reference, proof plan bytes, and rendered contract bytecode all differ per wallet.

```bash
# 1. Publish your own CSV. The CSV path, namespace, and --schema are positional/flag
#    args; everything else is hardcoded sensibly (no PRIMARY KEY in the DDL — see
#    Troubleshooting if you're tempted to add one).
node publish-dataset-cli.mjs \
  ../data/your-data.csv \
  YOUR_NAMESPACE.YOUR_TABLE \
  --schema ../data/your-schema.json

# 2. Tell the rest of the pipeline which table to plan against. Set these in .env:
#    SXT_TABLE=YOUR_NAMESPACE_<UPPERCASE_HEX_ADDRESS>.YOUR_TABLE
#    SXT_POINT_LOOKUP=0x<an address you know IS in your data>

# 3. Generate proof plans against your table (reads SXT_TABLE + SXT_POINT_LOOKUP).
node save-proof-plans.mjs

# 4. Render a typed Solidity contract for your column projection.
node render-onchain-query.mjs \
  --plan ../data/proof-plans/point-lookup.json \
  --schema ../data/your-schema.json \
  --name MyQuery
# → writes src/MyQuery/MyQuery.sol with a QueryRow event
#   whose parameters match your SELECT projection

# 5. Build, deploy, query.
cd ../contracts/sxt-onchain-query && forge build && cd ../../scripts
node deploy-onchain-query.mjs
node query-onchain.mjs
```

The renderer maps SQL types (`VARCHAR`, `BIGINT`, `BOOLEAN`, `TIMESTAMP`, `INT`, `BINARY`, `TINYINT`, `SMALLINT`) to the appropriate `ProofOfSqlTable` reader and emits a `QueryRow` event with one parameter per projected column.

Before spending 100 SXT on the on-chain `query()`, run the off-chain pre-flight to confirm your table is reachable in the dreamspace MAINNET catalog:

```bash
node verify-stakers.mjs   # uses SXT_API_KEY + SXT_TABLE from .env
```

A successful response (HyperKZG proof returned in ~1 second) means the on-chain `query()` is mathematically guaranteed to fulfill — same prover backend. A 422 *"does not exist in source network MAINNET"* means the table isn't promoted yet (most often: PRIMARY KEY in DDL — see Troubleshooting).

> **Verified live on Base mainnet 2026-05-04.** A 2 062-row CSV was published to SXT chain, deployed as `OnchainQuery.sol` at [`0x1fc02a8dc0A4050B2DA5D075838F37705fcF0Aa1`](https://basescan.org/address/0x1fc02a8dc0A4050B2DA5D075838F37705fcF0Aa1), queried via `IQueryRouter.requestQuery`, and the SXT executor fulfilled the proof in 3 blocks (~6 s). The `QueryFulfilled` callback is at [`0xd702a4014ec5258a032b39bf9dcfceea838aed51c519d9285f463c1eb23e25b0`](https://basescan.org/tx/0xd702a4014ec5258a032b39bf9dcfceea838aed51c519d9285f463c1eb23e25b0). The Troubleshooting table below captures every failure mode we hit getting there so you don't repeat them.
>
> **For the architectural explanation of how Claude Code (or any SKILL-aware agent) orchestrates the five skills end-to-end** — including a sample conversation that takes a CSV to a verified Base event in three prompts — see [`HOW_IT_WORKS.md`](./HOW_IT_WORKS.md).

---

## Skills used

Installed from the marketplace at `.claude-plugin/marketplace.json`:

```
/plugin marketplace add biffbuster/sxt-tools
/plugin install dreamspace-data@sxt-tools
/plugin install dreamspace-query@sxt-tools
/plugin install dreamspace-contracts@sxt-tools
```

| Skill | Plugin | Pipeline step |
|---|---|---|
| `dataset-publish` | `dreamspace-data` | Steps 1–2 (publish + insert) |
| `proof-of-sql-foundations` | `dreamspace-query` | Constraint guardrail used during step 3 |
| `run-proven-query` | `dreamspace-query` | Off-chain bridge for step 3 (also covers step 7's callback decoding patterns) |
| `pre-deploy-audit` | `dreamspace-contracts` | Step 5 |
| `deploy-contract` | `dreamspace-contracts` | Step 6 |

Each skill is a single SKILL.md with YAML frontmatter under `packages/plugins/<plugin>/skills/<skill>/`.

---

## Reading a verified callback

Once the pipeline runs end-to-end, the result is a Base-mainnet transaction whose log entry is the Proof of SQL receipt:

1. Open the most recent `query()` callback transaction on BaseScan.
2. Find the `MembershipProven` event (for `StakersQuery`) or `QueryRow` event (for `OnchainQuery`) in the log.
3. The event's argument is the staker address that the SXT executor proved is in your published table. The on-chain Verifier validated the proof in 150K gas inside QueryRouter; the result reached your contract via callback. No trust assumption in SXT, the API, or the publishing wallet — only the chain.

Negative membership produces `MembershipNotFound` / `QueryEmpty` instead. The proof is equally cryptographic in both cases.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `1010: Inability to pay some fees` on publish | SxT chain native balance is 0 | Fund via `SXTChainFunding` mainnet contract |
| `save-proof-plans.mjs` returns no `proofPlan` | Table not yet propagated, or namespace casing mismatch | Wait 30s after publish and retry |
| `forge build` fails with "Identifier already declared" | `sxt-proof-of-sql-sdk` npm version conflict (pin v0.54.0) | `forge clean && forge soldeer install` |
| `query-onchain.mjs` times out at 1 hour with no callback while `check-executor-activity.mjs` shows the executor fulfilling other queries on Base | Table never landed in the dreamspace MAINNET catalog. **Most common cause: a `PRIMARY KEY` clause in the original CREATE TABLE.** SXT chain accepts the DDL and your rows ingest, but the indexer skips promoting the table to MAINNET. The on-chain executor and `/v1/zkquery` REST prover both look in MAINNET only — silent skip. | Republish under a new namespace using the current `publish-dataset-cli.mjs` (which never emits PK). Recover stuck SXT via `cancelQuery(queryId, payment)` on QueryRouter — `inspect-query.mjs` decodes the original `QueryRequested` event so you have the exact `Payment` struct to pass back. |
| `/v1/zkquery` returns `422 "does not exist in source network MAINNET"` | Same root cause as the timeout above — table not in MAINNET. This is the cheap pre-flight reproduction (zero SXT). | Republish without PRIMARY KEY. |
| `/v1/zkquery` returns `400 "source network 'X' is not supported"` | You passed a `sourceNetwork` value other than the literal `"MAINNET"` | Only `"MAINNET"` (uppercase, case-sensitive) is accepted, even for user-published Community-tier tables. Update your code/skill. |
| `401 SECURITY: Invalid JWT` on any `api.makeinfinite.dev` REST call | You sent the raw `SXT_API_KEY` as a Bearer token, or the JWT expired (25-min lifetime) | Exchange API key first: POST `proxy.api.makeinfinite.dev/auth/apikey` with header `apikey: <key>`, use the returned `accessToken` as Bearer. The SXT SDK and our scripts handle this automatically — see `examples/scripts/verify-stakers.mjs` for the canonical pattern. |
| Deploy reverts with insufficient funds | Wallet has < ~0.001 ETH on Base | Top up — bridge ETH to Base via bridge.base.org |
| Skill doesn't auto-activate | Phrasing didn't match the trigger | Use direct invocation: `/<plugin>:<skill>` |
| Table appears in `chain.spaceandtime.io` with rows but NOT in `dreamspace.xyz/queries/new` Studio | These are two distinct registries. chain.spaceandtime.io reads chain commitment storage directly; dreamspace.xyz reads an indexed catalog that the chain indexer populates only for tables that pass its gates (NOT NULL only, no PK). | Same fix as the timeout row above — republish without PRIMARY KEY. |

---

## Repo layout

```
.
├── .claude-plugin/marketplace.json     marketplace manifest (3 plugins)
├── packages/plugins/                   the 5 skills
│   ├── dreamspace-data/skills/dataset-publish/
│   ├── dreamspace-query/skills/proof-of-sql-foundations/
│   ├── dreamspace-query/skills/run-proven-query/
│   └── dreamspace-contracts/skills/{deploy-contract,pre-deploy-audit}/
├── examples/
│   ├── data/
│   │   ├── sxt_stakers.csv             demo dataset (2,062 staker addrs)
│   │   ├── sxt_stakers.schema.json
│   │   └── proof-plans/                EVM proof plan artifacts (JSON)
│   ├── contracts/sxt-onchain-query/    foundry project
│   │   ├── src/StakersQuery/           hand-curated demo contract
│   │   ├── src/OnchainQuery/           generated by render-onchain-query.mjs
│   │   ├── templates/                  generic contract template
│   │   ├── AUDIT_REPORT.md
│   │   ├── foundry.toml + soldeer.lock
│   │   └── (out/, cache/, dependencies/  — gitignored build artifacts)
│   └── scripts/                        bootstrap + the 8-step pipeline
└── src/app/                            docs site (Next.js, /docs/quick-start)
```

The web docs render at `npm run dev` → http://localhost:3000/docs.

---

## References

- [`docs.spaceandtime.io`](https://docs.spaceandtime.io)
- [Quick intro to Space and Time](https://docs.spaceandtime.io/docs/what-is-space-and-time-quick-intro)
- [Creating tables (DDL)](https://docs.spaceandtime.io/docs/creating-tables-ddl-1)
- [Queries from a smart contract (ZK SQL onchain)](https://docs.spaceandtime.io/docs/queries-from-a-smart-contract-zk-sql-onchain)
- [ZK SQL via smart contracts](https://docs.spaceandtime.io/docs/zk-sql-via-smart-contracts)
- [ZK-Proven SQL queries (technical)](https://docs.spaceandtime.io/docs/zk-proven-sql-queries-technical)
