# sxt-tools

Two surfaces for working with Space and Time from inside an AI agent.

A plugin marketplace for coding agents that publishes CSVs, runs Proof of SQL queries, audits Solidity, and deploys proof-consuming contracts. A typed MCP server that exposes the same workflows to any MCP-aware client, including a narrowed read-only HTTP transport for ChatGPT Developer Mode connectors.

Every query returns a HyperKZG proof receipt verifiable on Base or Ethereum mainnet for roughly 150K gas. The full publish-to-on-chain-callback pipeline runs end-to-end in under fifteen minutes against fresh tables.

This repo is self-contained. Clone, fund a wallet, run.

---

## Status

Built by [biffbuster](https://github.com/biffbuster) on top of public Space and Time infrastructure. Not endorsed, approved, or supported by Space and Time yet. The MCP server ships under a self-imposed phased rollout and mainnet double-gate so the surface stays reviewable and contained for the SXT team to inspect at any time. Treat on-chain `query()` artifacts as proof-of-concept until SXT sanctions the toolchain.

---

## What ships today

Two distribution channels, both working. The seamless experience lives in the plugin path. The MCP server gives Claude Desktop, Cursor, and (self-hosted today) ChatGPT a programmatic surface over the same workflows.

### 1. Plugin marketplace (the seamless path)

Three plugins for Claude Code. Five skills total. The format is portable Markdown, so any agent that reads `SKILL.md` files can run the workflows. Cursor support via Skills CLI; additional agent integrations in scope for follow-on releases.

```
/plugin marketplace add biffbuster/sxt-tools
/plugin install dreamspace-data@sxt-tools
/plugin install dreamspace-query@sxt-tools
/plugin install dreamspace-contracts@sxt-tools
```

| Plugin | Skills | What it covers |
|---|---|---|
| `dreamspace-data` | `dataset-publish` | Publish a CSV as a chain-secured SXT table |
| `dreamspace-query` | `proof-of-sql-foundations`, `run-proven-query` | Generate provable SQL and execute it for a HyperKZG proof |
| `dreamspace-contracts` | `pre-deploy-audit`, `deploy-contract` | Audit and deploy the proof-consuming Solidity |

Setup once: install the plugin, paste `SXT_API_KEY` into the host config. Ask Claude a question against the canonical demo table and a HyperKZG proof comes back in roughly three seconds.

### 2. Typed MCP server

`@biffbuster/sxt-mcp` exposes four tools to MCP-aware clients. Two binaries ship in the package.

| Binary | Transport | Tools exposed | Use |
|---|---|---|---|
| `sxt-mcp` | stdio | All four (`publish_dataset`, `run_proven_query`, `audit_contract`, `deploy_contract`) | Claude Desktop, Claude Code, Cursor. Spawned by the host as a child process. |
| `sxt-mcp-http` | Streamable HTTP | `run_proven_query` only (read-only) | ChatGPT Developer Mode connector, custom web-MCP clients. Self-hosted today. |

`sxt-mcp-http` exposes only `run_proven_query`. Publish, deploy, and audit need credentials or filesystem access that do not belong on a network-exposed connector. Read-only proof queries do, and that narrow scope is what makes the HTTP transport safe to operate.

The chat experience itself is fast once connected: roughly three seconds per query, with the proof receipt and verifier address in the response. Setup today is not seamless. ChatGPT Developer Mode requires a public HTTPS URL, which means running `sxt-mcp-http` somewhere reachable and configuring a tunnel or hosting it. The Roadmap section describes the path to a truly seamless ChatGPT experience.

The MCP server is mainnet double-gated. Every chain-touching tool routes through one `selectNetwork()` chokepoint that requires both an explicit `mainnet: true` argument and `SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` set in the host environment. Neither alone reaches mainnet.

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

Final output: the membership address read from the verified callback event, four transaction hashes, and the deployed contract address.

Verified end-to-end on Base mainnet 2026-05-11 against a fresh single-VARCHAR allowlist CSV. Contract [`0x8Fc04b5a628a3dbb8Da21FFc5CCc38a65c89AE05`](https://basescan.org/address/0x8Fc04b5a628a3dbb8Da21FFc5CCc38a65c89AE05). Query callback in 15.9s.

Flags:

- `--fresh` timestamps the namespace and clears `.deploy-state.json` so each run publishes a brand-new table and deploys a brand-new contract.
- `--auto` skips confirmation prompts. Drop it for an interactive walk-through.
- `--from=N` resumes after a step fails.
- `--skip-onchain` runs steps 1 through 6 without the 100-SXT climax.

---

## Pipeline

Eight steps, three networks, one verifiable on-chain event.

| Phase | Step | Script | Cost |
|---|---|---|---|
| Publish | 1. `tables.createNamespace` + `tables.createTables` on SXT chain | `publish-dataset-cli.mjs` | <0.001 SxT chain native |
| Publish | 2. Apache Arrow IPC encode, `indexing.submitData` | `publish-dataset-cli.mjs` | <0.001 SxT chain native |
| Plan | 3. EVM proof plan via `commitments_v1_evmProofPlan` JSON-RPC | `save-proof-plans.mjs` | free |
| Render | 4. Substitute proof plan and schema into the OnchainQuery template (skip if using the canonical StakersQuery contract) | `render-onchain-query.mjs` | free |
| Audit | 5. `forge build` and manual review (slither optional) | `forge build`, `pre-deploy-audit` skill | free |
| Deploy | 6. `forge create` on Base mainnet (StakersQuery by default) | `deploy-onchain-query.mjs` | ~0.0003 ETH |
| Query | 7. `approve(QueryRouter, 100 SXT)`, `query()` | `query-onchain.mjs` | ~0.00005 ETH + 100 SXT |
| Verify | 8. SXT executor proves the SQL, calls back, contract emits result event | (executor side) | included in step 7 |

The QueryRouter on Base mainnet (`0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB`) verifies the proof receipt on-chain via the Base Verifier (`0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518`) before invoking the callback. The resulting event is trust-minimized. The same QueryRouter address is also deployed on Ethereum mainnet (Verifier `0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9`) for projects targeting that network.

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

---

## Using the MCP server

The package is `private: true` while the Tier 2 punch list lands (error sanitizer, structured audit log, vitest suite). Until then, build from source.

```bash
cd packages/mcp/sxt-mcp
npm install
npm run build
npm run typecheck
```

### Stdio (Claude Desktop, Claude Code, Cursor)

Wire into the host's MCP config. For Claude Desktop, edit `claude_desktop_config.json`:

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

All four tools register on startup. The host spawns the binary on demand and pipes JSON-RPC.

### HTTP (ChatGPT Developer Mode, custom web-MCP clients)

```bash
node packages/mcp/sxt-mcp/dist/http.js
# listens on http://127.0.0.1:3333/mcp
```

The HTTP entrypoint binds to loopback by default. To reach ChatGPT, expose the loopback server via a tunnel (cloudflared, ngrok) and configure a bearer:

```bash
SXT_MCP_HTTP_BEARER=<a-random-secret> \
SXT_MCP_BIND_HOST=0.0.0.0 \
  node packages/mcp/sxt-mcp/dist/http.js

# in a second terminal
cloudflared tunnel --url http://127.0.0.1:3333

# paste the tunnel URL plus the bearer into ChatGPT > Settings > Connectors > Add
```

The HTTP entrypoint refuses to start a non-loopback bind without a bearer. Host header and Origin allowlists run before any MCP handler reaches the tool layer. Constant-time bearer comparison defeats length-leaking timing attacks. Full security model in [`packages/mcp/sxt-mcp/SAFETY.md`](packages/mcp/sxt-mcp/SAFETY.md).

A hosted multi-tenant HTTP MCP, where end users sign in with their own SXT account and skip the tunnel setup entirely, is on the Roadmap.

### Verification (no API spend)

```bash
cd packages/mcp/sxt-mcp
npm run build
node scripts/day1-smoke.mjs        # stdio: 4 protocol checks
node scripts/day2-http-smoke.mjs   # http: 12 protocol + security checks
```

Both smoke scripts are zero-cost protocol exercises against the running server. Neither calls SXT.

---

## Use a different CSV

Same scripts, different inputs. SXT auto-suffixes the namespace with the publishing wallet's address, so the published table reference, proof plan bytes, and rendered contract bytecode all differ per wallet.

```bash
# 1. Publish your CSV
node publish-dataset-cli.mjs \
  ../data/your-data.csv \
  YOUR_NAMESPACE.YOUR_TABLE \
  --schema ../data/your-schema.json

# 2. Set in .env:
#    SXT_TABLE=YOUR_NAMESPACE_<UPPERCASE_HEX_ADDRESS>.YOUR_TABLE
#    SXT_POINT_LOOKUP=0x<an address you know is in your data>

# 3. Generate proof plans
node save-proof-plans.mjs

# 4. Render a typed contract for your column projection
node render-onchain-query.mjs \
  --plan ../data/proof-plans/point-lookup.json \
  --schema ../data/your-schema.json \
  --name MyQuery

# 5. Build, deploy, query
cd ../contracts/sxt-onchain-query && forge build && cd ../../scripts
node deploy-onchain-query.mjs
node query-onchain.mjs
```

The renderer maps SQL types (`VARCHAR`, `BIGINT`, `BOOLEAN`, `TIMESTAMP`, `INT`, `BINARY`, `TINYINT`, `SMALLINT`) to the appropriate `ProofOfSqlTable` reader and emits a `QueryRow` event with one parameter per projected column.

Before spending 100 SXT on the on-chain `query()`, run the off-chain pre-flight:

```bash
node verify-stakers.mjs   # uses SXT_API_KEY and SXT_TABLE from .env
```

A successful response (HyperKZG proof returned in roughly one second) means the on-chain `query()` is mathematically guaranteed to fulfill. They share a prover backend. A 422 *"does not exist in source network MAINNET"* means the table is not promoted yet. Most often that is a `PRIMARY KEY` clause in the original DDL. See Troubleshooting.

> Verified live on Base mainnet 2026-05-04. A 2,062-row CSV published to SXT chain, deployed as `OnchainQuery.sol` at [`0x1fc02a8dc0A4050B2DA5D075838F37705fcF0Aa1`](https://basescan.org/address/0x1fc02a8dc0A4050B2DA5D075838F37705fcF0Aa1), queried via `IQueryRouter.requestQuery`. The SXT executor fulfilled the proof in 3 blocks (~6 s). Callback transaction: [`0xd702a4014ec5258a032b39bf9dcfceea838aed51c519d9285f463c1eb23e25b0`](https://basescan.org/tx/0xd702a4014ec5258a032b39bf9dcfceea838aed51c519d9285f463c1eb23e25b0).
>
> For the architectural walkthrough of how an agent orchestrates the five skills end-to-end, including a sample conversation that takes a CSV to a verified Base event in three prompts, see [`HOW_IT_WORKS.md`](./HOW_IT_WORKS.md).

---

## Prerequisites

- Node.js >= 18
- Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- A wallet funded on three networks (see Quickstart step 3). `bootstrap.mjs --status` reports exact shortfalls.

Optional:

- `slither` (`pip install slither-analyzer`) for the audit skill's Phase 1 static analysis.
- `ETHERSCAN_API_KEY` for source verification on deploy.

---

## Reference

### Skills

| Skill | Plugin | Pipeline step |
|---|---|---|
| `dataset-publish` | `dreamspace-data` | Steps 1 and 2 (publish, insert) |
| `proof-of-sql-foundations` | `dreamspace-query` | Constraint guardrail used during step 3 |
| `run-proven-query` | `dreamspace-query` | Off-chain bridge for step 3 (covers step 7 callback decoding patterns) |
| `pre-deploy-audit` | `dreamspace-contracts` | Step 5 |
| `deploy-contract` | `dreamspace-contracts` | Step 6 |

Each skill is one SKILL.md with YAML frontmatter under `packages/plugins/<plugin>/skills/<skill>/`.

### MCP tools

| Tool | Where it lives | Cost surface |
|---|---|---|
| `sxt.publish_dataset` | stdio only | SXT chain credits (per row) |
| `sxt.run_proven_query` | stdio and HTTP | One `/v1/zkquery` API quota tick |
| `sxt.audit_contract` | stdio only | None (pure local forge + slither) |
| `sxt.deploy_contract` | stdio only | ~$0.50 ETH gas |

### Contracts

Under `examples/contracts/sxt-onchain-query/src/`:

| Contract | Source | Use |
|---|---|---|
| `StakersQuery.sol` | hand-curated, semantic events (`MembershipProven`, `MembershipNotFound`) | Canonical reference for the demo. Audit-clean. Single-purpose membership-proof contract. |
| `OnchainQuery.sol` | rendered from `templates/OnchainQuery.sol.template` by `render-onchain-query.mjs` | Generic. Same pattern, parameterised by SQL column types. Generated for any user table and any SELECT projection. |

The deploy and query scripts target whichever contract was last rendered (via `.last-rendered.json`). When no render has been done they default to `StakersQuery` so the canonical demo runs out-of-the-box.

### Live mainnet addresses

| Artifact | Address |
|---|---|
| QueryRouter (Base + Ethereum) | `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB` |
| Verifier (Base) | `0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518` |
| Verifier (Ethereum) | `0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9` |
| SXT ERC-20 (Base) | `0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8` |
| SXT ERC-20 (Ethereum) | `0xE6Bfd33F52d82Ccb5b37E16D3dD81f9FFDAbB195` |
| SXTChainFunding (Ethereum) | `0xb1bc1d7eb1e6c65d0de909d8b4f27561ef568199` |
| Canonical demo table (SXT mainnet) | `MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS` |
| Sample wallet present in demo table | `0x6de6e901bbefd26a9888798a25e4a49309d04ca9` |

---

## Reading a verified callback

Once the pipeline runs end-to-end, the result is a Base-mainnet transaction whose log entry is the Proof of SQL receipt.

1. Open the most recent `query()` callback transaction on BaseScan.
2. Find the `MembershipProven` event (for `StakersQuery`) or `QueryRow` event (for `OnchainQuery`) in the log.
3. The event's argument is the staker address that the SXT executor proved is in your published table. The on-chain Verifier validated the proof in 150K gas inside QueryRouter; the result reached your contract via callback. No trust assumption in SXT, the API, or the publishing wallet, only the chain.

Negative membership produces `MembershipNotFound` or `QueryEmpty`. The proof is equally cryptographic in both cases.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `1010: Inability to pay some fees` on publish | SxT chain native balance is 0 | Fund via `SXTChainFunding` mainnet contract |
| `save-proof-plans.mjs` returns no `proofPlan` | Table not yet propagated, or namespace casing mismatch | Wait 30s after publish and retry |
| `forge build` fails with "Identifier already declared" | `sxt-proof-of-sql-sdk` npm version conflict (pin v0.54.0) | `forge clean && forge soldeer install` |
| `query-onchain.mjs` times out at 1 hour with no callback while `check-executor-activity.mjs` shows the executor fulfilling other queries on Base | Table never landed in the dreamspace MAINNET catalog. Most common cause: a `PRIMARY KEY` clause in the original CREATE TABLE. SXT chain accepts the DDL and rows ingest, but the indexer skips promoting the table to MAINNET. The on-chain executor and `/v1/zkquery` REST prover both look in MAINNET only. Silent skip. | Republish under a new namespace using the current `publish-dataset-cli.mjs` (which never emits PK). Recover stuck SXT via `cancelQuery(queryId, payment)` on QueryRouter. `inspect-query.mjs` decodes the original `QueryRequested` event so you have the exact `Payment` struct to pass back. |
| `/v1/zkquery` returns `422 "does not exist in source network MAINNET"` | Same root cause as the timeout above. This is the cheap pre-flight reproduction (zero SXT). | Republish without PRIMARY KEY. |
| `/v1/zkquery` returns `400 "source network 'X' is not supported"` | A `sourceNetwork` value other than the literal `"MAINNET"` was passed | Only `"MAINNET"` (uppercase, case-sensitive) is accepted, even for user-published Community-tier tables. |
| `401 SECURITY: Invalid JWT` on any `api.makeinfinite.dev` REST call | Raw `SXT_API_KEY` sent as Bearer, or the JWT expired (25-min lifetime) | Exchange API key first. POST `proxy.api.makeinfinite.dev/auth/apikey` with header `apikey: <key>`, use the returned `accessToken` as Bearer. The SXT SDK and the scripts in this repo handle this automatically. See `examples/scripts/verify-stakers.mjs` for the canonical pattern. |
| Deploy reverts with insufficient funds | Wallet has < ~0.001 ETH on Base | Top up. Bridge ETH to Base via bridge.base.org. |
| Skill doesn't auto-activate | Phrasing didn't match the trigger | Use direct invocation: `/<plugin>:<skill>` |
| Table appears in `chain.spaceandtime.io` with rows but not in `dreamspace.xyz/queries/new` Studio | Two distinct registries. chain.spaceandtime.io reads chain commitment storage directly; dreamspace.xyz reads an indexed catalog that the chain indexer populates only for tables that pass its gates (NOT NULL only, no PK). | Same fix as the timeout row above. Republish without PRIMARY KEY. |

---

## Repo layout

```
.
├── .claude-plugin/marketplace.json     marketplace manifest (3 plugins)
├── packages/
│   ├── plugins/                        the 5 skills
│   │   ├── dreamspace-data/skills/dataset-publish/
│   │   ├── dreamspace-query/skills/proof-of-sql-foundations/
│   │   ├── dreamspace-query/skills/run-proven-query/
│   │   └── dreamspace-contracts/skills/{deploy-contract,pre-deploy-audit}/
│   └── mcp/sxt-mcp/                    the MCP server
│       ├── src/index.ts                stdio entrypoint
│       ├── src/http.ts                 HTTP entrypoint (read-only)
│       ├── src/server.ts               buildServer() factory
│       ├── src/lib/network.ts          mainnet double-gate
│       ├── src/lib/logger.ts           level-gated logger with secret redaction
│       ├── src/tools/*.ts              one file per tool handler
│       ├── scripts/day1-smoke.mjs      stdio protocol smoke
│       ├── scripts/day2-http-smoke.mjs HTTP protocol + security smoke
│       └── SAFETY.md                   engineering protocol and security model
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
│   │   └── (out/, cache/, dependencies/  gitignored build artifacts)
│   └── scripts/                        bootstrap and the 8-step pipeline
└── src/app/                            docs site (Next.js, /docs/quick-start)
```

The web docs render at `npm run dev`, then http://localhost:3000/docs.

---

## Roadmap

**Tier 1 (today).** Three plugins on the marketplace. MCP server with stdio (all four tools) and HTTP (read-only). Mainnet double-gate. Canonical demo table on SXT mainnet. StakersQuery contract on Base mainnet. Verified end-to-end against fresh tables.

**Tier 2 (in flight, roughly one week).** Publish `@biffbuster/sxt-mcp` to npm. Outstanding items: error-message sanitizer (strip absolute paths from echoed errors), structured per-call audit log, vitest suite replacing the smoke scripts. None of these block functionality; they are the polish required to lift `private: true`. After Tier 2, installing the MCP server is `npm install`, not build-from-source.

**Tier 3 (roadmap, gated on SXT partnership).** Hosted multi-tenant HTTP MCP, where ChatGPT users sign in with their own SXT account and skip the tunnel setup entirely. This is the truly seamless ChatGPT path. It depends on coordination with the SXT team for per-key rate limits, an OAuth-to-SXT-API-key flow (which does not exist in SXT's public surface today), and a decision about who operates the hosted service. Out of scope until Tier 2 is approved and a partnership conversation is open.

---

## References

- [`docs.spaceandtime.io`](https://docs.spaceandtime.io)
- [Quick intro to Space and Time](https://docs.spaceandtime.io/docs/what-is-space-and-time-quick-intro)
- [Creating tables (DDL)](https://docs.spaceandtime.io/docs/creating-tables-ddl-1)
- [Queries from a smart contract (ZK SQL onchain)](https://docs.spaceandtime.io/docs/queries-from-a-smart-contract-zk-sql-onchain)
- [ZK SQL via smart contracts](https://docs.spaceandtime.io/docs/zk-sql-via-smart-contracts)
- [ZK-Proven SQL queries (technical)](https://docs.spaceandtime.io/docs/zk-proven-sql-queries-technical)
- [`spaceandtimefdn/sxt-chain-examples`](https://github.com/spaceandtimefdn/sxt-chain-examples) (canonical examples this repo mirrors)

---

## License

MIT. See [`LICENSE`](./LICENSE).
