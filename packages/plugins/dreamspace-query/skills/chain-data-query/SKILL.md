---
name: chain-data-query
description: Query SXT-indexed Ethereum chain data with a Proof of SQL receipt — and consume the result inside a Solidity contract on Base via IQueryRouter.requestQuery. Use when the user wants to prove a wallet's onchain activity, verify a specific L1 transaction exists, confirm L1 block finality, or build any trust-minimized cross-chain primitive that depends on Ethereum history. Generates parameterized proof plans so one deployed contract serves any input. Pairs with proof-of-sql-foundations (the surface guardrail), pre-deploy-audit, and deploy-contract.
---

# Chain Data Query

## What this skill does

Generates a HyperKZG-provable SQL query against SXT's zk-committed indexed chain data, runs it through the off-chain prover for a free pre-flight, and produces the Solidity-ready proof plan that a Base mainnet contract consumes via `IQueryRouter.requestQuery`. The contract's callback receives the cryptographically verified result — no oracle, no bridge, no archive node in the loop.

This is the trust-minimizing counterpart to `dataset-publish`. Where `dataset-publish` puts the user's *own* data on chain and proves queries against it, `chain-data-query` proves queries against **data that's already on Ethereum mainnet** as committed history. The trust assumption collapses to "Ethereum itself."

## When to invoke

- The user wants to prove a wallet's onchain activity ("Vitalik has sent N transactions", "is this address an active L1 participant").
- The user mentions cross-chain receipt verification, bridge sanity checks, or L1→L2 trust-minimization.
- The user wants to query indexed Ethereum data with a proof receipt verifiable inside a Solidity contract.
- A downstream contract on Base needs to act on a fact about L1 (a block existed, a transaction was made, a wallet has history) without trusting an oracle or relayer.

Do **not** invoke this skill when:
- The user wants to query their own CSV — that's `dataset-publish` followed by `run-proven-query`.
- The user wants to query an arbitrary indexed table from `chain.spaceandtime.io` Studio that isn't in the zk-committed surface — see the next section. Refuse and explain the surface limit.

## ⚠️ Critical constraint — the zk-committed surface is narrow today

The SXT Studio catalog advertises ~22 indexed chain tables (`ETHEREUM.LOGS`, `BASE.TOKEN_ERC20_TRANSFERS`, `ETHEREUM.TOKEN_ERC721_TRANSFERS`, etc.). **Most of these are NOT yet zk-committed** and will fail with chain error `254018: "tables do not exist or have incomplete commitment coverage for all schemes"`.

**Validated empirically 2026-06-01, these are the ONLY tables this skill can use:**

| Table | Columns | Useful for |
|---|---|---|
| `ETHEREUM.BLOCKS` | `BLOCK_NUMBER` (BIGINT) | L1 block finality proofs |
| `ETHEREUM.TRANSACTIONS` | `TIME_STAMP`, `BLOCK_NUMBER`, `TRANSACTION_HASH`, `TRANSACTION_INDEX`, `TRANSACTION_FEE`, `FROM_ADDRESS`, `TO_ADDRESS` | Wallet activity, transaction receipts, gas history, contract call counts |

Need to query NFT transfers, ERC-20 events, BASE.* data, or anything else? **Refuse and explain**: those tables aren't zk-committed today. Counter-offer: publish your own CSV via `dataset-publish` if you have the data, or wait for SXT to expand the committed surface.

## Inputs

Required:

- **User goal in plain English** — what they want to prove ("does this wallet have L1 activity", "verify this Ethereum transaction exists", "prove block N was finalized").
- **`SXT_API_KEY`** in env — for the off-chain pre-flight via `/v1/zkquery`.
- **`PRIVATE_KEY`** in env — for the onchain deploy + `query()` call (a Base wallet funded with ~$0.50 ETH + 100 SXT ERC-20 per query).

Conditionally needed:

