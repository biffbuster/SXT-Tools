# DreamSpace AI — Prototype Skills

This directory holds the **working prototype** for the DreamSpace AI skills proposal. The full proposal lives at `/docs/spaceandtime-ai/overview` in the docs site.

## What's here

```
packages/plugins/
├── dreamspace-query/
│   ├── .claude-plugin/plugin.json
│   └── skills/
│       └── proof-of-sql-foundations/
│           └── SKILL.md
├── dreamspace-data/
│   ├── .claude-plugin/plugin.json
│   └── skills/
│       └── dataset-publish/
│           └── SKILL.md
└── dreamspace-contracts/
    ├── .claude-plugin/plugin.json
    └── skills/
        ├── deploy-contract/
        │   └── SKILL.md
        └── pre-deploy-audit/
            └── SKILL.md
```

Three plugins, four skills — the full DreamSpace workflow end-to-end:

- **`dreamspace-data : dataset-publish`** — Publish a chain-secured dataset to SXT (CSV/Parquet/JSON → committed onchain table). Walks the user through both the no-code chain.spaceandtime.io flow and the programmatic Polkadot.js + Apache Arrow flow.
- **`dreamspace-query : proof-of-sql-foundations`** — Pure Markdown guardrail. Teaches an agent the proven SQL surface, refuses queries that fall outside it, suggests rewrites. Required reading for any skill that touches SXT data.
- **`dreamspace-contracts : deploy-contract`** — Deploy a Solidity contract via foundry's `forge create`. Wraps deployment in best-practice defaults: explicit network selection, gas estimation, env-var key handling, mainnet confirmation gate, post-deploy Etherscan verification.
- **`dreamspace-contracts : pre-deploy-audit`** — Composite audit. Combines slither static analysis (optional) with cross-references against user-published reference tables (known exploits, drainer denylists, trusted-deployer allowlists) and indexed contract event history. Produces a structured Markdown audit report with proof receipts.

Together these four skills demonstrate the entire DreamSpace value loop, all driveable from a single Claude Code session:

1. **Generate** Solidity in the editor (default Claude behavior, no skill needed).
2. **Deploy** to a testnet (`deploy-contract`).
3. **Publish** reference data to SxT (`dataset-publish`).
4. **Audit** with proven cross-references (`pre-deploy-audit`).

Stages 1, 2, and 4 are 100% CLI-driven via Claude Code today. Stage 3 still has a one-time browser step for funding compute credits and uploading the CSV (the SXT official tutorial).

Other skills in the full proposal (`verified-analytics`, `discover-tables`, `enrich-with-onchain-data`, `verify-proof-onchain`, `index-contract`, `dataset-publish-cli`) are scoped but not yet authored — that's the v0.1 work this proposal funds.

## Quick demo path

For the full live-demo walkthrough — three tiers from "30-second zero-setup" to "full audit loop with SXT cross-references" — see [`DEMO.md`](../../DEMO.md) at the repo root. It includes the sample contract (`./examples/contracts/SampleToken.sol`), a sample reference dataset (`./examples/data/known-exploits-sample.csv`), recording-the-demo guidance, and troubleshooting.

## Try it locally

From the repo root, load all three plugins in one session:

```bash
claude --plugin-dir packages/plugins/dreamspace-data \
       --plugin-dir packages/plugins/dreamspace-query \
       --plugin-dir packages/plugins/dreamspace-contracts
```

Then in the Claude Code session, either invoke directly:

```
/dreamspace-data:dataset-publish ./data/known-exploits.csv
/dreamspace-query:proof-of-sql-foundations
/dreamspace-contracts:deploy-contract ./contracts/MyToken.sol --rpc-url $SEPOLIA_RPC
/dreamspace-contracts:pre-deploy-audit ./contracts/MyToken.sol
```

Or test contextual activation by phrasing prompts that match each skill's trigger description:

```
"I want to upload my known-exploit signatures CSV to SXT so my agent can audit against it"
   → activates dataset-publish, walks through the no-code or programmatic publish flow

"Run a SELECT with ORDER BY against my indexed table and prove it"
   → activates proof-of-sql-foundations, refuses the ORDER BY, offers a rewrite

"Deploy ./examples/contracts/SampleToken.sol to Sepolia"
   → activates deploy-contract, runs forge build + forge create, returns the deployed address

"I'm about to deploy this token contract to mainnet — cross-reference it against my exploit signatures table"
   → activates pre-deploy-audit, runs slither + queries MY_AUDIT.KNOWN_EXPLOITS with proof

"Is this contract address safe to integrate with: 0xa0b8...?"
   → activates pre-deploy-audit in post-deploy mode
```

### What you need installed

- **Foundry** (`curl -L https://foundry.paradigm.xyz | bash && foundryup`) — required for `deploy-contract`. Provides `forge create` and `cast`.
- **`slither`** (`pip install slither-analyzer`) — optional. Enables Phase 1 of `pre-deploy-audit`. The audit skill skips slither cleanly if not installed.
- **`SXT_API_KEY`** env var — required for any skill that calls SXT's REST or RPC endpoints.
- **A funded chain.spaceandtime.io wallet** — required for `dataset-publish` (compute credits) and for receiving Proof of SQL receipts.
- **`DEPLOYER_KEY`** env var (or similar) — required for `deploy-contract`. Never paste a key into chat; the skill refuses keys not in env vars.
- **RPC URL env vars** (`SEPOLIA_RPC`, `BASE_RPC`, etc.) — required for `deploy-contract` to know which chain to target.

If any prerequisite is missing, the skill tells the user what's missing and either runs degraded or stops. None of the skills silently skip work.

## Try it via the marketplace flow

The repo ships a top-level `.claude-plugin/marketplace.json` so the whole repo functions as a marketplace. After pushing this repo to a host you control:

```
/plugin marketplace add <your-handle>/<repo-name>
/plugin install dreamspace-query@dreamspace-ai
```

Same skill, same behavior, but installed via the canonical marketplace path.

## What this prototype proves

1. **The skill format works against real tooling today** — Claude Code, Cursor, and 49+ other agents via the Vercel Skills CLI all consume `SKILL.md`.
2. **One skill is enough to demonstrate the value** — agent stays inside the proven SQL surface, refuses unprovable queries, suggests rewrites.
3. **Zero infrastructure dependency** — this skill works whether or not the DreamSpace SDK ever ships.

## What it doesn't claim

- It does not call `@dreamspace/sdk` (which doesn't exist yet).
- It does not depend on a Foundation-blessed npm scope or repo handle.
- It does not require any new contracts or APIs to be deployed.

The proposal scales out from this single working skill. Funding ships the other six.
