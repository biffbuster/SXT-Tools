# sxt-tools — the Space and Time CLI

A CLI for Space and Time Proof of SQL, shipped two ways: a Claude Code plugin marketplace (seven skills) and a typed MCP server (stdio + read-only HTTP) for any MCP-aware client including ChatGPT Developer Mode.

**Two input paths into the same proven pipeline:**

- **Publish a CSV** as a chain-secured SXT table (`dataset-publish`)
- **Index a verified smart contract** so SXT generates per-event tables under your namespace (`index-contract`)

From either path: generate a parameterized Proof of SQL plan → render a typed Solidity verifier → audit → deploy to Base or Ethereum → call `query()`. The SXT executor returns a HyperKZG proof receipt verifiable on-chain in ~150K gas via the QueryRouter.

This repo is self-contained. Clone, fund a wallet, run — or watch an agent do it.

---

## Status

Built by [biffbuster](https://github.com/biffbuster) on public Space and Time infrastructure. Not endorsed or supported by Space and Time. Treat on-chain `query()` artifacts as proof-of-concept.

### Interactions with the prover are under maintenance

Skills and scripts that depend on the off-chain Proof of SQL prover are temporarily unavailable. The rest of the repo is unaffected.

| Available | Under maintenance |
|---|---|
| `dataset-publish` | `run-proven-query` |
| `pre-deploy-audit` | `chain-data-query` |
| `deploy-contract` | `npm run demo` / `demo:fullpipeline` |
| `proof-of-sql-foundations` | MCP `sxt.run_proven_query` tool |
| `generate-chain-plan.mjs` | On-chain `query()` via `query-onchain.mjs` |

---

## Quickstart

Five commands from a fresh clone to a verifiable proof on Base mainnet.

```bash
# 1. Clone and install
git clone https://github.com/biffbuster/sxt-tools.git
cd sxt-tools/examples/scripts && npm install
cd ../contracts/sxt-onchain-query && forge soldeer install && cd ../../scripts

# 2. Generate a fresh wallet (writes .env, prints address)
node bootstrap.mjs --new-wallet

# 3. Fund the printed address per the bootstrap output:
#    SxT chain native: >= 1 SxT for publish fees (via SXTChainFunding on Ethereum
#                      mainnet: 0xb1bc1d7eb1e6c65d0de909d8b4f27561ef568199)
#    Base ETH:         ~0.005 ETH for deploy + approve + query gas
#    Base SXT ERC-20:  >= 100 SXT per query() call
#                      (token: 0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8)

# 4. Confirm wallet state
node bootstrap.mjs --status

# 5. Run the full pipeline
npm run demo:fullpipeline -- --fresh --auto
```

Flags: `--fresh` publishes a brand-new table per run, `--auto` skips prompts, `--from=N` resumes after a failure, `--skip-onchain` runs steps 1–6 without the 100-SXT climax.

---

## Pipeline

Eight steps, three networks, one verifiable on-chain event.

| Phase | Step | Script | Cost |
|---|---|---|---|
| Publish | 1. `tables.createNamespace` + `tables.createTables` on SXT chain | `publish-dataset-cli.mjs` | <0.001 SxT chain native |
| Publish | 2. Apache Arrow IPC encode, `indexing.submitData` | `publish-dataset-cli.mjs` | <0.001 SxT chain native |
| Plan | 3. EVM proof plan via `commitments_v1_evmProofPlan` JSON-RPC | `save-proof-plans.mjs` | free |
| Render | 4. Substitute proof plan and schema into the OnchainQuery template | `render-onchain-query.mjs` | free |
| Audit | 5. `forge build` and manual review (slither optional) | `pre-deploy-audit` skill | free |
| Deploy | 6. `forge create` on Base mainnet | `deploy-onchain-query.mjs` | ~0.0003 ETH |
| Query | 7. `approve(QueryRouter, 100 SXT)`, `query()` | `query-onchain.mjs` | ~0.00005 ETH + 100 SXT |
| Verify | 8. SXT executor proves the SQL, calls back, contract emits result event | (executor side) | included in step 7 |

The QueryRouter on Base mainnet (`0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB`) verifies the proof receipt on-chain via the Base Verifier (`0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518`) before invoking the callback. The same QueryRouter address is also deployed on Ethereum mainnet (Verifier `0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9`).

### Architecture

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

Full architectural walkthrough in [`HOW_IT_WORKS.md`](./HOW_IT_WORKS.md).

---

## Plugins + skills

```
/plugin marketplace add biffbuster/sxt-tools
/plugin install dreamspace-data@sxt-tools
/plugin install dreamspace-query@sxt-tools
/plugin install dreamspace-contracts@sxt-tools
```

| Skill | Plugin | What it does |
|---|---|---|
| `dataset-publish` | `dreamspace-data` | Publish a CSV → SXT chain table |
| `index-contract` | `dreamspace-data` | Register a verified EVM contract for event indexing. SCI zk-commitment is "coming soon" per SXT docs. |
| `proof-of-sql-foundations` | `dreamspace-query` | Constraint guardrail — refuses unprovable SQL |
| `run-proven-query` | `dreamspace-query` | Off-chain proven SELECT against any published table |
| `chain-data-query` | `dreamspace-query` | Proven queries against SXT's pre-indexed Ethereum core (`BLOCKS`, `TRANSACTIONS`) |
| `pre-deploy-audit` | `dreamspace-contracts` | Forge + slither audit of rendered Solidity |
| `deploy-contract` | `dreamspace-contracts` | Deploy the proof-consuming contract to Base / Ethereum |

Each skill is a `SKILL.md` under `packages/plugins/<plugin>/skills/<skill>/`.

---

## MCP server

`@biffbuster/sxt-mcp` exposes four tools (`publish_dataset`, `run_proven_query`, `audit_contract`, `deploy_contract`) over two transports:

| Binary | Transport | Tools | Use |
|---|---|---|---|
| `sxt-mcp` | stdio | All four | Claude Desktop, Claude Code, Cursor |
| `sxt-mcp-http` | Streamable HTTP | `run_proven_query` only (read-only) | ChatGPT Developer Mode, custom web-MCP clients |

The package is `private: true` while the Tier 2 punch list lands. Until then, build from source:

```bash
cd packages/mcp/sxt-mcp && npm install && npm run build
```

### Stdio config (Claude Desktop, Claude Code, Cursor)

```json
{
  "mcpServers": {
    "sxt": {
      "command": "node",
      "args": ["/absolute/path/to/sxt-tools/packages/mcp/sxt-mcp/dist/index.js"],
      "env": {
        "SXT_API_KEY": "...",
        "PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

All four tools register on startup. The MCP server is mainnet-gated — every chain-touching tool requires both `mainnet: true` (per-call) and `SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` (host env). Neither alone reaches mainnet.

HTTP transport (ChatGPT Developer Mode), tunnel setup, and the full security model live in [`packages/mcp/sxt-mcp/README.md`](./packages/mcp/sxt-mcp/README.md) and [`packages/mcp/sxt-mcp/SAFETY.md`](./packages/mcp/sxt-mcp/SAFETY.md).

---

## Using your own data

Every step after `publish` auto-picks up the active dataset via `examples/data/.last-publish.json` (gitignored — carries the publisher's wallet hex). Resolution order in every downstream script: explicit env var → handoff file → canonical demo defaults.

### First publish — pick a namespace prefix

Pick any `UPPERCASE_SNAKE_CASE` prefix that scopes your project (`ACME_PROJECT`, `MEMBERSHIP_V1`, etc.). The chain auto-appends your wallet hex so prefixes never collide across forks.

```bash
node publish-dataset-cli.mjs \
  ../data/your-data.csv \
  <YOUR_PROJECT>.<YOUR_TABLE> \
  --lookup-column <YOUR_LOOKUP_COL>     # optional — pins the membership-proof column
```

### Subsequent steps — zero arguments

Each script reads `.last-publish.json` to discover the table reference, schema, lookup column, and prefix.

```bash
node save-proof-plans.mjs              # generate proof plans
node verify-table.mjs                   # off-chain pre-flight (free, ~1s)
node render-onchain-query.mjs --name MyQuery
cd ../contracts/sxt-onchain-query && forge build && cd ../../scripts
node deploy-onchain-query.mjs
node query-onchain.mjs                  # on-chain climax — ~$0.50 ETH + 100 SXT
```

A successful `verify-table.mjs` (HyperKZG proof returned in ~1s) means the on-chain `query()` is mathematically guaranteed to fulfill — they share a prover backend. A 422 *"does not exist in source network MAINNET"* means the table is not promoted into the indexer; the cause is almost always a `PRIMARY KEY` clause in the original DDL (the CLI in this repo never emits one — see Troubleshooting).

The renderer maps SQL types (`VARCHAR`, `BIGINT`, `BOOLEAN`, `TIMESTAMP`, `INT`, `BINARY`, `TINYINT`, `SMALLINT`) to the appropriate `ProofOfSqlTable` reader and emits a `QueryRow` event with one parameter per projected column.

### Subsequent publishes — prefix is remembered

Second CSV from the same clone reuses the prefix from `.last-publish.json`. Table portion auto-derives from the CSV filename:

```bash
node publish-dataset-cli.mjs ../data/drainers.csv --lookup-column ADDRESS
# → publishes as <YOUR_PREFIX>.DRAINERS (using the prefix from the first run)
```

Override any handoff field per-run via `SXT_TABLE` / `SXT_SCHEMA_PATH` / `SXT_LOOKUP_COLUMN` / `SXT_POINT_LOOKUP`.

---

## Reading a verified callback

Once the pipeline runs end-to-end, the result is a Base-mainnet transaction whose log entry is the Proof of SQL receipt.

1. Open the most recent `query()` callback transaction on BaseScan.
2. Find the `MembershipProven` event (for `StakersQuery`) or `QueryRow` event (for `OnchainQuery`) in the log.
3. The event's argument is the value the SXT executor proved is in your published table. The on-chain Verifier validated the proof in ~150K gas inside QueryRouter; the result reached your contract via callback. No trust assumption in SXT, the API, or the publishing wallet — only the chain.

Negative membership produces `MembershipNotFound` or `QueryEmpty`. The proof is equally cryptographic in both cases.

---

## Prerequisites

- Node.js >= 18
- Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- A wallet funded on three networks. `bootstrap.mjs --status` reports exact shortfalls.
- Optional: `slither` (`pip install slither-analyzer`) for the audit skill, `ETHERSCAN_API_KEY` for deploy verification.

---

## Live mainnet addresses

| Artifact | Address |
|---|---|
| QueryRouter (Base + Ethereum) | `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB` |
| Verifier (Base) | `0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518` |
| Verifier (Ethereum) | `0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9` |
| SXT ERC-20 (Base) | `0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8` |
| SXT ERC-20 (Ethereum) | `0xE6Bfd33F52d82Ccb5b37E16D3dD81f9FFDAbB195` |
| SXTChainFunding (Ethereum) | `0xb1bc1d7eb1e6c65d0de909d8b4f27561ef568199` |
| Canonical demo table | `MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS` |
| Sample wallet in demo table | `0x6de6e901bbefd26a9888798a25e4a49309d04ca9` |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `1010: Inability to pay some fees` on publish | Fund SXT chain native via `SXTChainFunding` on Ethereum mainnet |
| `query-onchain.mjs` times out at 1 hour, no callback | Table never landed in MAINNET catalog — almost always a `PRIMARY KEY` clause in the original DDL. Republish under a new namespace (the CLI here never emits PK). Recover stuck SXT via `cancelQuery(queryId, payment)` — `inspect-query.mjs` decodes the original `Payment` struct. |
| `/v1/zkquery` returns `422 "does not exist in source network MAINNET"` | Same as above — republish without `PRIMARY KEY` (cheap pre-flight reproduction) |
| `/v1/zkquery` returns `400 "source network 'X' is not supported"` | Only the literal `"MAINNET"` (uppercase) is accepted, even for user-published tables |
| `401 SECURITY: Invalid JWT` | Exchange the API key first via `proxy.api.makeinfinite.dev/auth/apikey`; the repo scripts handle this automatically |
| `forge build` fails with "Identifier already declared" | `forge clean && forge soldeer install` |
| Deploy reverts with insufficient funds | Top up Base ETH via bridge.base.org |
| Table appears on `chain.spaceandtime.io` but not on `dreamspace.xyz` | Two distinct registries. The indexer skips PK-having tables. Republish without `PRIMARY KEY`. |

---

## References

- [Space and Time docs](https://docs.spaceandtime.io)
- [`spaceandtimefdn/sxt-chain-examples`](https://github.com/spaceandtimefdn/sxt-chain-examples) — canonical examples this repo mirrors
- [`spaceandtimefdn/sxt-proof-of-sql-sdk`](https://github.com/spaceandtimefdn/sxt-proof-of-sql-sdk) — the SDK this repo wraps
- [`HOW_IT_WORKS.md`](./HOW_IT_WORKS.md) — architecture deep-dive
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contributor guide
- [`SECURITY.md`](./SECURITY.md) — security policy

---

## License

MIT. See [`LICENSE`](./LICENSE).
