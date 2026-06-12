---
name: index-contract
description: Register any EVM smart contract for Space and Time to index its events into queryable SXT chain tables under your namespace — via the CLI (`examples/scripts/index-contract.mjs`, submits `tables.createTableWithSciMetadata`) or the chain.spaceandtime.io Studio UI. **Status (June 2026):** SCI tables are not yet on the zk-proven surface — SXT's own docs list them as "coming soon." Data ingestion works but the on-chain Proof-of-SQL pipeline does NOT. For NFT/token activity proofs that work TODAY, route the user to the `chain-data-query` skill against the pre-indexed `ETHEREUM.ERC721_TRANSFERS` / `ERC20_TRANSFERS` / `ERC1155_TRANSFERS` tables instead.
---

# Index Contract — Smart Contract Indexing (SCI)

## Status — read this first

🚨 **SCI tables are NOT yet on the zk-proven surface today (June 2026).** SXT's official [Indexed Ethereum Data (ZK-proven)](https://docs.spaceandtime.io/docs/indexed-ethereum-data-zk-proven) docs page lists user-registered SCI tables as **"coming soon"** while shipping 23 pre-indexed Ethereum tables (BLOCKS, TRANSACTIONS, ERC20_TRANSFERS, ERC721_TRANSFERS, ERC1155_TRANSFERS, etc.) on the proven surface.

What that means concretely:
- ✅ Data ingestion via SCI works — you can register a contract via [chain.spaceandtime.io](https://chain.spaceandtime.io) ("Get data from chain"), tables get created in your namespace, and (eventually) rows populate
- ❌ But `/v1/zkquery` cannot prove queries against those tables today, and on-chain `QueryRouter.requestQuery` will silently drop the request — the same failure mode as CSV publishes with a `PRIMARY KEY` clause
- ❌ The full pipeline this repo demonstrates (proven query → callback contract on Base) is **blocked for SCI tables** until SXT promotes them to the zk-committed catalog

**Today's recommended path for "prove a wallet interacted with contract X":** use the pre-indexed surface (`ETHEREUM.ERC721_TRANSFERS`, `ETHEREUM.ERC20_TRANSFERS`, etc.) via the `chain-data-query` skill. That surface IS zk-proven today. The canonical worked example for the NFT-ownership story now lives there (Pudgy Penguins via `ERC721_TRANSFERS`).

✅ **CLI registration is implemented:** `examples/scripts/index-contract.mjs` submits the same `tables.createTableWithSciMetadata` extrinsic the Studio UI uses (verified by reading live `api.query.tables.tableMetadata` entries on SXT mainnet, June 2026). Registration + ingestion work today; the zk-proof pipeline against the resulting tables does not (see Status above).

## What this skill does

Registers an EVM smart contract's events for SXT's indexer service. Per the SXT SCI docs verbatim:

> "We pull the ABI, we automatically generate a table for each smart contract event, and we begin populating them for you automatically."

The per-event tables live under your namespace, with the trust model upgrade vs `dataset-publish`:
- **CSV publish:** "trust the publisher that the rows are accurate"
- **Contract indexing:** "trust only Ethereum" — events come from the chain itself, SXT just transcribes them into queryable form

Until SXT promotes SCI tables to the zk-committed catalog, the second model is only *provable* against the pre-indexed core tables, not against arbitrary user-registered contracts.

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

## When to invoke

- The user wants a smart contract's events indexed into SXT chain tables going forward — any EVM event: NFT trades, DEX swaps, lending protocol borrows, governance votes, ENS registrations, anything indexable.
- The user is preparing for the day SCI joins the zk-proven surface and wants ingestion running now.
- The user needs Proof-of-SQL guarantees TODAY → route to `chain-data-query` instead (see Status).

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

**Reminder:** the resulting tables won't be Proof-of-SQL queryable until SXT promotes SCI to the zk-proven surface. Today the empirically end-to-end-working zk-proven Ethereum surface is just `ETHEREUM.BLOCKS` and `ETHEREUM.TRANSACTIONS` (mirrors SXT's own canonical SDK example). When SXT activates more tables, this section will widen accordingly.

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
- **Verified ABI required only for `--events` mode** — `--event-signature` works for any contract, verified or not, because you supply the event declaration yourself.
- **Cost** — creating an SCI table **burns 20 SXT per table** for non-privileged accounts (`CREATE_COST` in the sxt-node tables pallet; verified June 2026 — a `FundsUnavailable` dispatch error means your SXT chain balance is below the burn). On top of that, ≥100 SXT per event-table funds the indexer account to start ingestion. Plus negligible chain credits for the namespace.
- **Supported chains today** — `ethereum`, `sepolia`, `polygon`, `zksync` (the SXT chain `Source` enum, verified June 2026). **Not Base** — despite SXT marketing mentioning Base indexing, the chain's Source enum has no Base variant; the Studio UI's Base support presumably routes differently. Re-probe the enum before assuming this changed.

## Pairs with

- `chain-data-query` — the today-works path. Query `ETHEREUM.ERC721_TRANSFERS` / `ERC20_TRANSFERS` / `ERC1155_TRANSFERS` against any contract address parameter — covers most "prove wallet activity with contract X" use cases without needing per-contract SCI registration.
- `pre-deploy-audit` + `deploy-contract` — same downstream pipeline as any other proof source (once SCI zk-commit ships)
- `dataset-publish` — alternative path for off-chain reference data

## References

- SXT SCI docs: https://docs.spaceandtime.io/docs/smart-contract-indexing
- SXT zk-proven Ethereum tables (the surface that DOES work today): https://docs.spaceandtime.io/docs/indexed-ethereum-data-zk-proven
- chain.spaceandtime.io UI (today's data-ingestion path): https://chain.spaceandtime.io
- Etherscan: https://etherscan.io (for ABI verification status)
