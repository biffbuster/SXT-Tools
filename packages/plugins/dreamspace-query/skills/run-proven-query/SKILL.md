---
name: run-proven-query
description: >-
  Translate a user's natural-language question about a published Space and Time
  table into a Proof of SQL query, execute it via the SXT REST API with
  proveExecution=true, and surface the proof receipt for onchain verification.
  Use when the user has already published a table (or knows the table reference)
  and asks to verify, prove, query with proof, check membership, or run a SELECT
  against it. Pairs with proof-of-sql-foundations (the surface guardrail) and
  dataset-publish (which produces the table this skill queries).
---

# Run Proven Query

## What this skill does

Takes a published SXT table reference plus a user goal in natural language, and:

1. **Discovers the table schema** — column names, types — by inspecting the user's local `schema.json` or the publish output.
2. **Translates the goal into provable SQL** — using only the surface defined in `dreamspace-query:proof-of-sql-foundations`. Refuses or rewrites if the goal can't be expressed in proven mode.
3. **Submits the query** to the SXT zkQuery REST API (`/v1/zkquery` family) using a JWT obtained by exchanging the user's `SXT_API_KEY`, then polls for the proof and fetches the result.
4. **Surfaces the proof receipt** alongside the result, with the addresses of the SxT Onchain Verifier so the user can validate the receipt onchain.

This is the **bridge** between the publish loop (`dataset-publish` writes the table) and the audit loop (`pre-deploy-audit` consumes proven results). Without this skill, an agent would know *how to make a query provable* (foundations) and *how to publish* (publish), but not how to actually run a verified query end-to-end against a user's specific dataset.

## When to invoke

- The user mentions a table reference like `MY_AUDIT_<ADDR>.STAKERS` and asks to query, prove, verify, or check membership in it.
- The user just published a dataset via `dataset-publish` and asks "now what" / "how do I prove rows are in it?" / "can a smart contract use this?".
- The user wants to write a custom verify script for their dataset — this skill produces the canonical script shape.
- A downstream skill (e.g., a custom audit workflow) needs to surface verifiable evidence from the user's tables.

Do **not** invoke this skill when the user's question can't be expressed in the proven SQL surface. In that case, defer to `proof-of-sql-foundations` to refuse or rewrite the request first.

## Inputs

Required:

- **Table reference**: full `<NAMESPACE>.<TABLE>` as it landed onchain — usually the form `MY_PROJECT_<UPPERCASE_HEX_ADDRESS>.MY_TABLE`. Get this from `dataset-publish` output, the chain.spaceandtime.io UI under "My Tables", or the `commitments.commitmentStorageMap` storage on the chain.
- **User goal in plain English** — what they want to prove, e.g., "is wallet X in the table", "how many rows", "sum of amounts where status = active".
- **`SXT_API_KEY`** in env — REST API key, separate from the publish wallet's private key. Get from chain.spaceandtime.io → Account → API keys.

Optional:

- **`schema.json`** — if the user has the local schema file from publishing, use it instead of an API discovery call (saves a round trip).
- **`SXT_API_BASE`** — defaults to `https://api.makeinfinite.dev`. Override if SXT moves the endpoint.

## Concrete execution recipe

### Step 1 — Establish the table schema

Without the schema, you can't translate the goal into valid SQL. Two paths in priority order:

1. **Local `schema.json`** — if the user has one (typical right after `dataset-publish`), read it. Cheapest.
2. **Ask the user** — if no local schema exists, ask the user to paste the schema or the publish output that includes the column list. The proven-query REST endpoint expects a fully-formed SQL string and won't help with discovery.

If the table is in the dreamspace.xyz Studio under the user's account, the user can also see column names and types in the Studio table browser.

### Step 2 — Translate the goal into provable SQL

Walk the user's goal against the proven surface from `proof-of-sql-foundations`:

| User goal pattern | Provable SQL shape |
|---|---|
| "Is X in the table?" | `SELECT <pk> FROM <t> WHERE <pk> = '<x>'` (membership) |
| "How many rows?" | `SELECT COUNT(*) AS N FROM <t>` (cardinality) |
| "How many match condition Y?" | `SELECT COUNT(*) AS N FROM <t> WHERE <y>` (filtered count) |
| "Sum / total of column Z (for rows matching Y)?" | `SELECT SUM(<z>) AS TOTAL FROM <t> [WHERE <y>]` |
| "What rows match condition Y?" | `SELECT <cols> FROM <t> WHERE <y>` (point or range) |
| "Group rows by column G and count" | `SELECT <g>, COUNT(*) AS N FROM <t> GROUP BY <g>` |
| "Join with another published table on key K" | `SELECT … FROM <t1> JOIN <t2> ON <t1>.<k> = <t2>.<k> WHERE …` (single-chain only) |

