# SXT Tools Plugins

Three Claude Code plugins shipping seven skills for the Space and Time stack. Each plugin installs independently; the skills compose freely.

For the full overview, quickstart, troubleshooting, and architecture, see [`README.md`](../../README.md) and [`HOW_IT_WORKS.md`](../../docs/HOW_IT_WORKS.md) at the repo root.

## Layout

```
packages/plugins/
├── dreamspace-data/        skills/dataset-publish/
│                           skills/index-contract/
├── dreamspace-query/       skills/proof-of-sql-foundations/
│                           skills/run-proven-query/
│                           skills/chain-data-query/
└── dreamspace-contracts/   skills/deploy-contract/
                            skills/pre-deploy-audit/
```

## Skills

| Skill | Purpose |
|---|---|
| `dreamspace-data:dataset-publish` | Publish a CSV to a chain-secured SXT table via Substrate extrinsics + Apache Arrow IPC, EthEcdsa-signed. Auto-infers column types from the first row when no `schema.json` is supplied; never emits `PRIMARY KEY` (would block the dreamspace MAINNET indexer). |
| `dreamspace-data:index-contract` | Register an EVM contract for SXT to index its events into per-event tables under your namespace, via `examples/scripts/index-contract.mjs` (`tables.createTableWithSciMetadata`) or the chain.spaceandtime.io UI. SCI tables are not yet zk-provable. Canonical example: any verified ERC-721 `Transfer`. |
| `dreamspace-query:proof-of-sql-foundations` | Constraint guardrail. The proven SQL surface (`SELECT/WHERE/GROUP BY`, single-chain `JOIN`, `=/≥/≤`, `AND/OR/NOT`, `+/-/*`, `SUM/COUNT`, `BOOLEAN/BIGINT/VARCHAR/DECIMAL75/TIMESTAMP`). Refuses queries outside the surface and offers rewrites. |
| `dreamspace-query:run-proven-query` | Bridge from a published table + a natural-language goal to a Proof of SQL query, executed via the SXT REST API (`/v1/zkquery`, JWT-authed) or rendered as an EVM proof plan for onchain consumption. |
| `dreamspace-query:chain-data-query` | Generate parameterized proof plans against SXT's zk-committed Ethereum index (`ETHEREUM.BLOCKS` / `ETHEREUM.TRANSACTIONS`) or your `index-contract`-populated tables. Trust-minimized L1 → L2 primitives via `IQueryRouter.requestQuery`. |
| `dreamspace-contracts:deploy-contract` | `forge create` wrapper with explicit network selection, gas estimation, env-var key handling, mainnet confirmation gate, and post-deploy Etherscan verification. |
| `dreamspace-contracts:pre-deploy-audit` | Static analysis (slither) plus cross-references against user-published reference tables on SXT. Produces a structured audit report. |

## Install

Via the marketplace:

```
/plugin marketplace add biffbuster/sxt-tools
/plugin install dreamspace-data@sxt-tools
/plugin install dreamspace-query@sxt-tools
/plugin install dreamspace-contracts@sxt-tools
```

For local development:

```bash
claude --plugin-dir packages/plugins/dreamspace-data \
       --plugin-dir packages/plugins/dreamspace-query \
       --plugin-dir packages/plugins/dreamspace-contracts
```

## Skill format

Each skill is a single Markdown file with YAML frontmatter. No runtime servers, no API tokens bundled. See [docs.claude.com/en/docs/claude-code/skills](https://docs.claude.com/en/docs/claude-code/skills) for the format reference.
