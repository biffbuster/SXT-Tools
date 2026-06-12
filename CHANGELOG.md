# Changelog

## Unreleased (post-beta.1 battle-test pass, 2026-06-11)

### Added
- **`sxt` unified CLI** (`examples/scripts/sxt.mjs`, bin entry in its
  package.json — `npm link` → `sxt <command>`): thin dispatcher over the
  battle-tested scripts (`sxt status|publish|index|verify|plan|render|deploy|
  query|inspect|balance|demo|parity|pipeline`), with per-command cost labels
  and a community-tool disclaimer. No new protocol logic — the scripts remain
  the audit surface.
- `publish-dataset-cli.mjs`: pre-submit creation-burn check (clear fail-fast
  message + funding instructions instead of a cryptic `FundsUnavailable`).
- Retry-once on transient cold-connection failures in `verify-table.mjs`
  (the zero-cost gate must not spuriously fail before a 100 SXT spend).

### Fixed
- **SCI handoff no longer breaks the CSV pipeline:** `render-onchain-query`,
  `save-proof-plans`, and `verify-table` now ignore a `kind: "indexed-sci"`
  `.last-publish.json` (SCI tables aren't provable yet) instead of resolving
  defaults to an unprovable table. Found live when an SCI registration
  clobbered a fresh publish's handoff.

### Verified live on mainnet (2026-06-11)
- **Full pipeline end-to-end:** publish 2,062 rows → plans → render → deploy
  (`0x3cE11F70FdDbb69994431c24C74f66D7016f7b73`, Base block 47203102) →
  off-chain proof gate (positive + negative) → on-chain `query()`
  (`0x591f8513…af1066`) → **proof callback fired in ~8s**
  (`0x5294361f…3406ce`, 1 verified row).
- **Live SCI registration:** `DEMO_PITCH….TRANSFER` finalized
  (`0x00d7c401…e8456`); on-chain metadata round-trips byte-exact; the
  namespace-AlreadyExists fallback path exercised live.
- **Creation burn measured exactly:** 20.075 SXT balance delta for one table
  in an existing namespace = 20 SXT `CREATE_COST` burn + 0.075 fees. Applies
  to `create_namespace`, `create_tables` (per table), and SCI creation
  (pallet source lines 93/591/1187); README/BETA funding numbers updated
  (first publish = 40 SXT).
- Prover aggregate recovery is rolling out per-table: `ETHEREUM.BLOCKS`
  aggregates prove again; `ETHEREUM.TRANSACTIONS` + user tables still return
  the null-AttestedCommitments error.

All notable changes to the sxt-tools marketplace (root package + the three
`dreamspace-*` plugins). The MCP server (`packages/mcp/sxt-mcp/`) versions
independently per its phased rollout in `packages/mcp/sxt-mcp/SAFETY.md`.

## 0.2.0-beta.1 — 2026-06-10 (private beta)

First gated release: installable by invited beta members while the repo is
private. See `BETA.md` for onboarding and the GA promotion checklist.

### Added
- **`examples/scripts/index-contract.mjs`** — Smart Contract Indexing (SCI)
  registration via CLI. Submits the same `tables.createTableWithSciMetadata`
  extrinsic the chain.spaceandtime.io Studio UI uses (verified against live
  SXT mainnet chain state). Two input modes: keyless `--event-signature`
  (recommended) and verified-ABI fetch via Etherscan v2 (`--events` +
  `ETHERSCAN_API_KEY`). `--dry-run` prints DDL, metadata JSON, and encoded
  extrinsics without signing; mainnet writes require typing `mainnet`.
  Writes the `.last-publish.json` handoff with `kind: "indexed-sci"`.
  Reserved SQL words in event params auto-rename (`from`/`to` →
  `FROM_ADDRESS`/`TO_ADDRESS`, matching SXT's pre-indexed table naming).
- `CHANGELOG.md` (this file) and `BETA.md` (beta onboarding + GA checklist).
- `docs-conformance.md` — full SXT documentation conformance audit with
  live-chain evidence; re-run before each release.
- `.env.example`: documented `ETHERSCAN_API_KEY` (only needed for
  `index-contract.mjs --events` mode).

### Fixed
- **Four SKILL.md files had corrupted frontmatter fences** (`--` instead of
  `---`: dataset-publish, chain-data-query, run-proven-query,
  pre-deploy-audit) — they failed frontmatter parsing and likely did not load
  as plugin skills at all.
- **MCP server build was broken** — `src/tools/run-proven-query.ts` opened
  with `**` instead of `/**` (same corruption family), failing `tsc` and
  therefore `npm install` (postinstall) on every fresh clone.
- `preflight.mjs` npm-pack check crashed on Windows (`spawnSync("npm")`
  ENOENT); now uses `shell: true` and guards missing stderr.
- Root `tsconfig.json` now excludes `packages/` and `examples/` so
  `next build` type-checks only the docs site (it was failing on MCP
  sources targeted at a different TS config).

### Discovered (live-chain, documented in docs-conformance.md)
- **SCI table creation burns 20 SXT per table** for non-privileged accounts
  (`CREATE_COST` in the sxt-node tables pallet) — undocumented by SXT; hit
  live as a `FundsUnavailable` dispatch error. CLI plan output, mainnet
  prompt, SKILL.md, and BETA.md all state it now.
- The SXT **testnet** WS RPC never returns `state_getMetadata` (large frame),
  hanging every standard polkadot-js client. `index-contract.mjs` works
  around it by prefetching metadata over HTTP and passing it to
  `ApiPromise.create` as a cache.

### Changed
- `index-contract` SKILL.md rewritten from "planned CLI" to real usage docs.
  Chain support corrected to the SXT chain's actual `Source` enum
  (`ethereum`, `sepolia`, `polygon`, `zksync`) — **Base is not a Source
  variant on-chain** despite earlier claims; `--chain base` is rejected with
  an explanatory error. The "SCI tables are not yet zk-proven" status
  honesty is unchanged — registration + ingestion work today, Proof-of-SQL
  against SCI tables does not.
- `HOW_IT_WORKS.md` index-contract section: CLI-first flow; removed the
  incorrect historical-backfill claims (SCI is live-only today).
- `CLAUDE.md`: skill roster updated to seven (adds `index-contract`);
  corrected the note about the canonical sxt-chain-examples tutorial (it
  targets testnet — our mainnet default is a deliberate divergence).
- Docs catalog (`/docs`): plugin cards now list all 7 skills (previously
  undercounted dreamspace-data and dreamspace-query).
- Version bumped to 0.2.0-beta.1 across root `package.json`,
  `marketplace.json`, and the three plugin manifests.

### Verified (doc-conformance audit, June 2026)
- QueryRouter `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB` (Base + Ethereum),
  Verifier Base `0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518` / Ethereum
  `0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9`, SXT token Base
  `0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8` / Ethereum
  `0xE6Bfd33F52d82Ccb5b37E16D3dD81f9FFDAbB195`, and the `version` constant
  `keccak256("latest")` all match docs.spaceandtime.io.
- Publish flow (batchAll createNamespace+createTables → indexing.submitData,
  NOT NULL / no PRIMARY KEY, `{ Empty: { hyperKzg: true } }`, EthEcdsaSigner)
  matches the canonical spaceandtimefdn/sxt-chain-examples tutorial.

## 0.1.0 — 2026-06 (unreleased baseline)

Initial state: three plugins / seven skills, full CSV → Proof-of-SQL-on-Base
pipeline (`publish → save-proof-plans → render → deploy → query`), MCP server
v0.1.0 (4 tools, mainnet double-gate), docs site, demo orchestrators
(`preflight`, `demo-rehearsal`, `demo-fullpipeline`, `mcp-parity-test`).
