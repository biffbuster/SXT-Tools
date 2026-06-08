---
name: index-contract
description: Register any verified EVM smart contract for Space and Time to index its events into queryable SXT chain tables under your namespace. **Status (June 2026):** SCI tables are not yet on the zk-proven surface — SXT's own docs list them as "coming soon." Data ingestion works (via chain.spaceandtime.io's "Get data from chain" UI) but the on-chain Proof-of-SQL pipeline does NOT. For NFT/token activity proofs that work TODAY, route the user to the `chain-data-query` skill against the pre-indexed `ETHEREUM.ERC721_TRANSFERS` / `ERC20_TRANSFERS` / `ERC1155_TRANSFERS` tables instead.
---

# Index Contract — Smart Contract Indexing (SCI)

## Status — read this first

🚨 **SCI tables are NOT yet on the zk-proven surface today (June 2026).** SXT's official [Indexed Ethereum Data (ZK-proven)](https://docs.spaceandtime.io/docs/indexed-ethereum-data-zk-proven) docs page lists user-registered SCI tables as **"coming soon"** while shipping 23 pre-indexed Ethereum tables (BLOCKS, TRANSACTIONS, ERC20_TRANSFERS, ERC721_TRANSFERS, ERC1155_TRANSFERS, etc.) on the proven surface.

What that means concretely:
- ✅ Data ingestion via SCI works — you can register a contract via [chain.spaceandtime.io](https://chain.spaceandtime.io) ("Get data from chain"), tables get created in your namespace, and (eventually) rows populate
- ❌ But `/v1/zkquery` cannot prove queries against those tables today, and on-chain `QueryRouter.requestQuery` will silently drop the request — the same failure mode as CSV publishes with a `PRIMARY KEY` clause
- ❌ The full pipeline this repo demonstrates (proven query → callback contract on Base) is **blocked for SCI tables** until SXT promotes them to the zk-committed catalog

**Today's recommended path for "prove a wallet interacted with contract X":** use the pre-indexed surface (`ETHEREUM.ERC721_TRANSFERS`, `ETHEREUM.ERC20_TRANSFERS`, etc.) via the `chain-data-query` skill. That surface IS zk-proven today. The canonical worked example for the NFT-ownership story now lives there (Pudgy Penguins via `ERC721_TRANSFERS`).

🚧 **CLI implementation also in progress.** Even for plain data ingestion the CLI script (`index-contract.mjs`) isn't built yet — today's path is the Studio UI. This SKILL.md documents the intended CLI shape so forked users can preview the design.

## What this skill will eventually do

Once SXT ships SCI zk-commitment AND we build the CLI, this skill will register an EVM smart contract for SXT's indexer service. Per the SXT SCI docs verbatim:

> "We pull the ABI, we automatically generate a table for each smart contract event, and we begin populating them for you automatically."

The per-event tables will live under your namespace and become Proof-of-SQL queryable, with the trust model upgrade vs `dataset-publish`:
- **CSV publish:** "trust the publisher that the rows are accurate"
- **Contract indexing:** "trust only Ethereum" — events come from the chain itself, SXT just transcribes them into queryable form

For now the second model only works against the 23 pre-indexed core tables, not against arbitrary user-registered contracts.

## Indexing window — live mode today, historical mode coming soon

Confirmed verbatim from the chain.spaceandtime.io Studio UI on the table-registration step:

> **Live mode (active)** — indexes events from the current block forward in real time.
>
> **Historical mode (coming soon)** — will backfill from the contract's deployment block, then continue live.

So as of today (2026-06):

- **Newly registered tables start indexing from the current block forward, NOT from the contract's deployment block.** A registered table's `start_block` is whatever Ethereum block was current at registration time.
- **There is no historical backfill option exposed today.** The historical-mode UI control is labeled "coming soon" — the feature is on SXT's roadmap, no public timeline.
- This means a query like *"has wallet X ever owned a CryptoPunk?"* is unanswerable via SCI today — only *"has wallet X bought a CryptoPunk since `<registration_block>`?"* is answerable.

### Decision rubric for the agent

| User question shape | Today's answer |
|---|---|
| "Real-time monitoring going forward" | ✅ Register → tail. SCI live mode is the right tool. |
| "Has X done Y since [date after registration]?" | ✅ Register → wait for matching events → query. |
| "Has X done Y in the contract's full history?" | ❌ Blocked today. Live-only doesn't answer this. Either wait for SXT's historical mode to ship, or use the chain-wide indexed tables (`ETHEREUM.TRANSACTIONS` filtered by `TO_ADDRESS = contract` + decoded calldata) via `chain-data-query` instead. |
| "Total counts / sums over full history" | ❌ Same — blocked until historical mode ships. |

### Empirical check before committing to a use case

After registering and funding a table:
1. Run `SELECT MIN(BLOCK_NUMBER), MAX(BLOCK_NUMBER), COUNT(*) FROM <NS>.<EVENT_TABLE>` to confirm the indexer is tailing live.
2. Run an off-chain `/v1/zkquery` against the table even with `COUNT(*) = 0` — a successful HyperKZG proof of an empty result confirms the SCI table is on the zk-committed proven surface (separate question from "do rows exist yet"). A 422 from the prover means SCI tables aren't proven yet and onchain `query()` won't work.
3. Only after the gate test passes is it safe to spend 100 SXT on an onchain `query()`.

## When to invoke (once shipped)

- The user wants to query a smart contract's event history with Proof of SQL — any EVM event: NFT trades, DEX swaps, lending protocol borrows, governance votes, ENS registrations, anything indexable.
- The user wants trustless onchain data verification but the relevant SXT-indexed catalog table isn't zk-committed yet.
- The user is shipping a product that needs cryptographic guarantees about contract activity (e.g., "verify this wallet has interacted with this contract" → reusable Solidity callback).

## CLI shape (planned)

The CLI accepts any verified contract. Pass the address, chain, and the events you want indexed:

```bash
# Generic shape — substitute your own contract
node index-contract.mjs \
  --address <0x…> \
  --chain <ethereum|base> \
  --events <Event1,Event2,…> \
  [--namespace <MY_PROJECT>]

# Example — Pudgy Penguins Transfer event (any standard ERC-721 works the same way)
node index-contract.mjs \
  --address 0xBd3531dA5CF5857e7CfAA92426877b022e612cf8 \
  --chain ethereum \
  --events Transfer
```

**Reminder:** even when this CLI ships, the resulting tables won't be Proof-of-SQL queryable until SXT promotes SCI to the zk-proven surface. Today the empirically end-to-end-working zk-proven Ethereum surface is just `ETHEREUM.BLOCKS` and `ETHEREUM.TRANSACTIONS` (mirrors SXT's own canonical SDK example). When SXT activates more tables (the docs list ERC-20 / ERC-721 / ERC-1155 transfers as "ZK-proven" but only the core two execute end-to-end through the prover today), this section will widen accordingly.

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
7. The indexer creates the schema, back-populates from the contract's event history, and tails new blocks live (turnaround typically minutes to hours depending on contract volume; not yet documented by SXT — verify empirically for your case)
8. Note the resulting namespace + table references — paste them into the rest of the pipeline