**Refuse and offer rewrite for any goal that needs:**

- Top-N / sort: `ORDER BY` + `LIMIT` are not provable. Counter-offer: bound the set with `WHERE`, return all matches, sort client-side.
- Averages, mins, maxes: `AVG`/`MIN`/`MAX` not provable. Counter-offer: return `SUM` + `COUNT` (compute average client-side) or full filtered set within the 10k row cap.
- Distinct counts: `DISTINCT` not provable. Counter-offer: ask the user if they can pre-deduplicate at publish time, or run unproven if exploratory.
- Subqueries / CTEs / window functions / `UNION` / `HAVING` / division: not on the proven surface. Counter-offer: split into multiple proven queries that compose client-side.
- Cross-chain joins: not provable. Counter-offer: query each chain's table separately, join in application code.

### Step 3 — Execute via REST API with proof

The endpoint is `/v1/zkquery` on `api.makeinfinite.dev`. **The API key is NOT a Bearer token** — first exchange it for a 25-minute JWT at `/auth/apikey`, then use the JWT as Bearer for everything else. The submission returns a `queryId`; poll status until `done`, then fetch the proven result.

```javascript
// 1) Exchange API key → JWT (25-min access token).
const auth = await fetch('https://proxy.api.makeinfinite.dev/auth/apikey', {
  method: 'POST',
  headers: { apikey: process.env.SXT_API_KEY, 'content-type': 'application/json' },
});
const { accessToken } = await auth.json();

// 2) Get the best attested SXT chain block hash (binds proof to chain state).
const att = await fetch('https://rpc.mainnet.sxt.network/', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    id: 1, jsonrpc: '2.0',
    method: 'attestation_v1_bestRecentAttestations', params: null,
  }),
});
const blockHash = (await att.json()).result.attestationsFor;

// 3) Submit. sourceNetwork MUST be the literal string "MAINNET"
//    (uppercase, case-sensitive — the only accepted enum value, even for
//    user-published Community-tier tables).
const submit = await fetch('https://api.makeinfinite.dev/v1/zkquery', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    sqlText,
    sourceNetwork: 'MAINNET',
    commitmentScheme: 'HYPER_KZG',
    blockHash,
    timeout: null,
  }),
});
const { queryId } = await submit.json();   // 202 Accepted on success

// 4) Poll status (typical: 1–3 polls; cap at ~30 to avoid runaway).
let status;
for (let i = 0; i < 30; i++) {
  const r = await fetch(`https://api.makeinfinite.dev/v1/zkquery/${queryId}/status`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  ({ status } = await r.json());
  if (status === 'done' || status === 'failed' || status === 'canceled') break;
  await new Promise(r => setTimeout(r, 1000));
}
if (status !== 'done') throw new Error(`zkQuery did not complete: ${status}`);

// 5) Fetch results + proof.
const r = await fetch(`https://api.makeinfinite.dev/v1/zkquery/${queryId}/results`, {
  headers: { authorization: `Bearer ${accessToken}` },
});
const { success, results, proof, commitments } = await r.json();
```

Response field reference:

| Field | Meaning |
|---|---|
| `success` | `true` if the prover finished and the proof verifies. |
| `results` | Hex-encoded result rows (same encoding the on-chain executor delivers). |
| `proof` | Hex-encoded HyperKZG proof bytes. Verifiable in WASM via `sxt-proof-of-sql-sdk` or onchain via the verifier addresses below. |
| `commitments` | Table commitment + merkle proof tying the result to chain state at `blockHash`. |
| `error` | Set when `success: false` — surface verbatim to the user. |

**Common 4xx bodies and what they mean:**

| Status | `detail` substring | Cause |
|---|---|---|
| 401 | `Invalid JWT` | You sent the raw `SXT_API_KEY` as Bearer, or your JWT expired (25-min lifetime). Re-run step 1. |
| 422 | `does not exist in source network MAINNET` | The table didn't get promoted into the dreamspace MAINNET catalog. Most often caused by a `PRIMARY KEY` clause in the original `CREATE TABLE` — see `dreamspace-data:dataset-publish`. |
| 400 | `source network 'X' is not supported` | You passed something other than the literal `"MAINNET"`. There is no other accepted enum value, even for user-uploaded Managed tables. |
| 422 | other | Surface the body verbatim — the prover names the offending field. |

If you see the 422 "does not exist in source network MAINNET" error against a table you know was published successfully, run the off-chain pre-flight in `examples/scripts/verify-stakers.mjs` for a clean reproduction; the resolution is almost always to republish the table without a PRIMARY KEY clause in the DDL.

### Step 4 — Present the result + receipt

Format the response as a structured block, not a prose sentence:

```markdown
## Query result

