---
name: dataset-publish
description: Publish a dataset to Space and Time as a chain-secured table that supports Proof of SQL queries. Use when the user wants to upload a CSV / Parquet / JSON file to SXT, create a custom queryable table, share reference data (e.g., known-exploit signatures, allowlists, off-chain metadata) with downstream skills, or stand up data that the pre-deploy-audit skill can cross-reference against. Walks the user through both the no-code chain.spaceandtime.io flow and the programmatic Substrate RPC flow with Apache Arrow IPC encoding.
---

# Dataset Publish

## What this skill does

Publishes a user-supplied dataset as a chain-secured table on Space and Time. The table is committed onchain at creation time, so subsequent `SELECT` queries against it can carry a Proof of SQL receipt — you can prove exactly what data was queried and that it hasn't been tampered with since publish.

This skill is the upstream half of the DreamSpace audit loop. The downstream skill (`pre-deploy-audit` in `dreamspace-contracts`) consumes whatever you publish here as a reference table for cross-references against an indexed target contract.

## When to invoke

- The user wants to upload a CSV, Parquet, or JSON file to SXT.
- The user mentions "publish a dataset", "create a SXT table", "share reference data with my agent".
- The user wants to make a known-exploit signature list, allowlist, denylist, or any off-chain reference set queryable with proof.
- A downstream skill (typically `pre-deploy-audit`) needs reference data that doesn't exist as a public SXT table yet.
- The user wants their own off-chain data joinable with onchain indexed data inside one Proof of SQL query.

## Inputs

You need:

- **Data file path or inline data** — CSV, Parquet, or a JSON array of objects.
- **Namespace prefix + table name** — both `UPPERCASE_SNAKE_CASE`, separated by a dot (e.g. `<YOUR_PROJECT>.VALIDATORS`). The prefix is **user-chosen** — it should scope the user's project (org name, app name, etc.) and is **NOT** something the skill picks unilaterally. See the "Pick a namespace prefix" decision flow below. The chain auto-appends the publishing wallet's uppercase hex address to the prefix, so `MY_PROJECT.VALIDATORS` becomes `MY_PROJECT_<40_HEX>.VALIDATORS` onchain — different forked users with different wallets never collide even if they pick the same prefix.
- **Column types** — one of `BOOLEAN`, `BIGINT`, `VARCHAR`, `DECIMAL75`, `TIMESTAMP` (plus `BINARY` and the smaller int variants). Anything outside this list cannot carry a Proof of SQL query (see the `proof-of-sql-foundations` skill).
- **NEVER emit a `PRIMARY KEY` clause.** SXT chain accepts PK-bearing DDL and rows ingest, but the dreamspace MAINNET indexer **silently** skips promoting the table into its catalog. Off-chain `/v1/zkquery` then returns `422 "does not exist in source network MAINNET"`, and the on-chain executor silently drops `query()` calls until the 1-hour timeout (100 SXT locked). The canonical SXT `create_hello_world_table` tutorial omits PK entirely; Proof of SQL determinism is satisfied by `NOT NULL` alone. Verified failure mode that cost 200 SXT before being traced.
- **Lookup column for downstream proofs** (optional, recommended) — pick the column you want `pre-deploy-audit` and `run-proven-query` to filter on for membership proofs (`WHERE <col> = '<value>'`). Pass it to `publish-dataset-cli.mjs` via `--lookup-column NAME` so the choice is validated against the schema and persisted into the cross-skill handoff (`.last-publish.json`). If you don't pass it, downstream auto-picks the first VARCHAR column.
- **Access mode** (the chain calls this `tableType`) — **use `Community` (the default)**. It's the only enum value that accepts `indexing.submitData` end-to-end from a normal funded account, and it's what the entire pipeline below assumes. Verified on mainnet.
  - The runtime *also* exposes `PublicPermissionless`, `CoreBlockchain`, `SCI`, and `Testing`, but those route through privileged quorum / require permission grants from SXT (`IndexingPallet.SubmitDataForPrivilegedQuorum`) and will fail with `BadOrigin` on insert for normal users.
  - **Do not pass `OwnerPermissioned` or `UserVerified`** — these names appear in older SXT marketing material but are not valid on the current runtime and fail with `Cannot map Enum JSON, unable to find 'OwnerPermissioned'`. If you need owner-only writes, hold the only key permitted to sign `indexing.submitData` — the chain enforces this via signer identity, not via the `tableType` enum.

  Always probe the live enum before generating values for an agent: `api.createType('SxtCoreTablesTableType').defKeys` returns the current set.