Once the tables have a few rows, point `chain-data-query` at them by adding the table refs to `ZK_COMMITTED_TABLES` in `generate-chain-plan.mjs` (or wait for the next CLI release where this happens automatically via the handoff).

## Worked example (planned, post-zk-commit) — any verified ERC-721

Once SCI tables join the zk-proven surface, the canonical demo will be a generic "verify wallet owned NFT from collection X" flow:

User goal: "verify wallet has held a token from collection `<contract>`."

- Contract: any verified ERC-721 (e.g. Pudgy Penguins `0xBd3531dA5CF5857e7CfAA92426877b022e612cf8`)
- Event: `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)`
- Resulting table (per SXT's auto-naming): `<NS>.TRANSFER`
- Proof query (parameterized): `SELECT COUNT(*) FROM <NS>.TRANSFER WHERE TO_ADDRESS = $1` → returns ≥ 1 if the wallet has ever received a token from that collection
- Rendered verifier: `NftOwnershipVerifier.sol` via `render-onchain-query.mjs --params`
- Onchain call: `verifyOwnership(wallet)` → emits a `QueryFulfilled` event on Base with cryptographic proof of the wallet's history with that collection

**Until SCI zk-commitment ships**, the same demo is achievable TODAY against the pre-indexed `ETHEREUM.ERC721_TRANSFERS` table via the `chain-data-query` skill, which works for any ERC-721 contract address as a query parameter — no per-collection registration step needed. See the Pudgy Penguins worked example there.

## Constraints (today and after zk-commit ships)

- **SCI tables are not on the zk-proven surface today** — see Status section above. This is the blocker for the full pipeline.
- **Backfill turnaround is not documented** — even for plain data ingestion, "a few minutes to a few hours" per SXT docs depending on contract size. Large contracts (CryptoPunks, Seaport) can take hours. No "backfill complete" webhook; poll `MAX(BLOCK_NUMBER)`.
- **Verified ABI required** — the contract must be source-verified on the explorer. Unverified contracts can't be auto-indexed because the event ABI is unknown.
- **Cost** — chain credits for namespace + table creation (cents), plus ≥100 SXT per indexed event-table to fund the indexer account.
- **Supported chains today** — Ethereum mainnet + Base mainnet per SXT's SCI docs. Other EVM chains may follow.

## Pairs with

- `chain-data-query` — the today-works path. Query `ETHEREUM.ERC721_TRANSFERS` / `ERC20_TRANSFERS` / `ERC1155_TRANSFERS` against any contract address parameter — covers most "prove wallet activity with contract X" use cases without needing per-contract SCI registration.
- `pre-deploy-audit` + `deploy-contract` — same downstream pipeline as any other proof source (once SCI zk-commit ships)
- `dataset-publish` — alternative path for off-chain reference data

## References

- SXT SCI docs: https://docs.spaceandtime.io/docs/smart-contract-indexing
- SXT zk-proven Ethereum tables (the surface that DOES work today): https://docs.spaceandtime.io/docs/indexed-ethereum-data-zk-proven
- chain.spaceandtime.io UI (today's data-ingestion path): https://chain.spaceandtime.io
- Etherscan: https://etherscan.io (for ABI verification status)
