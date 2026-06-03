---
name: index-contract
description: Register a verified EVM smart contract for Space and Time to index its events into queryable SXT chain tables under your namespace. Generates one POSQL-queryable table per event (e.g. Seaport's OrderFulfilled → a NFT-trades table you can query with Proof of SQL). Status — CLI implementation in progress; today users run the equivalent flow via chain.spaceandtime.io's "Index a Contract" UI, then point chain-data-query at the resulting tables.
---

# Index Contract — Smart Contract Indexing (SCI)

## Status

🚧 **CLI implementation in progress.** Today the canonical path is chain.spaceandtime.io's "Index a Contract" UI flow. This SKILL.md documents the intended CLI shape so forked users can preview the design, and details the UI workaround so they're unblocked in the meantime.

## What this skill will do

Register an EVM smart contract (Ethereum mainnet or Base) for SXT's indexer service to watch. For each event you select, SXT generates a dedicated table under YOUR namespace, populates it from live chain events, and publishes HyperKZG commitments — so the resulting tables are Proof of SQL queryable just like a published CSV.

The trust model upgrades meaningfully vs `dataset-publish`:
- **CSV publish:** "trust the publisher that the rows are accurate"
- **Contract indexing:** "trust only Ethereum" — events come from the chain itself, SXT just transcribes them into queryable form

## When to invoke (once shipped)

- The user wants to query a smart contract's event history with Proof of SQL — Seaport orders, Uniswap swaps, lending protocol liquidations, governance votes, anything that's an EVM event.
- The user wants trustless onchain data verification but the relevant SXT-indexed catalog table isn't zk-committed yet.
- The user is shipping a product that needs cryptographic guarantees about contract activity (e.g., "verify this wallet has interacted with this contract" → reusable Solidity callback).

## CLI shape (planned)

```bash
node index-contract.mjs \
  --address 0x0000000000000068F116a894984e2DB1123eB395 \
  --chain ethereum \
  --events OrderFulfilled,OrdersMatched \
  [--namespace MY_PROJECT]
```

The script will:
1. Fetch the verified ABI from Etherscan/BaseScan (requires `ETHERSCAN_API_KEY` / `BASESCAN_API_KEY` in env)
2. Extract the chosen events from the ABI and propose SXT SQL table schemas (event params → typed columns + standard metadata: `BLOCK_NUMBER`, `TRANSACTION_HASH`, `LOG_INDEX`)
3. Confirm with the user: namespace, table names, cost estimate
4. Submit `tables.createNamespace + tables.createTables` with `tableType: SCI` (vs `Community` for CSV publishes)
5. Compute the deterministic per-table funding account, transfer ≥100 SXT to each (this is what starts the indexer)
6. Poll for first indexed row to confirm the indexer is live
7. Write to `.last-publish.json` handoff with `kind: "indexed-sci"` so downstream skills (`chain-data-query`, `render-onchain-query`) auto-pick up the new tables

## Today's workaround — chain.spaceandtime.io UI

Until the CLI ships, use the UI flow at https://chain.spaceandtime.io → **Index a Contract**:

1. Connect your SXT-funded wallet
2. Paste the contract address + select chain (Ethereum or Base)
3. The UI fetches the ABI and lists indexable events — select the ones you want indexed
4. Review the generated table schema; rename columns if needed
5. Sign the namespace + table creation transactions (a few cents in SXT chain credits)
6. **Fund each derived table account with ≥100 SXT** (the UI displays the per-table funding address)
7. The indexer starts populating tables from "now" — no historical backfill (live-only)
8. Note the resulting namespace + table references — paste them into the rest of the pipeline

Once the tables have a few rows, point `chain-data-query` at them by adding the table refs to `ZK_COMMITTED_TABLES` in `generate-chain-plan.mjs` (or wait for the next CLI release where this happens automatically via the handoff).

## Worked example — Seaport NFT-trade verification

User goal: "verify if a wallet has made an OpenSea trade for a specific NFT collection."

1. **Today (UI):** register Seaport 1.5 (`0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC`) or 1.6 (`0x0000000000000068F116a894984e2DB1123eB395`) with `OrderFulfilled` event selected. Wait ~30 min for events to accumulate.
2. **Generate a parameterized proof plan** with `generate-chain-plan.mjs` against the resulting table: `SELECT COUNT(*) FROM <NS>.ORDER_FULFILLED WHERE OFFER_TOKEN = $1 AND OFFERER = $2`.
3. **Render `OpenSeaSwapVerifier.sol`** via `render-onchain-query.mjs --params` — accepts (collection, wallet) as runtime args.
4. **Audit + deploy** via existing skills.
5. **Query onchain**: anyone calls `verifySwap(collection, wallet)` → cryptographic proof of NFT trade history in a Base event log.

## Constraints (today and after CLI ships)

- **Live indexing only** — no historical backfill. You can only query trades that happened AFTER your SCI registration. SXT may add backfill later; no timeline.
- **Verified ABI required** — the contract must be source-verified on the explorer. Unverified contracts can't be auto-indexed because the event ABI is unknown.
- **Cost** — chain credits for namespace + table creation (cents), plus ≥100 SXT per indexed event-table to fund the indexer account.
- **Supported chains today** — Ethereum mainnet + Base mainnet per SXT's SCI docs. Other EVM chains may follow.
- **API tier for queries against SCI tables** — empirically unverified. The tables live in user namespaces (which the prover historically allows), but worth running the off-chain pre-flight before spending 100 SXT on the onchain `query()`.

## Pairs with

- `chain-data-query` — runs the parameterized proof queries against the SCI-populated tables
- `pre-deploy-audit` + `deploy-contract` — same downstream pipeline as any other proof source
- `dataset-publish` — alternative path for off-chain reference data

## References

- SXT SCI docs: https://docs.spaceandtime.io/docs/smart-contract-indexing
- chain.spaceandtime.io UI (today's path): https://chain.spaceandtime.io
- Etherscan: https://etherscan.io (for ABI verification status)
- Seaport ABI reference: https://github.com/ProjectOpenSea/seaport
