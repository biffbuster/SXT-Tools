---
name: index-contract
description: Register any EVM smart contract for Space and Time to index its events into queryable SXT chain tables under your namespace — via the CLI (`examples/scripts/index-contract.mjs`, submits `tables.createTableWithSciMetadata`) or the chain.spaceandtime.io Studio UI. **Status (Nov 2026):** SCI tables are provable. A live `/v1/zkquery` proof against a registered CryptoPunks table verified on 2026-06-30, and the prover plans SCI queries (including address-column filters) as of 2026-11-16. Indexing is live-only (no historical backfill), so for "ever in history" questions route to the `chain-data-query` skill against the pre-indexed `ETHEREUM.*` tables instead.
---

# Index Contract — Smart Contract Indexing (SCI)

## Status — read this first

**SCI tables are on the proven surface.** SXT's [Indexed Ethereum Data (ZK-proven)](https://docs.spaceandtime.io/docs/indexed-ethereum-data-zk-proven) page still lists SCI as "coming soon" (last updated 2025-11-06), but that page is out of date:

- ✅ 2026-06-30: `SELECT PUNK_INDEX, TO_ADDRESS, BLOCK_NUMBER FROM CRYPTOPUNKSMARKET_….PUNK_BOUGHT` returned `verified=true` with 57 rows through `/v1/zkquery`.
- ✅ 2026-11-16: the prover's planner (`POST /v1/zkquery/build-plan`, free) accepts SCI queries, including `WHERE TO_ADDRESS = 0x…` and `WHERE TO_ADDRESS = X'…'` on the BINARY address column.
- ⚠ A filter on a BINARY address column has been planned but not yet run through a full proof. Prove one off-chain before spending 100 SXT on an on-chain `query()`.

**The real limit is the indexing window, not provability.** SCI indexes from the registration block forward (see below). For "has this wallet ever interacted with contract X" questions, the pre-indexed `ETHEREUM.*` tables via `chain-data-query` still give the better answer.

✅ **CLI registration is implemented:** `examples/scripts/index-contract.mjs` submits the same `tables.createTableWithSciMetadata` extrinsic the Studio UI uses (verified by reading live `api.query.tables.tableMetadata` entries on SXT mainnet, June 2026).

## What this skill does

Registers an EVM smart contract's events for SXT's indexer service. Per the SXT SCI docs verbatim:

> "We pull the ABI, we automatically generate a table for each smart contract event, and we begin populating them for you automatically."

The per-event tables live under your namespace, with the trust model upgrade vs `dataset-publish`:
- **CSV publish:** "trust the publisher that the rows are accurate"
- **Contract indexing:** "trust only Ethereum" — events come from the chain itself, SXT just transcribes them into queryable form

Both models are provable. The difference is only in what you have to trust about the rows.

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
2. Run an off-chain `/v1/zkquery` against the table even with `COUNT(*) = 0` — a successful HyperKZG proof of an empty result confirms the SCI table is on the zk-committed proven surface (separate question from "do rows exist yet"). A 422 from the prover means this table is not in the proven catalog yet (check that registration landed and the table is funded), and onchain `query()` won't work.
3. Only after the gate test passes is it safe to spend 100 SXT on an onchain `query()`.

## When to invoke

- The user wants a smart contract's events indexed into SXT chain tables going forward — any EVM event: NFT trades, DEX swaps, lending protocol borrows, governance votes, ENS registrations, anything indexable.
- The user wants Proof-of-SQL over a specific contract's events from now on. Register, fund, wait for rows, then prove with `run-proven-query`.
- The user needs proofs over the contract's full history → route to `chain-data-query` instead (SCI is live-only).

## CLI usage

```bash
# Keyless mode (recommended) — the event declaration you type is stored
# verbatim on chain; no explorer API key, works even for unverified contracts.
node index-contract.mjs \
  --address 0xBd3531dA5CF5857e7CfAA92426877b022e612cf8 \
  --chain ethereum \
  --event-signature "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)" \
  [--namespace MY_PROJECT]

# ABI-fetch mode — needs ETHERSCAN_API_KEY (one v2 key covers all chains);
# the contract must be source-verified on the explorer.
node index-contract.mjs --address 0x… --chain ethereum --events Transfer,Approval

# Always rehearse first: --dry-run prints DDL + metadata + encoded extrinsics
# without signing anything; testnet is a separate credit balance.
SXT_RPC=wss://rpc.testnet.sxt.network node index-contract.mjs \
  --address 0x… --chain sepolia --event-signature "event …" --dry-run
```

**Supported chains: `ethereum`, `sepolia`, `polygon`, `zksync`** — these are the SXT chain's `Source` enum variants (verified against live chain metadata, June 2026). **There is no Base variant on-chain today**; `--chain base` is rejected with an explanatory error. (Bitcoin is in the enum but has no EVM events.)

