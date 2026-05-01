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

This skill keeps you inside the surface that can actually carry a proof. Anything outside that surface runs unproven against SXT's analytics endpoint — useful for exploration, not for anything that needs cryptographic guarantees.

## The proven SQL surface (allowed)

When the user wants a verifiable result, every clause and operator must come from this list:

- **Statements**: `SELECT … WHERE`, `GROUP BY`, `JOIN` (single chain only — see Hard limits)
- **Comparison**: `=`, `>=`, `<=`, `>`, `<`
- **Logical**: `AND`, `OR`, `NOT`
- **Arithmetic**: `+`, `-`, `*`
- **Aggregates**: `SUM`, `COUNT`
- **Column types**: `BOOLEAN`, `BIGINT`, `VARCHAR`, `DECIMAL75`, `TIMESTAMP`

## Outside the proven surface (refuse)

Do **not** generate a verified query that uses any of the following. If the user wants a proof and asks for one of these, refuse with the reason:

- `ORDER BY`, `LIMIT`, `DISTINCT`
- `HAVING`, subqueries, CTEs, window functions (`ROW_NUMBER`, `RANK`)
- `UNION`, `EXCEPT`, `INTERSECT`
- Division (`/`), `AVG`, `MIN`, `MAX`
- `INSERT`, `UPDATE`, `DELETE` — Proof of SQL is SELECT-only
- Cross-chain JOINs — joining `ETHEREUM.*` with `POLYGON.*` (or any two chain schemas) is not supported in the proven path

When refusing, offer the user one of two paths:

1. **Rewrite to stay inside the proven surface.** Common rewrites:
   - `ORDER BY x DESC LIMIT 10` → add a `WHERE` predicate that bounds the set, then sort client-side.
   - `AVG(x)` → return `SUM(x)` and `COUNT(*)`, divide client-side.
   - `MIN/MAX` → return the full filtered set within row caps, take the min/max client-side.
2. **Run unproven.** Tell the user the query will run on SXT's analytics endpoint without a proof, and confirm they're OK with it before continuing.

## Hard limits

- **Row cap**: 10,000 rows per query result.
- **Latency**: proof generation adds 250 ms – 2 s depending on query and table size.
- **Smart contract indexing supported on**: chains where SXT's indexer can register a deployed contract for event/state tracking. Check chain.spaceandtime.io for the current list of supported chains for indexing.
- **Onchain verifier deployed on**: Ethereum mainnet, Base mainnet.

## Table sources you can query

Space and Time exposes two kinds of tables to the agent:

1. **Indexed smart contract tables** — once a user registers a target contract with SXT for event indexing (via the "Index Smart Contracts" tutorial on chain.spaceandtime.io), its events and state become queryable as a table the user names. Schema/table naming is set when the user registers the contract.
2. **User-published tables** — anything the user uploads via the `dreamspace-data:dataset-publish` skill becomes a queryable table under a schema the user chooses (e.g., `MY_AUDIT.KNOWN_EXPLOITS`).

Use UPPERCASE schema notation when writing queries: `<SCHEMA>.<TABLE>`.

Do **not** assume pre-built core-chain tables (e.g., a global `ETHEREUM.TRANSACTIONS` table) are available. If the user wants to query chain data, they first need to register the relevant contract for indexing or publish their own dataset. Confirm with the user which tables they have access to before generating SQL.

Hit the SXT Discovery API to enumerate what's queryable for the user's account before writing any query you're not certain about.

## When the user asks for a verified query

Follow this checklist in order:

1. Confirm the user wants a proof. If unsure, ask.
2. Walk every clause and operator against the proven surface above.
3. If the query is outside the surface, refuse and offer the rewrite or the unproven fallback.
4. Otherwise, generate the SQL.
5. **Submit** via one of two paths:
   - **Future DreamSpace SDK** (proposed, not yet shipped): `await query.sql(sql, { proof: true })`
   - **Public SXT REST API** (works today on testnet): `POST https://api.makeinfinite.dev/v2/sql` with body `{ "sqlText": "...", "proveExecution": true }` and an API key in the auth header.
6. Verify the proof receipt returned alongside the result before relying on the data.

## Onchain consumption

When a smart contract needs to consume the proof, route through these contracts (verified against docs.spaceandtime.io):

- **QueryRouter** (Ethereum + Base mainnet, same address on both): `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB`
- **Onchain Verifier** (Ethereum mainnet): `0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9`
- **Onchain Verifier** (Base mainnet): `0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518`

Re-verify these addresses against `https://docs.spaceandtime.io/docs/what-is-space-and-time-quick-intro` before deployment — addresses can change with redeploys.

## References

- Space and Time docs hub: https://docs.spaceandtime.io/docs
- Quick intro with current onchain addresses: https://docs.spaceandtime.io/docs/what-is-space-and-time-quick-intro
- Proof of SQL prover repo (Rust): https://github.com/spaceandtimefdn/sxt-proof-of-sql
- Wallet-based onboarding for end users: https://chain.spaceandtime.io
