---
name: chain-data-query
description: Query SXT-indexed Ethereum chain data with a Proof of SQL receipt — and consume the result inside a Solidity contract on Base via IQueryRouter.requestQuery. Use when the user wants to prove an Ethereum block's contents or finality, a wallet's ETH balance at indexed blocks, or a contract's ownership transfers, or build any trust-minimized cross-chain primitive that depends on Ethereum history. Generates parameterized proof plans so one deployed contract serves any input. Pairs with proof-of-sql-foundations (the surface guardrail), pre-deploy-audit, and deploy-contract.
---

# Chain Data Query

## Status (2026-11-24)

Three SXT tables prove end to end: `ETHEREUM.BLOCKS`, `ETHEREUM.NATIVE_WALLETS` and `ETHEREUM.ERC173_OWNERSHIP_TRANSFERRED`, with rows from about block 22,432,845 (May 2025). Earlier blocks verify but return no rows. Eleven others plan but fail at the prover ("Query execution failed"), even with a narrow `WHERE`: `ETHEREUM.TRANSACTIONS`, `CONTRACTS`, and the token and NFT contract, approval, owner and transfer tables. `TRANSACTIONS` has also stalled the prover for every user. `sxt chain-plan` and the MCP server refuse all eleven. Ungrouped aggregates such as `COUNT(*) ... WHERE` fail off-chain too; project rows or group by one non-VARCHAR column, and pre-flight the exact SQL with `sxt verify --sql` before any on-chain spend.

## What this skill does

Generates a HyperKZG-provable SQL query against SXT's zk-committed indexed chain data, runs it through the off-chain prover as a pre-flight (one query credit, no SXT or ETH), and produces the Solidity-ready proof plan that a Base mainnet contract consumes via `IQueryRouter.requestQuery`. The contract's callback receives the cryptographically verified result — no oracle, no bridge, no archive node in the loop.

This is the trust-minimizing counterpart to `dataset-publish`. Where `dataset-publish` puts the user's *own* data on chain and proves queries against it, `chain-data-query` proves queries against **data that's already on Ethereum mainnet** as committed history. The trust assumption collapses to "Ethereum itself."

## When to invoke

- The user wants to prove a fact about an Ethereum block: that it exists, its hash, its transaction count.
- The user wants to prove a wallet's ETH balance at indexed blocks, or a contract's ownership history.
- The user mentions cross-chain receipt verification, bridge sanity checks, or L1→L2 trust-minimization.
- A downstream contract on Base needs to act on a fact about L1 without trusting an oracle or relayer.

Do **not** invoke this skill when:
- The user wants to query their own CSV — that's `dataset-publish` followed by `run-proven-query`.
- The user wants per-wallet transaction history or token transfers. Those tables fail at the prover today (see the next section). Refuse and explain the surface limit.

## The zk-committed surface today

SXT's [Indexed Ethereum Data (ZK-proven)](https://docs.spaceandtime.io/docs/indexed-ethereum-data-zk-proven) page lists 22 `ETHEREUM.*` tables as ZK-proven, and the chain planner accepts all 22. One live proof per table on 2026-11-19 found three that execute:

| Table | Columns (live catalog) | Useful for |
|---|---|---|
| `ETHEREUM.BLOCKS` | `TIME_STAMP`, `BLOCK_NUMBER` (BIGINT), `BLOCK_HASH`, `PARENT_HASH`, `MINER` (VARBINARY), `GAS_LIMIT`, `GAS_USED`, `REWARD` (DECIMAL), `SIZE`, `TRANSACTION_COUNT`, `UNCLES_COUNT`, plus the state, receipts and transactions roots | Block existence, hash and finality proofs |
| `ETHEREUM.NATIVE_WALLETS` | `TIME_STAMP`, `BLOCK_NUMBER`, `WALLET_ADDRESS` (VARBINARY), `BALANCE` (DECIMAL) | ETH balance snapshots |
| `ETHEREUM.ERC173_OWNERSHIP_TRANSFERRED` | `TIME_STAMP`, `BLOCK_NUMBER`, `TRANSACTION_HASH`, `TRANSACTION_INDEX`, `EVENT_INDEX`, `CONTRACT_ADDRESS`, `PREVIOUS_OWNER`, `NEW_OWNER` (VARBINARY) | Contract ownership transfers |

**Fail at the prover, refused:** `TRANSACTIONS`, `CONTRACTS`, `TOKEN_ERC20_CONTRACTS`, `NFT_ERC721_CONTRACTS`, `NFT_ERC1155_CONTRACTS`, `NFT_ERC721_APPROVAL`, `NFT_ERC721_APPROVAL_FOR_ALL`, `NFT_ERC721_OWNERS`, `NFT_ERC1155_OWNERS`, `NFT_ERC721_TRANSFER`, `NFT_ERC1155_TRANSFER`.

