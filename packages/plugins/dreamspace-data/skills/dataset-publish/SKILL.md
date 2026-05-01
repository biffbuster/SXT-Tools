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
- **Schema and table name** — e.g., `MY_AUDIT.KNOWN_EXPLOITS`. Use `UPPERCASE_SNAKE_CASE`. The schema half is the namespace (lowercase letters + digits, starts with a letter); the table half is the name within that namespace.
- **Column types** — one of `BOOLEAN`, `BIGINT`, `VARCHAR`, `DECIMAL75`, `TIMESTAMP`. Anything outside this list cannot carry a Proof of SQL query (see the `proof-of-sql-foundations` skill).
- **Primary key column** — required. Must be `NOT NULL` and unique per row.
- **Access mode** — one of:
  - `Community` — anyone can write (suitable for public reference datasets that the community curates together).
  - `Owner-Permissioned` — only the owner can write; anyone can read (most common for audit reference tables).
  - `User-Verified` — owner writes; readers verify each row's signature on their own.

You also need a wallet that has compute credits funded at https://chain.spaceandtime.io. Credits are funded with SXT, WETH, USDC, or USDT — the exact amount needed depends on payload size and is shown in the wallet flow.

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
node examples/scripts/publish-dataset-cli.mjs \
  ./examples/data/known-exploits-sample.csv \
  MY_AUDIT.KNOWN_EXPLOITS \
  --schema ./examples/data/known-exploits-sample.schema.json
```

The script:

1. Reads the CSV and schema.
2. Connects to `wss://rpc.testnet.sxt.network`.
3. Builds the namespace per chain rule: `<PREFIX>_<UPPERCASE_HEX_ADDRESS>` (auto-derived from your wallet).
4. Renders `NOT NULL` on every column (chain rule for Proof of SQL determinism).
5. Wraps the ethers Wallet with `EthEcdsaSigner`.
6. Submits a batched transaction: `createNamespace` + `createTables`.
7. Encodes rows as Apache Arrow IPC and submits an insert transaction.
8. Prints finalized block hashes.

### Key chain rules to remember

- **Namespace must end with the wallet address (uppercase, without 0x).** The script appends this automatically. Your effective table reference becomes `<PREFIX>_<UPPERCASE_HEX_ADDRESS>.<TABLE>`.
- **All columns must be `NOT NULL`** — Proof of SQL needs deterministic data, no null branches.
- **DECIMAL preferred over FLOAT** for numeric data — fixed-point arithmetic is deterministic; floats aren't and break proofs.
- **Data insertion requires `IndexingPallet.SubmitDataForPrivilegedQuorum` permission.** Table creation works with any funded account; if insert fails with a permission error, the table is created — load data via chain.spaceandtime.io CSV upload UI instead.

### Minimal pattern (for agents authoring custom variants)

```javascript
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Wallet } from 'ethers';
import { EthEcdsaSigner } from './ethecdsa_signer.mjs';

const api = await ApiPromise.create({
  provider: new WsProvider('wss://rpc.testnet.sxt.network'),
  noInitWarn: true,
});
const wallet = new Wallet(process.env.PRIVATE_KEY);
const signer = new EthEcdsaSigner(wallet, api);

const namespace = `MY_AUDIT_${wallet.address.slice(2).toUpperCase()}`;
const table = 'KNOWN_EXPLOITS';

const createNs = api.tx.tables.createNamespace(
  namespace, 0,
  `CREATE SCHEMA IF NOT EXISTS ${namespace}`,
  'Community',
  { UserCreated: 'agent' },
);
const createTbl = api.tx.tables.createTables([{
  ident: { namespace, name: table },
  createStatement: `CREATE TABLE ${namespace}.${table} (
    BYTECODE_HASH VARCHAR NOT NULL,
    EXPLOIT_TYPE VARCHAR NOT NULL,
    PRIMARY KEY (BYTECODE_HASH)
  )`,
  tableType: 'Community',
  commitment: { Empty: { hyperKzg: true } },
  source: { UserCreated: 'agent' },
}]);

await api.tx.utility.batchAll([createNs, createTbl])
  .signAndSend(signer.address, { signer });
```

## Verifying the publish

After either path, verify the table is queryable with proof:

```sql
SELECT COUNT(*) AS ROWS_PUBLISHED
FROM MY_AUDIT.KNOWN_EXPLOITS
```

Run this through the SXT REST API at `https://api.makeinfinite.dev/v2/sql` with `proveExecution: true`. If the response includes a proof receipt and the row count matches what you uploaded, the table is committed and ready for downstream skills.

## Common datasets worth publishing

The skill is most useful when paired with reference data that downstream audit workflows need:

| Dataset | Schema/Table | What downstream consumes it |
|---|---|---|
| Known-exploit bytecode signatures | `MY_AUDIT.KNOWN_EXPLOITS (bytecode_hash, exploit_type, severity, source_url)` | `pre-deploy-audit` cross-references to flag vulnerable patterns |
| Trusted deployer allowlist | `MY_AUDIT.TRUSTED_DEPLOYERS (address, label, source)` | `pre-deploy-audit` reduces false positives on known-good deployers |
| Drainer wallet denylist | `MY_AUDIT.DRAINER_WALLETS (address, first_seen, evidence_url)` | Pre-integration checks before allowing a contract to receive `setApprovalForAll` |
| Token metadata | `MY_APP.TOKEN_METADATA (address, name, ticker, logo_url, verified_at)` | UI / agent metadata enrichment |

For audit-specific reference data, consider seeding from public sources like Forta alerts, Rekt News bytecode signatures, or community-maintained Etherscan tags. Always cite the source URL in the row so the audit report can attribute findings.

## Hard constraints

- **Column types are limited to** `BOOLEAN`, `BIGINT`, `VARCHAR`, `DECIMAL75`, `TIMESTAMP`. Don't promise the user we support `JSON`, `BLOB`, or other types — they will silently break Proof of SQL on subsequent queries.
- **Schema names** must be lowercase letters and digits, starting with a letter. Table names within a schema use `UPPERCASE_SNAKE_CASE`.
- **Primary key is required** and must be `NOT NULL`.
- **Compute credits are required** to publish. If the wallet hasn't funded credits at chain.spaceandtime.io, stop and direct the user there before attempting the publish.
- **Testnet by default.** The RPC endpoint above (`wss://rpc.testnet.sxt.network`) is testnet. Production deployments require explicit confirmation that mainnet is the target — and at the time of writing, the user should confirm with their SXT contact whether mainnet publish is enabled for their account.

## When to refuse

Refuse and stop if:

- The dataset contains PII (names, emails, government IDs). The table is committed onchain — once published, you cannot delete the commitment.
- The user wants to publish proprietary data without understanding `Community` access mode means anyone can write, and `Owner-Permissioned` does not prevent anyone from reading.
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
