# DreamSpace AI — Example Scripts

Two scripts that demonstrate the v0.1 workflow against Space and Time testnet from the CLI alone, no browser required after one-time wallet setup.

## Scripts

| Script | Purpose | Status |
|---|---|---|
| `generate-substrate-account.mjs` | Generate a fresh sr25519 mnemonic + SS58 address for use as the table owner | ✅ Stable. Run once to bootstrap a CLI publishing identity. |
| `publish-dataset-cli.mjs` | Publish a CSV to SxT testnet as a chain-secured table via Polkadot.js | ⚠ Pre-tested. Insert method name may need a one-line tweak per chain version. |
| `audit-with-sxt.mjs` | Cross-reference a contract's bytecode hash against a published reference table with a Proof of SQL receipt | ✅ Stable. Verifies your SxT API key works before doing the Claude demo. |

Both are vanilla Node.js (no TypeScript build step). They run against testnet and are designed to be safe to iterate on.

## Setup

Install dependencies — these live in this scripts directory, not the main repo's `package.json`:

```bash
cd examples/scripts
npm install
```

This installs:
- `@polkadot/api` — Substrate RPC client for table creation/insert
- `apache-arrow` — encodes rows as Arrow IPC for SxT chain ingestion
- `csv-parse` — reads the input CSV

Then set environment variables. The two scripts use different credentials:

| Variable | Used by | Where to get it |
|---|---|---|
| `SXT_API_KEY` | `audit-with-sxt.mjs` | chain.spaceandtime.io dashboard after wallet connect |
| `SXT_OWNER_SEED` | `publish-dataset-cli.mjs` | A Substrate-format seed (sr25519 mnemonic or 0x-prefixed seed) for the account that owns the table. **Different from your MetaMask key** — see "Wallet seed" below. |

## Signing — use your existing Ethereum key

SxT chain accepts a special `EthEcdsa` signature variant for EVM-derived accounts. That means **a standard Ethereum private key signs SxT chain transactions directly** — no Substrate seed needed.

This matches the official chain.spaceandtime.io "Programmatic Table Creation" tutorial. The `ethecdsa_signer.mjs` helper in this directory is lifted verbatim from those docs.

### Recommended: a fresh ETH key, not your main MetaMask

Don't paste the private key for your main MetaMask account into a script. Instead:

1. In MetaMask, click "Add account" → create a new empty account dedicated to SxT testnet.
2. Reveal the private key for **that new account only** (Account details → Show private key).
3. Send testnet SXT credits from your existing funded MetaMask account to the new account's address — same chain.spaceandtime.io wallet flow you've used before.
4. Put the private key in `.env` (gitignored):
   ```
   PRIVATE_KEY=0xyour_fresh_account_private_key
   ```

The fresh account isolates the SxT-chain blast radius. If something goes wrong, only that account is affected — your main wallet stays untouched.

### The chain rules that matter

The official docs spell out three constraints that apply whether you publish via UI or CLI:

1. **Namespace must end with your wallet address** (without `0x`, uppercase). The script auto-appends this — you provide the prefix, it computes the full namespace.
2. **All columns must be `NOT NULL`** — chain rule for Proof of SQL determinism. The script renders `NOT NULL` on every column automatically.
3. **Data insertion requires `IndexingPallet.SubmitDataForPrivilegedQuorum` permission.** Table creation works with any funded account. If your account lacks the insert permission, the script reports the create succeeded and tells you to load data via the chain.spaceandtime.io CSV upload UI instead.

## Usage

### Publish a dataset

Create `.env` in this directory:

```
PRIVATE_KEY=0xyour_fresh_eth_private_key
```

Then run:

```bash
node publish-dataset-cli.mjs \
  ../data/known-exploits-sample.csv \
  MY_AUDIT.KNOWN_EXPLOITS \
  --schema ../data/known-exploits-sample.schema.json
```