SQL:    SELECT COUNT(*) AS N FROM MY_AUDIT_<ADDR>.STAKERS
Rows:   1
Result: { N: 2062 }

## Proof of execution

Receipt:    0x4f3a...8b21 (1,247 bytes)
Issued by:  https://api.makeinfinite.dev (Space and Time mainnet)
Verifiable: locally in ~7ms via the SxT SDK,
            or onchain in ~150K gas via:
              Ethereum: 0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9
              Base:     0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518
              QueryRouter: 0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB
```

Always print the proof bytes (or a clear "no proof returned" warning with the response keys). The proof is the *whole point* of the `/v1/zkquery` flow — without it the query is no different from any unverified analytics call.

## When to refuse

- **No `SXT_API_KEY` in env**: don't accept a key in chat. Ask the user to add it to their `.env` file.
- **Goal can't be expressed in proven SQL**: refuse, cite the rule from `proof-of-sql-foundations`, offer the rewrite or unproven fallback. Don't silently strip the unprovable clause and submit anyway.
- **Result set would exceed 10,000 rows**: SXT caps proven results at 10k. Add a tighter `WHERE` to bound the set, or fall back to unproven.
- **User asks for proof against a table they haven't confirmed exists**: run a discovery query first or have them confirm via chain.spaceandtime.io UI. A "proven" query against a non-existent table just returns an error; don't waste the user's time.

## Worked example end-to-end

User: *"I just published `MY_AUDIT_5731EC...2552.STAKERS`. Prove that wallet `0x6de6e9...` is in there and that the table has 2062 rows total."*

Agent response:

```
Two proven queries coming up. Both stay inside the Proof of SQL surface
(membership lookup + COUNT). Submitting via api.makeinfinite.dev with
proveExecution: true.

Query 1 (membership):
  SELECT STAKER FROM MY_AUDIT_5731EC...2552.STAKERS
  WHERE STAKER = '0x6de6e901bbefd26a9888798a25e4a49309d04ca9'

Query 2 (cardinality):
  SELECT COUNT(*) AS N FROM MY_AUDIT_5731EC...2552.STAKERS
```

Then run both, surface the rows + receipt for each, and hand the user the verifier addresses so they can validate either receipt onchain. If the user wants this as a reusable script, write `verify-<table>.mjs` next to their CSV with the same structure as `examples/scripts/verify-stakers.mjs` in this repo.

## What this skill is not

- **Not a SQL engine.** It generates SQL and forwards to SXT — it doesn't execute or optimize anything itself.
- **Not a proof verifier.** It surfaces the receipt; the user (or their smart contract) verifies it via the SDK or onchain verifier addresses.
- **Not a data discovery tool.** It assumes the user knows their table reference. For browse-the-tables workflows, use the chain.spaceandtime.io UI.

## Pairs with

- `dreamspace-query:proof-of-sql-foundations` — the constraint layer; this skill defers to it for surface decisions.
- `dreamspace-data:dataset-publish` — produces the table this skill queries.
- `dreamspace-contracts:pre-deploy-audit` — calls this skill (or its pattern) to cross-reference contracts against published reference tables.

## References

- SXT REST API root: `https://api.makeinfinite.dev` — the SDK appends `/v1/zkquery` (submit), `/v1/zkquery/{id}/status` (poll), `/v1/zkquery/{id}/results` (fetch).
- Auth exchange endpoint: `https://proxy.api.makeinfinite.dev/auth/apikey` — POST with header `apikey: <your key>`. Returns 25-min access token + 30-min refresh token.
- Proven SQL surface and refusal rules: see `dreamspace-query:proof-of-sql-foundations`.
- Onchain verifier addresses (re-verify before deployment): https://docs.spaceandtime.io/docs/what-is-space-and-time-quick-intro
  - Ethereum mainnet: `0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9`
  - Base mainnet: `0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518`
  - QueryRouter (both networks): `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB`
- Worked-out script: `examples/scripts/verify-stakers.mjs` in this repo — copy and adapt the queries for any table. Set `SXT_TABLE` and `SAMPLE_STAKER` env vars to point at your own data.
- Reference SDK source: `node_modules/sxt-proof-of-sql-sdk/index_tail.js` (in `examples/scripts/`) — the `queryAndVerify` method is the SDK's canonical implementation of the same flow this skill documents.
