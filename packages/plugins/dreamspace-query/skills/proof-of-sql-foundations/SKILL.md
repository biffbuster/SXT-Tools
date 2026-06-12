---
name: proof-of-sql-foundations
description: Verifiable SQL on Space and Time. Use when the user mentions "Proof of SQL", "verified query", "ZK-proven analytics", or asks to query indexed blockchain data with cryptographic guarantees. Refuses queries that fall outside the proven SQL surface and offers a rewrite or unproven fallback.
---

# Proof of SQL Foundations

## What Proof of SQL guarantees

Space and Time's Proof of SQL is a ZK-SNARK system that cryptographically proves two things at once:

1. The underlying table data has not been tampered with.
2. The SQL query was executed correctly against that data.

The proof verifies in roughly 7 ms locally or roughly 150,000 gas on the EVM via the Onchain Verifier. This is what makes it usable as an oracle for smart contracts.

This skill keeps you inside the surface that can actually carry a proof. Anything outside that surface runs unproven against SXT's analytics endpoint. Useful for exploration, not for anything that needs cryptographic guarantees.

## The proven SQL surface (allowed)

When the user wants a verifiable result, every clause and operator must come from this list. Verified against the [Proof of SQL syntax spec](https://github.com/spaceandtimefdn/sxt-proof-of-sql/blob/main/docs/SQLSyntaxSpecification.md) (re-checked 2026-06-10 — this list matches the spec exactly).

- **Statements**: `SELECT … WHERE`, `GROUP BY`, `LIMIT`, `OFFSET`, `UNION ALL`
- **JOIN**: only **inner joins on a single column**. No other join types or multi-column joins.
- **Comparison**: `=`, `!=`, `>=`, `<=`, `>`, `<` (decimal inequality only up to 38 digits)
- **Logical**: `AND`, `OR`, `NOT`
- **Arithmetic**: `+`, `-`, `*`
- **Aggregates**: `SUM`, `COUNT` — ⚠ empirically failing at the prover as of 2026-06-10 (`failed to deserialize prover response json: … expected struct AttestedCommitments` via `/v1/zkquery`, all working SDK versions). They are *in* the documented surface but don't execute today; prefer point lookups/scans and re-test with `node verify-table.mjs` before promising aggregates.
- **Column types**: `Boolean`, `Uint8`, `TinyInt`, `SmallInt`, `Int`, `BigInt`, `Int128`, `Decimal75`, `Varchar`, `Varbinary`, `Timestamp`

The identifier `count` is reserved and cannot be used as a column alias.

## Outside the proven surface (refuse)

Do **not** generate a verified query that uses any of the following. If the user wants a proof and asks for one of these, refuse with the reason:

- `ORDER BY`, `DISTINCT`, `HAVING`
- Subqueries, CTEs, window functions (`ROW_NUMBER`, `RANK`)
- Plain `UNION`, `EXCEPT`, `INTERSECT` (only `UNION ALL` is in the proven surface)
- Outer / left / right / full joins, multi-column joins
- Division (`/`), `AVG`, `MIN`, `MAX`
- String/binary operations beyond equality / inequality
- `INSERT`, `UPDATE`, `DELETE`. Proof of SQL is SELECT-only.

When refusing, offer the user one of two paths:

1. **Rewrite to stay inside the proven surface.** Common rewrites:
   - `ORDER BY x DESC LIMIT 10` → add a `WHERE` predicate that bounds the set, then sort client-side.
   - `AVG(x)` → return `SUM(x)` and `COUNT(*)`, divide client-side.
   - `MIN/MAX` → return the full filtered set within row caps, take the min/max client-side.
2. **Run unproven.** Tell the user the query will run on SXT's analytics endpoint without a proof, and confirm they're OK with it before continuing.

## Hard limits

- **Latency**: proof generation typically adds sub-second to a few seconds depending on query and table size; benchmarks show sub-second on 1M+ rows.
- **Decimal precision**: full Decimal75 supports 75 digits, but inequality (`<`, `>`, `<=`, `>=`) is limited to 38 digits.
- **Smart contract indexing supported on**: chains where SXT's indexer can register a deployed contract for event/state tracking. Check chain.spaceandtime.io for the current list of supported chains for indexing.
- **Onchain verifier deployed on**: Ethereum mainnet, Base mainnet.

For result-set row caps, check the response from the analytics endpoint or the Studio Workbench. Caps may be per-API-tier rather than a fixed number, and have changed over time.

## Table sources you can query

Space and Time exposes two kinds of tables to the agent:

1. **Indexed smart contract tables.** Once a user registers a target contract with SXT for event indexing (via the "Index Smart Contracts" tutorial on chain.spaceandtime.io), its events and state become queryable as a table the user names. Schema and table naming is set when the user registers the contract.
2. **User-published tables.** Anything the user uploads via the `dreamspace-data:dataset-publish` skill becomes a queryable table under a schema the user chooses (e.g., `MY_AUDIT.KNOWN_EXPLOITS`).

Use UPPERCASE schema notation when writing queries: `<SCHEMA>.<TABLE>`.

Pre-built core-chain tables DO exist on the zk-proven surface — but the empirically validated set is narrow: `ETHEREUM.BLOCKS` and `ETHEREUM.TRANSACTIONS` round-trip the prover end-to-end today (others in the catalog fail with `254018 incomplete commitment coverage`). Route chain-data questions to the `chain-data-query` skill, which owns that validated list. For anything else, the user registers a contract for indexing (`index-contract`) or publishes their own dataset (`dataset-publish`).

Hit the SXT Discovery API to enumerate what's queryable for the user's account before writing any query you're not certain about.

## When the user asks for a verified query

Follow this checklist in order:

1. Confirm the user wants a proof. If unsure, ask.
2. Walk every clause and operator against the proven surface above.
3. If the query is outside the surface, refuse and offer the rewrite or the unproven fallback.
4. Otherwise, generate the SQL.
5. **Submit** via the SXT REST API at `https://api.makeinfinite.dev/v1/zkquery`. Auth requires exchanging your `SXT_API_KEY` for a 25-minute JWT at `https://proxy.api.makeinfinite.dev/auth/apikey` first. The raw API key is NOT a Bearer token. The request body uses `sqlText` plus `sourceNetwork: "MAINNET"` plus `commitmentScheme: "HYPER_KZG"` plus a recent attested `blockHash`. See `dreamspace-query:run-proven-query` for the full execution flow with submit, poll, and fetch.
6. Verify the proof receipt returned alongside the result before relying on the data.

## Onchain consumption

When a smart contract needs to consume the proof, route through these contracts (verified against docs.spaceandtime.io):

- **QueryRouter** (Ethereum + Base mainnet, same address on both): `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB`
- **Onchain Verifier** (Ethereum mainnet): `0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9`
- **Onchain Verifier** (Base mainnet): `0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518`

Re-verify these addresses against `https://docs.spaceandtime.io/docs/what-is-space-and-time-quick-intro` before deployment. Addresses can change with redeploys.

## References

- Space and Time docs hub: https://docs.spaceandtime.io/docs
- Quick intro with current onchain addresses: https://docs.spaceandtime.io/docs/what-is-space-and-time-quick-intro
- Proof of SQL prover repo (Rust): https://github.com/spaceandtimefdn/sxt-proof-of-sql
- Wallet-based onboarding for end users: https://chain.spaceandtime.io