The script transforms `MY_AUDIT.KNOWN_EXPLOITS` into the chain-required form `MY_AUDIT_<UPPERCASE_HEX_ADDRESS>.KNOWN_EXPLOITS` automatically. Note this full namespace — you'll need it when querying the table later (the audit script and the audit skill should reference the full namespace).

Expected output (success path):

```
▶ Reading ../data/known-exploits-sample.csv
  Parsed 6 rows
  Loaded explicit schema from ../data/known-exploits-sample.schema.json

▶ CREATE TABLE statement:
    CREATE TABLE MY_AUDIT.KNOWN_EXPLOITS (
      BYTECODE_HASH VARCHAR NOT NULL,
      EXPLOIT_TYPE VARCHAR,
      ...
    )

▶ Connecting to wss://rpc.testnet.sxt.network
  Connected. Chain: SxT Testnet
  Owner address (sr25519): 5G...

▶ Submitting CREATE TABLE transaction...
  createTables included in block: 0xabc...
  createTables finalized in block: 0xabc...

▶ Encoding 6 rows as Apache Arrow IPC...
  Encoded 712 bytes

▶ Submitting INSERT transaction via api.tx.tables.insertIntoTable...
  insert finalized in block: 0xdef...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Published 6 rows to MY_AUDIT.KNOWN_EXPLOITS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Audit (verify the publish + run cross-reference)

```bash
export SXT_API_KEY=your_api_key

# Quick verification with the demo-marker hash
node audit-with-sxt.mjs --demo

# Or against a real source file (computes SHA-256 of source)
node audit-with-sxt.mjs ../contracts/SampleToken.sol
```

## Troubleshooting

### Publish — "module error: …"

Most likely the SxT chain returned a domain-specific error. Common causes:

| Error fragment | Cause | Fix |
|---|---|---|
| `InsufficientBalance` | Account doesn't have enough credits | Fund credits at chain.spaceandtime.io |
| `TableAlreadyExists` | The table was already created in a prior run | Pick a new table name or drop the existing one |
| `InvalidSignature` | Seed doesn't match the funded account | Confirm the seed and funded account are the same |
| `BadOrigin` | Chain version mismatch — the call shape changed | Check the SxT docs for the current `createTables` signature |

### Publish — "No matching insert method found"

The script tries `insertIntoTable`, `insertData`, `insert`, `insertRows`, and `append` in order. If none match, it prints all available `api.tx.tables.*` methods. Pick the right one and update the `candidateMethods` array near the bottom of the script.

This is the most common one-line tweak you'll need.

### Audit — "401 / 403"

Your `SXT_API_KEY` is wrong, expired, or doesn't have read permission on the table. Get a fresh key from chain.spaceandtime.io.

### Audit — "no such table"

The reference table isn't published yet. Run `publish-dataset-cli.mjs` first, or use the chain.spaceandtime.io UI per `DEMO.md` Tier 3 step 3.

### Audit — "no proof receipt"

The script tries four common field paths (`proofReceipt`, `proof_receipt`, `proof.receipt`, `proof.hash`). If yours is somewhere else, the raw response is printed — find the field, update the lookup in the script, and re-run.

## What "iterate on against testnet" means

This script is best-effort against current SxT docs. The pieces I'm confident about:
- Polkadot.js connect + signAndSend flow ✓
- CSV parse + Arrow IPC encoding ✓
- Substrate keyring with sr25519/ed25519 ✓
- The `createTables` call shape from SxT docs ✓

The piece that may need tweaking:
- The exact insert method name on `api.tx.tables`. The script prints what's available when it can't find what it tried, so the fix is one line.

If you hit either of those, you can either:
1. Edit `publish-dataset-cli.mjs` directly (one-line change to the method name).
2. Tell me what the script printed and I'll update it.

## Don't commit secrets

This directory is in the same repo as the docs site. Don't commit your `SXT_OWNER_SEED` or `SXT_API_KEY`. The repo's root `.gitignore` already excludes `node_modules/`. Use a `.env.local` file (gitignored) for local secrets, or export them in your shell.
