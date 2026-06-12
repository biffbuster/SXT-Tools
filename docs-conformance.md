# Space and Time documentation conformance audit — June 10, 2026

Every protocol claim hardcoded in this repo, cross-checked against current
SXT documentation and (where docs were silent or contradictory) the live SXT
chain itself. Re-run this audit before each release.

Method: repo-wide claim inventory → docs.spaceandtime.io cross-check →
live-chain metadata/storage probes (read-only) for anything docs don't cover.

## Contract addresses & constants

| Claim | Our value | Source checked | Match | Action |
|---|---|---|---|---|
| QueryRouter (Base + Ethereum) | `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB` | [ZK-SQL via smart contracts](https://docs.spaceandtime.io/docs/zk-sql-via-smart-contracts) | ✅ | none |
| Verifier Base | `0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518` | same | ✅ | none |
| Verifier Ethereum | `0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9` | same | ✅ | none |
| SXT ERC-20 Base | `0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8` | same | ✅ | none |
| SXT ERC-20 Ethereum | `0xE6Bfd33F52d82Ccb5b37E16D3dD81f9FFDAbB195` | same (also Etherscan) | ✅ | none |
| `version` = `keccak256("latest")` `0x5d7c83ff…d001` | `ProofOfSQL.sol:32` | same | ✅ | none |
| Query payment 100 SXT, ~150K gas verify, 1-hour cancel timeout | CLAUDE.md / README | Docs say "small payment", no amounts | ⚠️ docs silent | Keep ours — empirically verified on mainnet; docs are less specific than us |

## Off-chain prover (`/v1/zkquery`)

| Claim | Our value | Source checked | Match | Action |
|---|---|---|---|---|
| API root | `https://api.makeinfinite.dev` | SDK + working `verify-table.mjs` | ✅ empirical | none |
| Auth: apikey → 25-min JWT at `proxy.api.makeinfinite.dev/auth/apikey` | run-proven-query SKILL.md | empirical (docs don't cover the proxy) | ✅ empirical | none |
| `sourceNetwork: "MAINNET"` literal | CLAUDE.md | empirical (400 on all others) | ✅ empirical | none |
| `commitmentScheme: "HYPER_KZG"` | CLAUDE.md | live chain: `CommitmentScheme` enum = `HyperKzg \| DynamicDory` | ✅ | none |

## Publish flow vs canonical tutorial

Diffed `publish-dataset-cli.mjs` against
[`sxt-chain-examples/tutorials/create_hello_world_table`](https://github.com/spaceandtimefdn/sxt-chain-examples/tree/main/tutorials/create_hello_world_table):

| Aspect | Tutorial | Ours | Verdict |
|---|---|---|---|
| Extrinsics + order | `batchAll(createNamespace, createTables)` → `indexing.submitData` | same | ✅ |
| DDL | `NOT NULL`, no PRIMARY KEY | same (load-bearing) | ✅ |
| Commitment | `{ Empty: { hyperKzg: true } }` | same | ✅ |
| Signer | EthEcdsaSigner + ethers Wallet | same (line-for-line port) | ✅ |
| Arrow encoding | `vectorFromArray` with explicit types → `tableToIPC` | same | ✅ |
| **RPC default** | **`wss://rpc.testnet.sxt.network`** | **`wss://rpc.mainnet.sxt.network`** | ⚠️ deliberate divergence — was misdescribed as "mirrors canonical"; wording fixed in CLAUDE.md + publish-dataset-cli.mjs header (v0.2.0-beta.1) |

## SCI (Smart Contract Indexing)

| Claim | SXT docs say | Reality (verified) | Action taken |
|---|---|---|---|
| SCI tables "ZK proven sub-second" | [SCI docs](https://docs.spaceandtime.io/docs/smart-contract-indexing) claim it | ❌ Empirically false today — prover returns `254018 incomplete commitment coverage` for SCI tables; only `ETHEREUM.BLOCKS`/`TRANSACTIONS` round-trip | **Empirical evidence wins.** Repo keeps the honest "not yet zk-proven" framing everywhere |
| Registration is "Studio UI only" | Docs describe only the UI flow | ✅ UI-first, BUT the chain exposes user-callable `tables.createTableWithSciMetadata` (read from live metadata) — the same extrinsic the UI submits (user SCI tables exist only in `tableMetadata` storage, not the permissioned `Smartcontracts` pallet) | Implemented `index-contract.mjs` on the public extrinsic (v0.2.0-beta.1) |
| Supported chains "Ethereum + Base" | Marketing mentions Base indexing | ❌ Live chain `Source` enum = `Ethereum \| Sepolia \| Bitcoin \| Polygon \| ZkSyncEra \| UserCreated` — **no Base** | SKILL.md corrected; `--chain base` rejected with explanation |
| Historical backfill | Docs ambiguous | Studio UI labels it "coming soon"; live-only today | HOW_IT_WORKS.md backfill claims removed |
| Metadata format | Undocumented | Read from live `api.query.tables.tableMetadata`: JSON `{columns, contract_address, event_signature, starting_position}`; implicit `BLOCK_NUMBER BIGINT`/`TIME_STAMP TIMESTAMP` columns; chain appends the `WITH (… TABLE_UUID …)` clause itself | CLI byte-matches the observed format |
| Per-table funding account (≥100 SXT starts indexer) | Shown in Studio UI only | Derivation not exposed in chain events/constants (probed Tables pallet) | CLI prints instructions pointing at the UI; `TODO(discovery)` in source |
| SCI table creation cost | Undocumented | **Burns 20 SXT per table** for non-privileged accounts — `CREATE_COST = 20 * 10^18` in [sxt-node tables pallet](https://github.com/spaceandtimefdn/sxt-node/blob/main/pallets/tables/src/lib.rs); `FundsUnavailable` dispatch error when balance < 20 SXT (hit live, June 10 2026) | CLI plan output + mainnet prompt now state the burn; SKILL.md + BETA.md cost sections corrected |
| ALL table/namespace creation cost (not just SCI) | Undocumented (README previously said "≥1 SXT for publish fees") | `create_namespace`, `create_tables`, AND `create_table_with_sci_metadata` each burn 20 SXT **per object** for non-privileged accounts (per-table inside a batch; exempt = root or `TablesPalletPermission::EditSchema`). First CSV publish = 40 SXT. Hit live on a Community publish, June 11 2026 | `publish-dataset-cli.mjs` now pre-checks balance and fails fast with the funding instructions; `bootstrap.mjs --status` tiers its verdict (insert-only vs create); README/BETA.md funding numbers corrected |
| Testnet WS RPC health | n/a | `wss://rpc.testnet.sxt.network` accepts connections + small RPCs but never returns `state_getMetadata` (large frame) → polkadot-js init hangs. HTTP variant serves it fine | `index-contract.mjs` prefetches metadata over HTTP and passes it as a cache to `ApiPromise.create` |

## Live-chain facts this release depends on (probe before next release)

- `tables.createTableWithSciMetadata(table: CreateSciTableRequest, metadata: Bytes)`
  — "Permissions: same as create_tables"; forces `BlockEnforcementMode::Contiguous`;
  emits `SchemaUpdated` + `SciTableCreated`.
- `CreateSciTableRequest = { ident, createStatement, source, commitmentSchemeFlags: { hyperKzg, dynamicDory } }`.
- `TableType` enum: `CoreBlockchain | SCI | Community | Testing | PublicPermissionless`.
- Stored SCI DDL shape: `CREATE TABLE IF NOT EXISTS NS.NAME (… NOT NULL, BLOCK_NUMBER BIGINT NOT NULL, TIME_STAMP TIMESTAMP NOT NULL)`.

Quick re-probe (read-only):

```bash
cd examples/scripts && node -e "import('@polkadot/api').then(async ({ApiPromise,WsProvider}) => {
  const api = await ApiPromise.create({provider: new WsProvider('wss://rpc.mainnet.sxt.network'), noInitWarn: true});
  console.log(Object.keys(api.tx.tables));
  const m = api.runtimeMetadata.asLatest;
  for (const t of m.lookup.types) {
    const p = t.type.path.map(String).join('::');
    if (/TableType|tables::Source/.test(p) && t.type.def.isVariant)
      console.log(p, '=>', t.type.def.asVariant.variants.map(v=>String(v.name)).join(' | '));
  }
  await api.disconnect(); process.exit(0); })"
```