- **Parameter values** at query time (a wallet address, block number, transaction hash) — supplied at `query-onchain.mjs` invocation, not at plan generation. The plan is parameterized so one deployment serves arbitrary inputs.

## Concrete execution recipe

### Step 1 — Translate the user goal into a parameterized SELECT

Stay strictly inside the proven SQL surface AND the zk-committed table list. Common patterns:

| User goal | Provable SQL shape |
|---|---|
| "Prove wallet X has sent transactions on Ethereum" | `SELECT COUNT(*) FROM ETHEREUM.TRANSACTIONS WHERE FROM_ADDRESS = $1` |
| "Prove wallet X has activity since block N" | `SELECT COUNT(*) FROM ETHEREUM.TRANSACTIONS WHERE FROM_ADDRESS = $1 AND BLOCK_NUMBER >= $2` |
| "Prove this Ethereum transaction exists" | `SELECT COUNT(*) FROM ETHEREUM.TRANSACTIONS WHERE TRANSACTION_HASH = $1` |
| "Prove Ethereum block N was finalized" | `SELECT COUNT(*) FROM ETHEREUM.BLOCKS WHERE BLOCK_NUMBER = $1` |
| "Sum of gas fees this wallet paid" | `SELECT SUM(TRANSACTION_FEE) FROM ETHEREUM.TRANSACTIONS WHERE FROM_ADDRESS = $1` |
| "How many transactions this wallet sent to address Y" | `SELECT COUNT(*) FROM ETHEREUM.TRANSACTIONS WHERE FROM_ADDRESS = $1 AND TO_ADDRESS = $2` |

Use `$1`, `$2`, ... placeholders so the rendered contract accepts the values at call time via `ParamsBuilder`.

**Refuse and rewrite** any goal that needs:
- `DISTINCT` (not provable — there's no "unique holders" table; can't dedup in SQL)
- `ORDER BY` (not provable — `LIMIT` alone IS provable for paginated reads)
- `AVG` / `MIN` / `MAX` (not provable — return `SUM` + `COUNT`, compute client-side)
- `JOIN` (not provable — query each table separately, combine in app or Solidity callback)
- Any column not in the table schema above
- Any table not in the zk-committed list

### Step 2 — Generate the proof plan

Run `generate-chain-plan.mjs` with the SQL pieces and parameter types:

```bash
node examples/scripts/generate-chain-plan.mjs \
  --table ETHEREUM.TRANSACTIONS \
  --predicate "FROM_ADDRESS = \$1 AND BLOCK_NUMBER >= \$2" \
  --projection "COUNT(*)" \
  --param-types VARCHAR,BIGINT \
  --name wallet-activity
```

The script:
- Validates the table is in the zk-committed surface (refuses otherwise)
- Validates referenced columns exist in the schema (refuses on typos)
- Validates the SQL stays inside the proven surface (refuses `ORDER BY`, `DISTINCT`, etc.)
- Calls `commitments_v1_evmProofPlan` on SXT chain RPC, gets a HyperKZG proof plan + chain-state attestation
- Writes the artifact to `examples/data/proof-plans/<name>.json` with `kind: "indexed"`, the embedded table schema, parameter types, and the hex proof plan

### Step 3 — Off-chain pre-flight (free, definitive)

Before spending 100 SXT on the onchain call, verify the proof plan actually fulfills:

```bash
SXT_PLAN=./examples/data/proof-plans/wallet-activity.json \
node examples/scripts/verify-stakers.mjs \
  --params "0xd8da6bf26964af9d7eed9e03e53415d37aa96045,21000000"
```

Returns the proven result (`{N: 47}`) + a HyperKZG proof verified locally in ~1 second. **This is the gate** — a successful off-chain proof means the on-chain `query()` is mathematically guaranteed to fulfill. They share the same prover backend.

### Step 4 — Render + audit + deploy the consuming contract

Hand off to the contract pipeline. The renderer produces a Solidity contract that bakes in the proof plan and exposes a parameterized entry point:

```bash
node render-onchain-query.mjs --plan ./examples/data/proof-plans/wallet-activity.json --name WalletActivityProver --params
node audit-with-sxt.mjs ./examples/contracts/sxt-onchain-query/src/WalletActivityProver/WalletActivityProver.sol
cd ../contracts/sxt-onchain-query && forge build && cd ../../scripts
node deploy-onchain-query.mjs
```

The `pre-deploy-audit` skill (slither + SXT cross-reference) reviews the rendered contract; the `deploy-contract` skill deploys to Base mainnet. Both work unchanged.

### Step 5 — Live onchain query

```bash
node query-onchain.mjs --wallet 0xd8da... --from-block 21000000
```

Submits `IQueryRouter.requestQuery` with the parameter values. SXT executor reads the plan, queries `ETHEREUM.TRANSACTIONS` against the committed snapshot, generates the HyperKZG proof, validates onchain via the Base verifier in ~150K gas, calls back into the contract. Callback emits the proven result event in the Base transaction logs.

Cost: 100 SXT + ~$0.50 ETH gas per query. ~6 seconds from submit to callback (3 Base blocks).

### Step 6 — Surface the result

Present a structured block including the BaseScan link and the on-chain verifier addresses so anyone can validate the proof independently:

```markdown
## L1 activity proof — wallet 0xd8da...96045 (Vitalik)

Window:       blocks 21000000 → now
L1 tx count:  47   ← cryptographically proven from Ethereum mainnet
Verified at:  block timestamp on Base

## Proof verification

QueryRouter:        0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB (Base)
Onchain verifier:   0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518 (Base)
Proof receipt tx:   https://basescan.org/tx/<callback_tx>
Source table:       ETHEREUM.TRANSACTIONS at SXT chain state 0xba1f...
```

## When to refuse

- The user asks for data outside the zk-committed surface (NFT transfers, BASE.* anything, contract logs). Counter-offer: publish your own CSV via `dataset-publish` if you have the data, or check later when SXT expands the committed list.
- The SQL needs `DISTINCT`, `ORDER BY`, `AVG`/`MIN`/`MAX`, `JOIN`, subqueries, `HAVING`, or `UNION`. Counter-offer: rewrite per the rules in `proof-of-sql-foundations`, or split into multiple proven queries combined in the contract callback.
- The user wants to demo without paying SXT — the off-chain pre-flight (step 3) is free; do that and stop there rather than spending 100 SXT.

## Pairs with

- `proof-of-sql-foundations` — the proven SQL surface guardrail this skill defers to for refusal decisions.
- `dataset-publish` — alternative path when the user has off-chain data not in SXT's indexed catalog.
- `pre-deploy-audit` + `deploy-contract` — handle the Solidity contract from rendered source to live deploy.

## What this skill is not

- **Not a chain indexer.** SXT runs the indexer; we just query the committed result.
- **Not a tool to query arbitrary indexed tables.** Only the zk-committed subset works onchain today.
- **Not a real-time event listener.** Each `query()` call is a one-shot proof at a snapshot block. For continuous monitoring, poll on a schedule.

## References

- Validated zk-committed surface (empirical, this repo's tests): only `ETHEREUM.BLOCKS` and `ETHEREUM.TRANSACTIONS` today.
- Authoritative SDK example listing the *intended* committed surface (forward-looking, not all live): https://github.com/spaceandtimefdn/sxt-proof-of-sql-sdk/blob/main/crates/sxt-proof-of-sql-sdk/examples/count-ethereum-core/main.rs
- SXT docs on indexed ZK-proven chain data: https://docs.spaceandtime.io/docs/indexed-ethereum-data-zk-proven
- Onchain query lifecycle reference: https://github.com/spaceandtimefdn/sxt-chain-examples/blob/main/tutorials/onchain_hello_world_query/README.md
- QueryRouter (Base + Ethereum): `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB`
- Onchain verifier (Base): `0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518`