**Unverified:** five tables over 8 GB (`TRANSACTION_DETAILS`, `NATIVE_TOKEN_TRANSFERS`, `TOKEN_ERC20_TRANSFERS`, `TOKEN_ERC20_WALLET_BALANCES`, `TOKEN_ERC20_APPROVAL`) and three empty `PROXY_*` tables. There is no `BASE.*` catalog.

Tables registered with `index-contract` (SCI) also prove (verified 2026-06-30); `generate-chain-plan.mjs` takes them by reference like any other table.

**Column rules on the live catalog:** hashes and addresses are VARBINARY, so compare them with a hex literal (`X'd8da…'` or bare `0xd8da…`), never a quoted string. DECIMAL and TIMESTAMP columns can be selected but not compared in `WHERE`; filter on `BLOCK_NUMBER` or a VARBINARY column.

**Pre-flight before assuming.** Planner acceptance is not evidence that a table proves. Before building on a table, run one real proof with `sxt verify --sql`. `generate-chain-plan.mjs` refuses the eleven failing tables and any table with no commitments (chain error 254018).

**Refuse and explain** for: the eleven failing tables, unverified tables until a proof verifies, and `BASE.*` anything.

## Inputs

Required:

- **User goal in plain English** — what they want to prove ("prove block N exists with this hash", "prove this wallet's ETH balance", "prove who owns this contract").
- **`SXT_API_KEY`** in env — for the off-chain pre-flight via `/v1/zkquery`.
- **`PRIVATE_KEY`** in env — for the onchain deploy + `query()` call (a Base wallet funded with ~$0.50 ETH + 100 SXT ERC-20 per query).

Conditionally needed:

- **Parameter values** at query time (a block number, an address) — supplied at `query-onchain.mjs` invocation, not at plan generation. The plan is parameterized so one deployment serves arbitrary inputs.

## Concrete execution recipe

### Step 1 — Translate the user goal into a parameterized SELECT

Stay strictly inside the proven SQL surface AND the three tables above. Common patterns:

| User goal | Provable SQL shape |
|---|---|
| "Prove Ethereum block N exists, with its hash and transaction count" | `SELECT BLOCK_NUMBER, BLOCK_HASH, TRANSACTION_COUNT FROM ETHEREUM.BLOCKS WHERE BLOCK_NUMBER = $1` |
| "Prove the blocks in a range" | `SELECT BLOCK_NUMBER, BLOCK_HASH FROM ETHEREUM.BLOCKS WHERE BLOCK_NUMBER >= $1 AND BLOCK_NUMBER <= $2` |
| "Prove wallet X's ETH balance at indexed blocks" | `SELECT BLOCK_NUMBER, BALANCE FROM ETHEREUM.NATIVE_WALLETS WHERE WALLET_ADDRESS = $1` |
| "Prove the ownership transfers of contract X" | `SELECT BLOCK_NUMBER, PREVIOUS_OWNER, NEW_OWNER FROM ETHEREUM.ERC173_OWNERSHIP_TRANSFERRED WHERE CONTRACT_ADDRESS = $1` |
| "Count ownership transfers per block since block N" | `SELECT BLOCK_NUMBER, COUNT(*) AS N FROM ETHEREUM.ERC173_OWNERSHIP_TRANSFERRED WHERE BLOCK_NUMBER >= $1 GROUP BY BLOCK_NUMBER` |

Use `$1`, `$2`, ... placeholders so the rendered contract accepts the values at call time via `ParamsBuilder`. Address parameters are VARBINARY (`--param-types VARBINARY`). A VARBINARY parameter has not yet been run end to end on-chain, so pre-flight it with its concrete value first.

