# REVIEW.md — sign-off walkthrough for the Space and Time team

This document lets a reviewer test **every feature end-to-end via the CLI**, exactly as the maintainer did on 2026-06-10/11, with expected outputs and the original mainnet evidence to compare against. Total reviewer cost if you run everything: ~40 SXT burned + 100 SXT query + ~$1 gas (Tier 0–1 are free).

## What we're asking from SXT

1. **Blessing for the `sxt` binary name** and "Space and Time" references for a clearly-labeled community CLI (every help screen and doc carries "community-built, not endorsed").
2. **Review of the protocol claims we reverse-engineered** (Tier 4 below) — especially the undocumented 20 SXT creation burn and the SCI metadata format. We'd rather cite your docs than our probes.
3. Optional: `TablesPalletPermission::EditSchema` for the demo wallet (removes creation burns from rehearsals), and a look at the prover/testnet issues we've isolated for you.

## Design constraints (the audit surface)

- **No novel protocol logic.** Every command is a thin dispatcher (`examples/scripts/sxt.mjs`) onto a single-file script that mirrors your canonical examples (`publish` mirrors the Hello World tutorial line-for-line; `index` submits the same extrinsic your Studio UI does). The scripts are the audit surface — ~15 files, no framework.
- **Spend-gated.** Every paid action has its own confirmation; mainnet writes require typing `mainnet`; `--dry-run` prints the exact extrinsics (hex) without signing.
- **The free gate is structural.** `sxt verify` (off-chain `/v1/zkquery`) is documented as mandatory before `sxt query` — a passing proof shares the backend with on-chain fulfillment, so users can't strand 100 SXT on an unprovable table by following the docs.
- The MCP server (`packages/mcp/sxt-mcp/`) has its own stricter posture: testnet-default + mainnet double-gate. See its `SAFETY.md`.

---

## Tier 0 — install integrity (free, ~5 min)

```bash
git clone https://github.com/biffbuster/sxt-tools.git
cd sxt-tools/examples/scripts && npm install && npm link
cp .env.example .env      # set SXT_API_KEY (free at chain.spaceandtime.io)
sxt preflight
```

**Expect:** `21/21 checks passed`. Covers: Node 20+, deps, all 7 plugin SKILL.md manifests parse, MCP server boots and lists exactly 4 tools, npm-pack readiness.

## Tier 1 — proof correctness, off-chain (free)

```bash
sxt demo      # proven point lookup on a live table + Base contract liveness
sxt verify    # positive AND negative membership proofs
sxt parity    # MCP server output ≡ direct SDK output (byte-compared)
```

**Expect:** `✓ Proof verified locally` — the SDK verifies each HyperKZG proof against the on-chain commitment (`commitments.commitmentStorageMap`). A negative lookup returns an empty result with an equally valid proof.
**Our evidence:** parity confirmed with identical canonical results, MCP overhead ~1.9s.

## Tier 2 — registration writes (~40 SXT burned)

```bash
sxt status    # confirms funding; tiers its verdict by what you can afford

# CSV publish (20 SXT burn + ~0.075 fees; +20 if the namespace is new)
sxt publish ../data/sxt_stakers.csv REVIEW_TEST.STAKERS

# SCI registration — keyless mode; reuse the namespace to avoid +20
sxt index --address 0xBd3531dA5CF5857e7CfAA92426877b022e612cf8 \
  --chain ethereum \
  --event-signature "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)" \
  --namespace REVIEW_TEST
```

**Expect:** publish finalizes batchAll(createNamespace+createTables) then submitData; `sxt index` prints the DDL + metadata JSON before confirmation, and on success the on-chain `tableMetadata` entry round-trips that JSON byte-exact (`api.query.tables.tableMetadata('SCI', {namespace, name})`).
**Our evidence (2026-06-11):** 2,062 rows to `DEMO_PITCH….MEMBERS_1781195183` with a measured **20.075 SXT** balance delta; SCI table `DEMO_PITCH….TRANSFER` finalized in block `0x00d7c401a32f30cdf122120d4e955d78c543a5933ee7f8d075f56ac6e72e8456`. Re-running either command exercises the AlreadyExists fallback (idempotent).

## Tier 3 — the on-chain pipeline (100 SXT + ~$1 gas)

```bash
sxt verify                                  # MUST pass before proceeding
sxt plan && sxt render
cd ../contracts/sxt-onchain-query && forge build && cd ../../scripts
sxt deploy                                  # gated; ~1.1M gas on Base
sxt query                                   # gated; approve + 100 SXT
```

**Expect:** proof callback (`QueryRow` event) within seconds-to-minutes of `requestQuery`.
**Our evidence (2026-06-11, Base mainnet):** deploy `0x0d893d7d2d5592cf00761168a1d2b13178ee81ee8f227a6bb2d77032884bdbaa` → contract `0x3cE11F70FdDbb69994431c24C74f66D7016f7b73` (block 47203102) → `query()` `0x591f851361c5f3af5561fa880b6645d733f8b40208c72f3c6e57d11652af1066` → **callback `0x5294361fc63e4311df05ea05d5d603687b482d5f2cd5a516ab0c2404f13406ce` in ~8s, 1 verified row.** All publicly inspectable on BaseScan.

Chain-data variant (no publish needed): `sxt chain-plan --table ETHEREUM.TRANSACTIONS --predicate "FROM_ADDRESS = $1 AND TO_ADDRESS = $2" --param-types VARCHAR,VARCHAR --projection TRANSACTION_HASH` → `sxt render --plan … --params` → deploy once → `query(wallet, collection)` for any pair. Parameters use `ParamsBuilder` from SXT's own Solidity client package. Status: plan/render/compile verified by us; the on-chain parameterized callback is the one leg we have not yet run — it would make a good joint test.

## Tier 4 — claims for your review (things your docs don't cover)

Full table with method + evidence in [`docs-conformance.md`](./docs-conformance.md). Highlights:

| Our finding | How we verified | Ask |
|---|---|---|
| `CREATE_COST` = 20 SXT burned per created object (namespace + table), all three creation extrinsics | Pallet source lines 93/591/1187 + live `FundsUnavailable` + measured 20.075 SXT delta | Confirm + document |
| SCI registration is user-callable via `tables.createTableWithSciMetadata`; metadata JSON format `{columns, contract_address, event_signature, starting_position}` | Read from live `tableMetadata` storage; round-tripped our own registration | Confirm the format is stable |
| SCI `Source` enum has no Base variant (docs mention Base indexing) | Live chain metadata | Clarify Base SCI path |
| Proven chain-data surface = `ETHEREUM.BLOCKS` + `TRANSACTIONS` only; rest of catalog → error 254018 | Empirical probes | Roadmap for promotion |
| Prover aggregate regression (null `AttestedCommitments`), recovering per-table; brief global-500 windows | Reproduced across SDK 0.54/0.55 | Known? ETA? |
| `wss://rpc.testnet.sxt.network` never returns `state_getMetadata` (hangs all Substrate clients) | Raw WS probe: small RPCs fine, metadata frame never arrives | Infra fix |
| SDK 0.56.1/0.57.1 ship a broken wasm bundle (`Identifier 'wasm' has already been declared`) | Import fails on Node 24 | Packaging fix |

## Repo verification suite

```bash
sxt preflight                                            # 21 checks
cd examples/scripts && for f in *.mjs; do node --check "$f"; done
cd ../contracts/sxt-onchain-query && forge build
sxt parity
```

All green as of the commit this file ships in. History with evidence: [`CHANGELOG.md`](./CHANGELOG.md).