You also need a wallet that has compute credits funded at https://chain.spaceandtime.io. Credits are funded with SXT, WETH, USDC, or USDT — the exact amount needed depends on payload size and is shown in the wallet flow.

## Pick a namespace prefix

**This is one of two human decisions the skill should ask about** (the other is the schema proposal). Do not silently invent a prefix.

The decision flow:

1. **Check `examples/data/.last-publish.json`** — if it exists, the user has published before from this clone. Extract the prefix from `tableRef` by stripping the trailing `_<40_hex>.<TABLE>` suffix (or read the persisted `prefix` field if present). **Propose reusing it** so the user's tables stay grouped under one namespace:

   > "Your prior publish used the namespace prefix `BIFF_DATA`. Re-use it for this dataset? (Yes → I'll publish as `BIFF_DATA.<DATASET>`; No → tell me a new prefix.)"

2. **First-ever publish** (no handoff file) — ask the user explicitly:

   > "What namespace prefix would you like to use? It should scope your project — your org name, app name, or anything `UPPERCASE_SNAKE_CASE`. For example: `ACME_PROJECT`, `MY_AUDIT`, `MEMBERSHIP_V1`. The chain will auto-append your wallet hex so it never collides with anyone else's namespace."

   If they hesitate, propose one derived from their project context (the repo name, the CSV's apparent domain, etc.) — but get explicit confirmation before publishing.

3. **The table portion** (after the dot) defaults to the CSV's filename in UPPERCASE_SNAKE_CASE (`validators.csv` → `VALIDATORS`). The CLI will derive this automatically when only the CSV is passed without an explicit `PREFIX.TABLE`.

4. **The wallet hex suffix is automatic** — never let the user (or the skill) construct the hex-suffixed namespace by hand. The CLI computes it from `PRIVATE_KEY` at publish time. The chain enforces that the namespace ends with the signing wallet's uppercase hex; mismatched prefixes are rejected.

### How the CLI applies these choices

```bash
# First publish — user provides PREFIX.TABLE explicitly:
node publish-dataset-cli.mjs ./data/validators.csv ACME_PROJECT.VALIDATORS --lookup-column ID

# Subsequent publish — omit PREFIX.TABLE. The CLI reads .last-publish.json,
# reuses the remembered prefix, and derives the table name from the CSV stem:
node publish-dataset-cli.mjs ./data/members.csv
# → publishes as ACME_PROJECT.MEMBERS

# Switch to a new namespace mid-project — pass a different PREFIX.TABLE explicitly:
node publish-dataset-cli.mjs ./data/audit.csv ACME_AUDIT.SIGNATURES
```

The cross-skill handoff (`.last-publish.json`) carries the full table reference *and* the prefix portion separately, so every downstream skill (`run-proven-query`, `save-proof-plans`, `verify-stakers`, `render-onchain-query`) auto-picks up whichever dataset was published most recently — no env-var copy-paste between steps.

## Schema design — when the user has no `schema.json`

Most users will hand you a CSV with no schema file. Don't stop and ask them to write one — *propose* one by inspecting the data, confirm the proposal, then write it. The decision flow:

1. **Read the first ~100 rows** of the CSV with the Read tool. That's enough to type-infer reliably without loading the full file.
2. **Per column, propose a SQL type** using the rules below. Show the user the proposal as a table before writing the file.
3. **Pick a lookup-column candidate** by counting distinct values across the sample. The column with the highest cardinality (closest to 100% unique) and zero nulls is the right default for membership-proof queries. If two columns tie, pick the one whose name is more identifier-like (`id`, `address`, `hash`, `wallet`). This column gets passed to `publish-dataset-cli.mjs` via `--lookup-column NAME` and persisted into the `.last-publish.json` handoff so every downstream skill picks it up automatically. **Do not emit a `PRIMARY KEY` clause** — the chain accepts it but the indexer silently skips PK-bearing tables.
4. **Confirm the proposal** with the user in one message. Show types + lookup column + one example row, ask "Look right?" Don't write the file or run the publish until they say yes.
5. **Write `<csv-name>.schema.json`** next to the CSV with the agreed shape and proceed.

### Type judgment for ambiguous columns

The chain's full set is `BOOLEAN | BIGINT | VARCHAR | DECIMAL75 | TIMESTAMP` (plus `BINARY` and the smaller int variants per the official Arrow type reference). When a column could be more than one, default this way:

| Sample values look like | Default to | Why |
|---|---|---|
| `0x` followed by 40 hex chars | `VARCHAR` | EVM address; comparisons are exact, no arithmetic needed |
| `0x` followed by 64 hex chars | `VARCHAR` | Hash (tx hash, bytecode hash, content hash); same reasoning |
| Pure integer in normal range (≤ 2⁶³) | `BIGINT` | Native fixed-point, fast comparisons |
| Decimal/float with money or financial naming (`amount`, `price`, `usd`, `balance`, `value`) | `DECIMAL75` | Floats break Proof of SQL determinism; ask user for `(precision, scale)` |
| Boolean-ish (`true`/`false`, `0`/`1`, `yes`/`no`) — confirm normalization | `BOOLEAN` | Smallest type that fits |
| ISO-8601 timestamp or unix epoch seconds/ms | `TIMESTAMP` | Use millisecond precision |
| Free text, names, descriptions | `VARCHAR` | Catch-all |
| Anything `NULL`-able | **Refuse to publish that column as-is** | Proof of SQL needs `NOT NULL`. Ask user to either drop the column, fill defaults, or filter rows with nulls |

If you see types you don't recognize from this list (`JSON`, `ARRAY`, `BYTEA`, `FLOAT`, `DOUBLE`, `UUID`), tell the user the chain can't carry them today and propose a `VARCHAR` representation (e.g., serialize JSON to a string, store UUIDs as their canonical hex form).

### Worked example

User: *"Publish `validators.csv` to my SXT account."*

Sample rows the agent sees from `Read('validators.csv', limit=5)`:
```
validator_id,operator_address,total_staked_usd,first_seen,is_slashed
0xabc123,0xdef456,1234567.89,2025-09-12T14:00:00Z,false
0x7890ab,0xcdef12,500000.00,2025-10-01T09:30:00Z,true
```

What the agent should propose back to the user:

```
Proposed schema for validators.csv:

| Column            | Type            | Notes                              |
|-------------------|-----------------|------------------------------------|
| VALIDATOR_ID      | VARCHAR         | hex identifier, 100% unique        |
| OPERATOR_ADDRESS  | VARCHAR         | EVM address                        |
| TOTAL_STAKED_USD  | DECIMAL75(20,2) | financial; 2 decimal places        |
| FIRST_SEEN        | TIMESTAMP       | ISO-8601, millisecond precision    |
| IS_SLASHED        | BOOLEAN         | normalized true/false              |

Lookup column: VALIDATOR_ID (100% unique, no nulls in sample) — will be passed via --lookup-column
Namespace prefix: <ASK_THE_USER — e.g. ACME_PROJECT> (chain auto-appends your wallet hex)
Effective table reference: <PREFIX>_<YOUR_WALLET_HEX>.VALIDATORS
Access mode: Community (public reads + writes — confirm before mainnet)
DDL: NOT NULL on every column, no PRIMARY KEY (chain indexer silently skips PK-bearing tables)

Confirm the prefix + schema + lookup column and I'll write the schema.json and run the publish.
```

This is the conversation pattern. Don't skip the confirmation step — schema decisions are committed onchain at publish time and can't be altered without dropping and re-creating the table.

## Two ways to publish

### Path A — No-code (recommended for first-time publishers)

Walk the user through the official SXT tutorial:

1. Open https://chain.spaceandtime.io.
2. Connect the wallet that holds the compute credits.
3. Click "Create a Table of Your Data" (one of the three official tutorials on the landing page).
4. Define schema, columns, primary key, and access mode in the UI.
5. Upload the file (CSV typical, Parquet supported).
6. Sign the Substrate transaction with the wallet. The table is committed onchain.
7. Note the resulting table reference (`<schema>.<table>`) — downstream skills need this.

This path is the right call when:
- The user is not yet comfortable with Substrate / Polkadot.js tooling.
- The dataset is small (under ~100k rows).
- The user wants the chain.spaceandtime.io receipt for their records.

### Path B — Programmatic CLI with an Ethereum private key

A working Node.js script ships at `examples/scripts/publish-dataset-cli.mjs` in this repo. Uses the official SxT `EthEcdsa` signing pattern — a standard Ethereum private key signs SxT chain transactions directly, no Substrate seed needed. Pattern lifted verbatim from chain.spaceandtime.io's "Programmatic Table Creation" tutorial.

**One-time setup**:

1. Install deps:
   ```bash
   cd examples/scripts && npm install
   ```
2. Create a fresh Ethereum account dedicated to SxT testnet (not your main MetaMask). Reveal its private key. Fund SxT testnet credits to its address via chain.spaceandtime.io.
3. Create `.env` in `examples/scripts/`:
   ```
   PRIVATE_KEY=0xyour_fresh_account_private_key
   ```

**Run the publish**:

```bash
# First publish — explicit prefix (replace ACME_PROJECT with the user's chosen prefix).
node examples/scripts/publish-dataset-cli.mjs \
  ./examples/data/known-exploits-sample.csv \
  ACME_PROJECT.KNOWN_EXPLOITS \
  --schema ./examples/data/known-exploits-sample.schema.json \
  --lookup-column BYTECODE_HASH   # optional — pins the membership-proof column for downstream skills

# Subsequent publish (after .last-publish.json exists) — prefix is remembered, table portion
# is derived from the CSV stem. The agent should still confirm "use the remembered prefix?" first.
node examples/scripts/publish-dataset-cli.mjs ./examples/data/drainers.csv --lookup-column ADDRESS
# → publishes as ACME_PROJECT.DRAINERS
```

### Cross-skill handoff (the "active dataset" mechanism)

After a successful publish, the CLI writes `examples/data/.last-publish.json` capturing `{tableRef, prefix, csvPath, schemaPath, lookupColumn, wallet, publishedAt}`. **This is the contract that lets every downstream CLI skill pick up the dataset the user just published with zero configuration** — `save-proof-plans.mjs`, `verify-stakers.mjs`, and `render-onchain-query.mjs` read it as a fallback when their explicit env vars aren't set. The persisted `prefix` field is also what makes the *next* publish a one-liner (the CLI reuses it; the user doesn't retype it).