**Refuse and rewrite** any goal that needs:
- `COUNT`/`SUM` without `GROUP BY` (plans, then fails at the prover — project the rows, or group by one non-VARCHAR column)
- `DISTINCT` (not provable — can't dedup in SQL)
- `ORDER BY` (not provable — `LIMIT` alone IS provable for paginated reads)
- `AVG` / `MIN` / `MAX` (not provable — return the rows and compute client-side)
- `JOIN` (not provable — query each table separately, combine in app or Solidity callback)
- A `WHERE` on a DECIMAL or TIMESTAMP column
- Any column not in the table schema above, or any table outside the three that prove

### Step 2 — Generate the proof plan

Run `generate-chain-plan.mjs` with the SQL pieces and parameter types:

```bash
node examples/scripts/generate-chain-plan.mjs \
  --table ETHEREUM.BLOCKS \
  --predicate "BLOCK_NUMBER = \$1" \
  --param-types BIGINT \
  --projection "BLOCK_NUMBER, BLOCK_HASH, TRANSACTION_COUNT" \
  --name block-finality
```

The script:
- Reads the table's columns live from the chain catalog and refuses a table with no commitments (254018) or one of the eleven failing tables
- Validates referenced columns exist (refuses on typos)
- Validates the SQL stays inside the proven surface (refuses `ORDER BY`, `DISTINCT`, etc.)
- Calls `commitments_v1_evmProofPlan` on SXT chain RPC, gets a HyperKZG proof plan + chain-state attestation
- Writes the artifact to `examples/data/proof-plans/<name>.json` with `kind: "indexed"`, the embedded table schema, parameter types, and the hex proof plan

### Step 3 — Off-chain pre-flight (one query credit, definitive)

Before spending 100 SXT on the onchain call, prove the same SQL with a concrete value:

```bash
sxt verify --sql "SELECT BLOCK_NUMBER, BLOCK_HASH, TRANSACTION_COUNT FROM ETHEREUM.BLOCKS WHERE BLOCK_NUMBER = 22432845"
```

Returns the proven row (block 22432845, hash `0xad2747e9…a119f6`, 125 transactions; verified 2026-11-23) with a HyperKZG proof verified locally. **This is the gate** — a successful off-chain proof means the on-chain `query()` will fulfill. They share the same prover backend.

### Step 4 — Render + audit + deploy the consuming contract

Hand off to the contract pipeline. The renderer produces a Solidity contract that bakes in the proof plan and exposes a parameterized entry point:

```bash
cd examples/scripts
node render-onchain-query.mjs --plan ../data/proof-plans/block-finality.json --name BlockFinality --params
node audit-with-sxt.mjs ../contracts/sxt-onchain-query/src/BlockFinality/BlockFinality.sol
cd ../contracts/sxt-onchain-query && forge build && cd ../../scripts
node deploy-onchain-query.mjs
```

The `pre-deploy-audit` skill (slither + SXT cross-reference) reviews the rendered contract; the `deploy-contract` skill deploys to Base mainnet. Both work unchanged.

### Step 5 — Live onchain query

```bash
node query-onchain.mjs --args "22432845"
```

Submits `IQueryRouter.requestQuery` with the parameter values. The SXT executor reads the plan, queries `ETHEREUM.BLOCKS` against the committed snapshot, generates the HyperKZG proof, validates it onchain via the Base verifier in ~150K gas, and calls back into the contract. The callback emits the proven result event in the Base transaction logs.

Cost: 100 SXT + ~$0.50 ETH gas per query. ~6 seconds from submit to callback (3 Base blocks).

### Step 6 — Surface the result

Present a structured block including the BaseScan link and the on-chain verifier addresses so anyone can validate the proof independently:

```markdown
## L1 block proof — Ethereum block 22432845

Block hash:   0xad2747e9a8cef019cf769df14e0b43ef2755a1283cbcd0b98d5d7509d8a119f6
Transactions: 125   ← cryptographically proven from Ethereum mainnet
Verified at:  block timestamp on Base

## Proof verification

QueryRouter:        0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB (Base)
Onchain verifier:   0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518 (Base)
Proof receipt tx:   https://basescan.org/tx/<callback_tx>
Source table:       ETHEREUM.BLOCKS at SXT chain state 0x…
```

## When to refuse

- The user asks for data outside the three tables that prove (transactions, token and NFT transfers, BASE.* anything, contract logs). Counter-offer: publish your own CSV via `dataset-publish` if you have the data, or check later when SXT expands the committed list.
- The SQL needs `DISTINCT`, `ORDER BY`, `AVG`/`MIN`/`MAX`, `JOIN`, subqueries, `HAVING`, or `UNION`. Counter-offer: rewrite per the rules in `proof-of-sql-foundations`, or split into multiple proven queries combined in the contract callback.
- The user wants to demo without paying SXT — the off-chain pre-flight (step 3) spends one query credit and no SXT; do that and stop there rather than spending 100 SXT.

## Pairs with

- `proof-of-sql-foundations` — the proven SQL surface guardrail this skill defers to for refusal decisions.
- `dataset-publish` — alternative path when the user has off-chain data not in SXT's indexed catalog.
- `pre-deploy-audit` + `deploy-contract` — handle the Solidity contract from rendered source to live deploy.

## What this skill is not

- **Not a chain indexer.** SXT runs the indexer; we just query the committed result.
- **Not a tool to query arbitrary indexed tables.** Only the three tables above prove onchain today.
- **Not a real-time event listener.** Each `query()` call is a one-shot proof at a snapshot block. For continuous monitoring, poll on a schedule.

## References

- Validated surface (one live proof per table, 2026-11-19): `ETHEREUM.BLOCKS`, `ETHEREUM.NATIVE_WALLETS` and `ETHEREUM.ERC173_OWNERSHIP_TRANSFERRED` prove; eleven tables fail at execution; five large tables are unverified and three `PROXY_*` tables are empty.
- Authoritative SDK example listing the *intended* committed surface (forward-looking, not all live): https://github.com/spaceandtimefdn/sxt-proof-of-sql-sdk/blob/main/crates/sxt-proof-of-sql-sdk/examples/count-ethereum-core/main.rs
- SXT docs on indexed ZK-proven chain data: https://docs.spaceandtime.io/docs/indexed-ethereum-data-zk-proven
- Onchain query lifecycle reference: https://github.com/spaceandtimefdn/sxt-chain-examples/blob/main/tutorials/onchain_hello_world_query/README.md
- QueryRouter (Base + Ethereum): `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB`
- Onchain verifier (Base): `0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518`
