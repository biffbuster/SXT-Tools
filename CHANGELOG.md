# Changelog

## Unreleased (2026-11-24)

### Verified
- Hosted MCP clients against the staging Worker, each with OAuth sign-in on
  its own SXT key:

  | Client | Sign-in | Tools listed | Verified proof |
  |---|---|---|---|
  | Claude (claude.ai, Claude Code) | yes | yes | yes, 2026-11-19 (IRIS GROUP BY) |
  | Codex | yes | yes | IRIS `0a6a9065-d886-4f8c-b31c-7ef3dccbde92`, BLOCKS `ee6cb902-aab2-4cf1-9601-cddc4ea0a5e7` |
  | ChatGPT | yes | yes | yes, 2026-11-23 |
  | Cursor | yes, after #13 | yes, all five | not run: the Agent needs a model the free plan did not unlock |

  The dotted tool names (`sxt.list_tables`) did not block any of them.

### Fixed
- Cursor sign-in left the browser blank or stuck on the consent page. The
  consent page's CSP `form-action` applied to every redirect after Connect,
  and Cursor's callback chains through `www.cursor.com`, `cursor.com` and
  `http://localhost:8787/callback`. The directive is removed; the page keeps
  `default-src 'none'`, escaped values and the Origin check (#12, #13).
- Resuming an expired queryId, or one from another SXT key, returned a
  retryable `UPSTREAM_ERROR`. It now returns non-retryable `QUERY_NOT_FOUND`
  (#11).

### Changed
- Successful tool calls log the proof `status` and `queryId`, so a pending
  proof is distinguishable from a verified one (#10).
- Setup docs: ChatGPT custom servers live under Plugins (Developer mode is no
  longer required); Cursor needs a signed-in Cursor account before
  Authenticate works.
- Stale content: the `chain-data-query` skill body now matches the
  2026-11-19 surface (three proving tables, BLOCKS examples, real
  `query-onchain.mjs --args` flag); `proof-of-sql-foundations`, the plugin
  README and HOW_IT_WORKS no longer list `ETHEREUM.TRANSACTIONS` as proving.
  Off-chain pre-flights are described as one query credit, not free.

### Removed
- `WalletActivityProver.sol`: built on `ETHEREUM.TRANSACTIONS` with an
  ungrouped `COUNT(*)`, so it could never fulfill.

### Known
- Cursor's desktop callback listens on port 8787, the default port of
  `wrangler dev` (`npm run dev:worker`). While a local Worker runs, Cursor's
  MCP sign-in fails for every server.

## Unreleased (2026-11-19)

### Fixed
- Verified DECIMAL(75) values above 2^53 (wei balances, token amounts) were
  rounded by the verifier's JSON hand-off, so their rows were dropped. They
  now decode exactly (`withExactIntegers` in the MCP's `lib/prover.ts`).
- Hosted sign-in from browsers: the consent page's `Referrer-Policy:
  no-referrer` made the form post `Origin: null`, which the origin check
  rejected.

### Changed
- SXT table coverage, from one live proof per table: `ETHEREUM.BLOCKS`,
  `NATIVE_WALLETS` and `ERC173_OWNERSHIP_TRANSFERRED` prove and are listed.
  Ten more SXT tables join `ETHEREUM.TRANSACTIONS` as refused before
  submission (they fail at execution, even with a narrow WHERE). Five large
  tables are marked unverified and three empty ones are noted.
- `QUERY_FAILED` errors include the prover `queryId` on the hosted surface.
- BLOCKS examples use blocks in the indexed range (from 22,432,845).

## Unreleased (2026-11-17)

### Added
- MCP `sxt.list_tables` lists every public community table via the
  MakeInfinite discovery API, falling back to the curated list when the API
  or the key is unavailable. `sxt.run_proven_query` works on any public
  table, with a free planner preflight, a large-table guard and decoded rows.
- CLI: `sxt tables`, `sxt verify --table/--sql`; `sxt chain-plan` reads
  columns live and works on community tables.

### Changed
- **Plugins renamed** `dreamspace-data` → `sxt-data`, `dreamspace-query` →
  `sxt-query`, `dreamspace-contracts` → `sxt-contracts`. Install IDs changed
  (e.g. `sxt-data@sxt-tools`): uninstall the old plugins and install the new.
- Only aggregates without GROUP BY are refused (grouped ones verified).
- `ETHEREUM.TRANSACTIONS` is refused: its proofs fail at the prover.

### Removed
- `docs/BETA.md`, `docs/REVIEW.md`, `docs/docs-conformance.md` (stale
  beta-era documents), the TRANSACTIONS-based `CollectionActivity` example,
  and unused images in `public/`.

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