The handoff file is **per-local-clone and gitignored** (it contains the publisher's wallet hex). Each forked user gets their own publish → auto-pickup chain without leaking wallet identity into PRs.

Resolution order downstream:

1. Explicit env / arg (e.g. `SXT_TABLE`, `SXT_LOOKUP_COLUMN`, `--tableRef`)
2. `.last-publish.json`
3. Legacy canonical-demo defaults (so the bundled STAKERS demo still works with zero env)

If the user passes `--lookup-column NAME` at publish time, the column is validated against the schema before any chain spend and persisted into the handoff. If omitted, downstream picks the first VARCHAR column automatically and the user can override per-run with `SXT_LOOKUP_COLUMN`.

The script:

1. Reads the CSV and schema.
2. Connects to the RPC in `SXT_RPC` env var. **Default is `wss://rpc.mainnet.sxt.network`** — matches the canonical `spaceandtimefdn/sxt-chain-examples` tutorial and the chain.spaceandtime.io UI. Override with `SXT_RPC=wss://rpc.testnet.sxt.network` for testnet (separate credit balance; rarely used since the funding UI defaults to mainnet too).
3. Builds the namespace per chain rule: `<PREFIX>_<UPPERCASE_HEX_ADDRESS>` (auto-derived from your wallet).
4. Renders `NOT NULL` on every column (chain rule for Proof of SQL determinism). **No `PRIMARY KEY` clause** — see the load-bearing rule under Inputs above.
5. Wraps the ethers Wallet with `EthEcdsaSigner`.
6. Submits a batched transaction: `utility.batchAll([createNamespace, createTables])`. **Idempotent on re-run** — `batchAll` is atomic, so on second-publish-per-wallet (namespace already exists) the script catches the rollback and falls back to submitting `createTables` alone against the existing namespace.
7. Encodes rows as Apache Arrow IPC with **explicitly typed vectors** built from the schema (`vectorFromArray(values, new Utf8())` etc.). Implicit typing via `tableFromJSON` produces messages the runtime rejects with `indexing.ArrowExpectedRecordBatchMessage`.
8. Submits the insert via **`api.tx.indexing.submitData({namespace, name}, batchId, ipcHex)`** — *not* `api.tx.tables.*`. The insert extrinsic lives on the `indexing` pallet per the official chain.spaceandtime.io "Programmatic Data Insertion" docs.
9. Writes the inferred schema next to the CSV (`<csv-base>.inferred-schema.json`) AND the cross-skill handoff (`examples/data/.last-publish.json`), then prints finalized block hashes.

### Key chain rules to remember

- **Namespace must end with the wallet address (uppercase, without 0x).** The script appends this automatically. Your effective table reference becomes `<PREFIX>_<UPPERCASE_HEX_ADDRESS>.<TABLE>`.
- **All columns must be `NOT NULL`** — Proof of SQL needs deterministic data, no null branches.
- **DECIMAL preferred over FLOAT** for numeric data — fixed-point arithmetic is deterministic; floats aren't and break proofs.
- **Insert via `api.tx.indexing.submitData`, not `api.tx.tables.*`.** The `tables` pallet only exposes DDL (`createNamespace`, `createTables`, `dropTable`, etc.). Data inserts go through the `indexing` pallet. Some older community samples tried `tables.insertData` / `tables.insertIntoTable` — those don't exist on the current runtime.
- **Some restricted table types may require additional indexing permissions.** Standard `Community` tables created from a funded account accept `submitData` with no extra setup (verified end-to-end on mainnet). If your table type or quorum config requires `IndexingPallet.SubmitDataForPrivilegedQuorum`, the chain returns a `BadOrigin` and you should load via the chain.spaceandtime.io UI or contact SxT for the permission grant.

### Minimal pattern (for agents authoring custom variants)

The pattern below covers both stages — DDL on the `tables` pallet, then DML on the `indexing` pallet — and matches what the bundled `publish-dataset-cli.mjs` does end-to-end. Note the explicit Arrow typing and the separate insert call.

```javascript
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Wallet } from 'ethers';
import { EthEcdsaSigner } from './ethecdsa_signer.mjs';
import { Table as ArrowTable, Utf8, vectorFromArray, tableToIPC } from 'apache-arrow';

// Use mainnet RPC for production; the chain.spaceandtime.io UI defaults here.
const api = await ApiPromise.create({
  provider: new WsProvider(process.env.SXT_RPC ?? 'wss://rpc.mainnet.sxt.network'),
  noInitWarn: true,
});
const wallet = new Wallet(process.env.PRIVATE_KEY);
const signer = new EthEcdsaSigner(wallet, api);

const namespace = `MY_AUDIT_${wallet.address.slice(2).toUpperCase()}`;
const table = 'KNOWN_EXPLOITS';
const rows = [/* {BYTECODE_HASH, EXPLOIT_TYPE} objects */];

// ── DDL: create namespace + table (idempotent on retry) ────────────
const createNs = api.tx.tables.createNamespace(
  namespace, 0,
  `CREATE SCHEMA IF NOT EXISTS ${namespace}`,
  'Community',                                // see Access mode list above
  { UserCreated: 'agent' },
);
const createTbl = api.tx.tables.createTables([{
  ident: { namespace, name: table },
  // NOTE: NOT NULL on every column. NO PRIMARY KEY clause — the chain
  // accepts PK-bearing DDL but the dreamspace MAINNET indexer silently
  // skips promoting PK-bearing tables, which breaks /v1/zkquery + on-chain
  // executors downstream. Verified failure mode — see the Inputs section.
  createStatement: `CREATE TABLE ${namespace}.${table} (
    BYTECODE_HASH VARCHAR NOT NULL,
    EXPLOIT_TYPE VARCHAR NOT NULL
  )`,
  tableType: 'Community',
  commitment: { Empty: { hyperKzg: true } },
  source: { UserCreated: 'agent' },
}]);

try {
  await api.tx.utility.batchAll([createNs, createTbl])
    .signAndSend(signer.address, { signer });
} catch (e) {
  // On re-run the table is already there — ignore and proceed to insert.
  if (!/VersionAlreadyExists|already exists/i.test(String(e?.message ?? e))) throw e;
}

// ── DML: build a typed Arrow table, then submitData on `indexing` ──
const arrow = new ArrowTable({
  BYTECODE_HASH: vectorFromArray(rows.map(r => r.BYTECODE_HASH), new Utf8()),
  EXPLOIT_TYPE:  vectorFromArray(rows.map(r => r.EXPLOIT_TYPE),  new Utf8()),
});
const ipc = tableToIPC(arrow);
const ipcHex = '0x' + Buffer.from(ipc).toString('hex');
const batchId = '0x' + BigInt(Date.now()).toString(16).padStart(16, '0');

await api.tx.indexing.submitData(
  { namespace, name: table },
  batchId,
  ipcHex,
).signAndSend(signer.address, { signer });
```

Three details the runtime is strict about:

- The RPC default for the chain.spaceandtime.io UI is mainnet (`wss://rpc.mainnet.sxt.network`); the testnet endpoint at `wss://rpc.testnet.sxt.network` has a separate credit balance.
- The insert extrinsic is on the `indexing` pallet (`api.tx.indexing.submitData(table, batchId, dataHex)`), not `api.tx.tables.*`.
- Arrow vectors must be explicitly typed via `vectorFromArray(values, new Utf8())`. `tableFromJSON(rows)` infers types and produces an IPC stream the runtime rejects with `indexing.ArrowExpectedRecordBatchMessage`.

## Verifying the publish

After either path, verify the table is queryable with proof:

```sql
SELECT COUNT(*) AS ROWS_PUBLISHED
FROM MY_AUDIT.KNOWN_EXPLOITS
```

Run this through the SXT prover at `https://api.makeinfinite.dev/v1/zkquery`. The raw `SXT_API_KEY` is not a Bearer token; exchange it for a 25-minute JWT at `https://proxy.api.makeinfinite.dev/auth/apikey` first. The `sxt-proof-of-sql-sdk` package handles the exchange, submit, poll, and verify flow in one call. The canonical implementation lives in `examples/scripts/verify-stakers.mjs`. If the SDK returns a verified row count that matches what you uploaded, the table is committed and ready for downstream skills.

Or simpler: just run `node examples/scripts/verify-stakers.mjs` with no arguments — it reads `.last-publish.json` and runs the cardinality + point-lookup proofs against whatever was just published.

## Common datasets worth publishing

The skill is most useful when paired with reference data that downstream audit workflows need. Replace `<PREFIX>` with whatever the user picked (or what `.last-publish.json` already remembers):

| Dataset | Schema/Table | What downstream consumes it |
|---|---|---|
| Known-exploit bytecode signatures | `<PREFIX>.KNOWN_EXPLOITS (bytecode_hash, exploit_type, severity, source_url)` | `pre-deploy-audit` cross-references to flag vulnerable patterns |
| Trusted deployer allowlist | `<PREFIX>.TRUSTED_DEPLOYERS (address, label, source)` | `pre-deploy-audit` reduces false positives on known-good deployers |
| Drainer wallet denylist | `<PREFIX>.DRAINER_WALLETS (address, first_seen, evidence_url)` | Pre-integration checks before allowing a contract to receive `setApprovalForAll` |
| Token metadata | `<PREFIX>.TOKEN_METADATA (address, name, ticker, logo_url, verified_at)` | UI / agent metadata enrichment |

For audit-specific reference data, consider seeding from public sources like Forta alerts, Rekt News bytecode signatures, or community-maintained Etherscan tags. Always cite the source URL in the row so the audit report can attribute findings.

## Hard constraints

- **Column types are limited to** `BOOLEAN`, `BIGINT`, `VARCHAR`, `DECIMAL75`, `TIMESTAMP` (plus `BINARY`, `TINYINT`, `SMALLINT`, `INT`). Don't promise the user we support `JSON`, `BLOB`, or other types — they will silently break Proof of SQL on subsequent queries.
- **Schema names** must be lowercase letters and digits, starting with a letter. Table names within a schema use `UPPERCASE_SNAKE_CASE`.
- **All columns must be `NOT NULL`.** Proof of SQL needs deterministic data, no null branches.
- **No `PRIMARY KEY` clause** — silently breaks catalog promotion (see Inputs above).
- **Compute credits are required** to publish. If the wallet hasn't funded credits at chain.spaceandtime.io, stop and direct the user there before attempting the publish.
- **Default RPC is mainnet.** Both `publish-dataset-cli.mjs` and the chain.spaceandtime.io UI default to `wss://rpc.mainnet.sxt.network`. Testnet (`wss://rpc.testnet.sxt.network`) has a separate credit balance and is opt-in via `SXT_RPC` env override. Mainnet table commitments are permanent — only insert public, non-PII data.

## When to refuse

Refuse and stop if:

- The dataset contains PII (names, emails, government IDs). The table is committed onchain — once published, you cannot delete the commitment.
- The user wants to publish proprietary data without understanding that `Community` access mode means anyone can write, and that *no* mainnet `tableType` value prevents reads — proven SQL is publicly readable by design.
- The wallet's seed is being passed via plain text in chat. Insist on env vars or a wallet UI.

## What this skill is not

- **Not a database admin tool.** No GUI, no migrations, no backups. Once a table is committed, schema changes require a new table.
- **Not a substitute for IPFS / S3 for large blobs.** SXT is for queryable structured data, not file storage.

## References

- SXT Creating Tables (DDL) docs: https://docs.spaceandtime.io/docs/creating-tables-ddl
- Apache Arrow JS: https://arrow.apache.org/docs/js/
- Polkadot.js API: https://polkadot.js.org/docs/api/
- chain.spaceandtime.io tutorial UI (no-code path): https://chain.spaceandtime.io
- Sibling skill: `dreamspace-query:proof-of-sql-foundations` (covers what queries you can run against the table afterward).