What the script does:
1. Resolves event declarations (typed `--event-signature`, or verified ABI via Etherscan v2 with `--events`)
2. Maps event params → SXT columns (`uint*`/`int*` → `DECIMAL(75,0)`, `address` → `BINARY` — both verified against live Studio-registered tables; SQL reserved words auto-renamed, e.g. `from`/`to` → `FROM_ADDRESS`/`TO_ADDRESS` matching SXT's pre-indexed naming; arrays/tuples/indexed-dynamic-types/anonymous events refused)
3. Builds DDL with `NOT NULL` on every column + implicit `BLOCK_NUMBER BIGINT` / `TIME_STAMP TIMESTAMP` — never a `PRIMARY KEY`
4. Prints the full plan and requires confirmation (typing `mainnet` on mainnet; `--yes` for scripted use)
5. Submits `utility.batchAll([tables.createNamespace, tables.createTableWithSciMetadata × events])` with the same AlreadyExists fallback as `publish-dataset-cli.mjs` — idempotent re-runs
6. Writes `.last-publish.json` handoff with `kind: "indexed-sci"` so downstream skills auto-pick up the new tables
7. Prints funding instructions — each table starts indexing only once its funding account holds ≥100 SXT. The funding-account derivation is not exposed on-chain; get the address from chain.spaceandtime.io

**Reminder:** the resulting tables are provable once they hold rows. Check with the free plan-build call first, then prove off-chain with `run-proven-query` before any on-chain `query()`.

## Alternative — chain.spaceandtime.io Studio UI

The UI flow at https://chain.spaceandtime.io → **Index a Contract** does the same registration with extras the CLI can't do (custom column renames beyond reserved words, the per-table funding address displayed inline):

1. Connect your SXT-funded wallet
2. Paste the contract address + select chain
3. The UI fetches the ABI and lists indexable events — select the ones you want indexed
4. Review the generated table schema; rename columns if needed
5. Sign the namespace + table creation transactions (a few cents in SXT chain credits)
6. **Fund each derived table account with ≥100 SXT** (the UI displays the per-table funding address)
7. The indexer creates the schema and tails new blocks live (turnaround typically minutes to hours depending on contract volume; not yet documented by SXT — verify empirically for your case)
8. Note the resulting namespace + table references — paste them into the rest of the pipeline

Once the tables have a few rows, point `chain-data-query` at them by adding the table refs to `ZK_COMMITTED_TABLES` in `generate-chain-plan.mjs` (or wait for the next CLI release where this happens automatically via the handoff).

## Worked example — any verified ERC-721

A generic "verify wallet received an NFT from collection X" flow (covers events since registration only):

User goal: "verify wallet has held a token from collection `<contract>`."

- Contract: any verified ERC-721 (e.g. Pudgy Penguins `0xBd3531dA5CF5857e7CfAA92426877b022e612cf8`)
- Event: `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)`
- Resulting table (per SXT's auto-naming): `<NS>.TRANSFER`
- Proof query (parameterized): `SELECT COUNT(*) FROM <NS>.TRANSFER WHERE TO_ADDRESS = $1` → returns ≥ 1 if the wallet has ever received a token from that collection
- Rendered verifier: `NftOwnershipVerifier.sol` via `render-onchain-query.mjs --params`
- Onchain call: `verifyOwnership(wallet)` → emits a `QueryFulfilled` event on Base with cryptographic proof of the wallet's history with that collection

For the collection's full history, use the pre-indexed `ETHEREUM.ERC721_TRANSFERS` table via the `chain-data-query` skill instead, which takes any ERC-721 contract address as a query parameter with no registration step. See the Pudgy Penguins worked example there.

## Constraints

- **Live-only indexing** — see the indexing window section above. This is the main limit on what SCI can prove.
- **BINARY address filters are planned but not yet proven end to end** — see Status.
- **Backfill turnaround is not documented** — even for plain data ingestion, "a few minutes to a few hours" per SXT docs depending on contract size. Large contracts (CryptoPunks, Seaport) can take hours. No "backfill complete" webhook; poll `MAX(BLOCK_NUMBER)`.
- **Verified ABI required only for `--events` mode** — `--event-signature` works for any contract, verified or not, because you supply the event declaration yourself.
- **Cost** — creating an SCI table **burns 20 SXT per table** for non-privileged accounts (`CREATE_COST` in the sxt-node tables pallet; verified June 2026 — a `FundsUnavailable` dispatch error means your SXT chain balance is below the burn). On top of that, ≥100 SXT per event-table funds the indexer account to start ingestion. Plus negligible chain credits for the namespace.
- **Supported chains today** — `ethereum`, `sepolia`, `polygon`, `zksync` (the SXT chain `Source` enum, verified June 2026). **Not Base** — despite SXT marketing mentioning Base indexing, the chain's Source enum has no Base variant; the Studio UI's Base support presumably routes differently. Re-probe the enum before assuming this changed.

## Pairs with

- `chain-data-query` — the full-history path. Query `ETHEREUM.ERC721_TRANSFERS` / `ERC20_TRANSFERS` / `ERC1155_TRANSFERS` against any contract address parameter — covers most "prove wallet activity with contract X" use cases without needing per-contract SCI registration.
- `run-proven-query` — off-chain proof against the registered tables
- `pre-deploy-audit` + `deploy-contract` — same downstream pipeline as any other proof source
- `dataset-publish` — alternative path for off-chain reference data

## References

- SXT SCI docs: https://docs.spaceandtime.io/docs/smart-contract-indexing
- SXT zk-proven Ethereum tables (pre-indexed, full history): https://docs.spaceandtime.io/docs/indexed-ethereum-data-zk-proven
- chain.spaceandtime.io UI (today's data-ingestion path): https://chain.spaceandtime.io
- Etherscan: https://etherscan.io (for ABI verification status)
