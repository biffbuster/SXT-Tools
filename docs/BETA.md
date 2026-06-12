# sxt-tools private beta — onboarding

Welcome! You're one of a small group with access while the repo is private.
Version under test: **v0.2.0-beta.1** (see `CHANGELOG.md`).

The goal of this beta: confirm a fresh user can go from clone → verified
Proof-of-SQL result in under 10 minutes, without help from the maintainer.

## What this is

A Claude Code marketplace (3 plugins, 7 skills) + CLI pipeline that takes a
CSV or an EVM smart contract from a local folder to a verifiable
Proof-of-SQL event on Base mainnet via Space and Time chain. Architecture
deep-dive: `HOW_IT_WORKS.md`. Overview: `README.md`.

## Prerequisites

- **Node 20+** (`node --version`)
- **Git auth to GitHub** (you were invited as a collaborator — accept the
  invite email first)
- Optional, only for the contract-deploy path: **foundry** (`forge`)

## Install (5 minutes, free, no wallet)

```bash
git clone https://github.com/biffbuster/sxt-tools.git
cd sxt-tools
npm install          # postinstall builds the MCP server + installs script deps
cp examples/scripts/.env.example examples/scripts/.env
# Edit examples/scripts/.env → set SXT_API_KEY
#   (free signup at https://chain.spaceandtime.io → API Authentication)
npm run demo
```

`npm run demo` runs a read-only rehearsal: a real HyperKZG-proven SQL query
against the canonical STAKERS table through the same prover and on-chain
Verifier the full pipeline uses. **No wallet, no spend.** If this works,
the install is good.

### Claude Code plugin install (the actual product)

```
/plugin marketplace add biffbuster/sxt-tools
/plugin install dreamspace-data@sxt-tools
/plugin install dreamspace-query@sxt-tools
/plugin install dreamspace-contracts@sxt-tools
```

Then ask Claude things like "run a proven query against the STAKERS table"
or "publish this CSV to Space and Time" and watch which skill activates.

## Opt-in: the spend paths (only if you want to test them)

| Path | Cost | Command |
|---|---|---|
| Full pipeline rehearsal (publish → prove, no on-chain query) | **20–40 SXT burned** (the chain burns 20 SXT per created object: namespace + each table) + ~0.001 ETH deploy gas | `npm run demo:fullpipeline:rehearse` |
| On-chain proof climax | 100 SXT + ~$0.50 ETH gas | `cd examples/scripts && node query-onchain.mjs` |
| SCI contract registration (new in this beta) | **20 SXT burned per table** (+20 if the namespace is new; + ≥100 SXT/table later to start the indexer) | `node examples/scripts/index-contract.mjs --help` |

Every spend is gated behind an explicit confirmation prompt. Run
`node examples/scripts/bootstrap.mjs --status` to check wallet funding first.

## Known limitations (please don't file these)

- **SCI tables are not zk-provable yet** — `index-contract.mjs` registers
  ingestion; Proof-of-SQL against the resulting tables 422s until SXT
  promotes SCI to the proven surface ("coming soon" per SXT docs).
- **The empirically proven Ethereum surface is narrow** — only
  `ETHEREUM.BLOCKS` and `ETHEREUM.TRANSACTIONS` round-trip the prover
  end-to-end today.
- **`--chain base` is rejected by index-contract.mjs** — the SXT chain's
  Source enum has no Base variant yet.
- **The MCP server is community-built** and not endorsed by Space and Time;
  it stays `private: true` on npm pending review (`packages/mcp/sxt-mcp/SAFETY.md`).

## What feedback we want

1. **Time-to-first-proof:** how long from `git clone` to `npm run demo`
   passing? Where did you stall?
2. **Skill activation quality:** did Claude pick the right skill for your
   phrasing? Paste any miss.
3. **Anything that cost you money you didn't expect.** (There should be
   nothing — every spend is behind a prompt. If not, that's a P0.)
4. **Docs honesty check:** anywhere the docs promised something the tool
   didn't deliver.

File issues on the repo, or message the maintainer directly.

---

## GA promotion checklist (maintainer)

Beta exit signal — promote when ALL of:
- [ ] 3+ beta members complete `npm run demo` without maintainer help
- [x] 1+ full pipeline run completes (publish → on-chain query) — **maintainer,
      2026-06-11:** fresh table `DEMO_PITCH….MEMBERS_1781195183` (2,062 rows,
      exact 20 SXT creation burn measured on-chain), contract
      `0x3cE11F70FdDbb69994431c24C74f66D7016f7b73` on Base, `query()` tx
      `0x591f8513…af1066`, proof callback `0x5294361f…3406ce` fired in ~8s
      with 1 verified row
- [ ] 0 open P0s (unexpected spend, secret leak, broken install)
- [x] One live `index-contract.mjs` registration on mainnet — **maintainer,
      2026-06-11:** `DEMO_PITCH….TRANSFER` (Pudgy Penguins) finalized in block
      `0x00d7c401…e8456`; on-chain `tableMetadata` round-trips byte-exact
      (indexer not funded — registration validation only)

Promotion steps:
1. Address beta feedback; land fixes on `main`
2. Bump `0.2.0-beta.1` → `0.2.0` in root `package.json`, `marketplace.json`,
   and the three plugin manifests; update `CHANGELOG.md`
3. Re-run the verification suite (`CLAUDE.md` → Verification commands) and
   `node examples/scripts/preflight.mjs`
4. Tag `v0.2.0`, push the tag
5. Flip the repo public: `gh repo edit biffbuster/sxt-tools --visibility public`
6. Remove the beta banner from `README.md` (if added) and announce
