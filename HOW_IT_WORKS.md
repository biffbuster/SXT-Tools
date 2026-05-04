# How the SXT Toolkit Works

A from-scratch explanation of how an AI coding agent — Claude Code, in our reference implementation — uses the five SXT Toolkit skills to take a CSV from a local folder to a cryptographic proof event on Base mainnet, **without the user writing any code**.

This is the architectural companion to the [`README.md`](./README.md): how the pieces fit, what the agent reads, and what gets executed at each step.

---

## The four moving parts

```
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│   You (CLI prompt)   │    │   AI agent runtime   │    │  Skill files (.md)   │
│                      │    │   (Claude Code)      │    │  packages/plugins/…  │
└──────────┬───────────┘    └──────────┬───────────┘    └──────────┬───────────┘
           │                            │                           │
           │  "publish my CSV and       │                           │
           │   prove that 0xABC… is     │                           │
           │   a member"                │                           │
           ├───────────────────────────►│                           │
           │                            │                           │
           │                            │  matches trigger phrases  │
           │                            ├──────────────────────────►│
           │                            │  reads SKILL.md           │
           │                            │◄──────────────────────────┤
           │                            │                           │
           │                            │  follows the instructions │
           │                            │  inside the skill — runs  │
           │                            │  the example scripts as   │
           │                            │  a Bash subprocess        │
           │                            │                           │
           │                            ▼                           │
           │                  ┌──────────────────────┐              │
           │                  │  examples/scripts/   │              │
           │                  │  publish-dataset…    │              │
           │                  │  save-proof-plans…   │              │
           │                  │  deploy-…  query-…   │              │
           │                  └──────────┬───────────┘              │
           │                            │                           │
           │                            │  calls live networks      │
           │                            ▼                           │
           │                ┌────────────────────────┐              │
           │                │  SXT chain (Substrate) │              │
           │                │  Base mainnet (EVM)    │              │
           │                │  api.makeinfinite.dev  │              │
           │                └────────────┬───────────┘              │
           │                            │                           │
           │  proof event hash +        │                           │
           │  4 tx hashes               │                           │
           │◄───────────────────────────┘                           │
           │                                                        │
```

The key insight: **the skills are pure Markdown.** They contain instructions in natural language for the agent to follow, not code to execute. The actual on-chain work is done by the example scripts under `examples/scripts/` — node.js programs the user could run by hand. The skill's job is to know *which script to run, with what arguments, in what order, when to stop and confirm with the user, and how to interpret the output*.

That separation is what makes the toolkit portable: the skills work in any agent that reads `SKILL.md` files. We ship a Claude Code marketplace as the first runtime, but the skill bodies have no Claude-specific assumptions.

---

## The five skills, and what each one knows how to do

```
packages/plugins/
├── dreamspace-data/
│   └── skills/dataset-publish/SKILL.md
├── dreamspace-query/
│   └── skills/
│       ├── proof-of-sql-foundations/SKILL.md
│       └── run-proven-query/SKILL.md
└── dreamspace-contracts/
    └── skills/
        ├── deploy-contract/SKILL.md
        └── pre-deploy-audit/SKILL.md
```

Each `SKILL.md` is loaded by the agent when its trigger phrases match the user's prompt. The agent reads the body and follows the instructions verbatim. Below: what each skill enables Claude to do *without you knowing the underlying scripts exist*.

### `dreamspace-data:dataset-publish` — "publish this CSV"

**Triggers on:** "publish my CSV", "upload this dataset to SXT", "create a new table on Space and Time", "I have a CSV I want to query with proofs."

**What Claude does after activating this skill:**

1. Asks you for the CSV path (or finds it from your prompt).
2. Reads the CSV header row to derive the column list.
3. Either reads your `schema.json` (if you have one) or **infers** types from the first row of data.
4. Generates the namespace name automatically: `<YOUR_PREFIX>_<YOUR_WALLET_ADDRESS_UPPERCASE>` — required by the SXT chain rule.
5. Writes a CREATE TABLE DDL with all columns `NOT NULL` and **never** a `PRIMARY KEY` clause (the skill enforces this rule because adding a PK silently breaks the dreamspace MAINNET indexer — see the Troubleshooting table in `README.md`).
6. Runs `examples/scripts/publish-dataset-cli.mjs` as a Bash subprocess with your CSV path + namespace + schema args.
7. Watches the script output for the two finalization confirmations (`createTable batch finalized`, `insert finalized`) and reports them to you.
8. Tells you the table reference to use in subsequent steps.

**What you see in the conversation:** a confirmation that your CSV is now a chain-secured table with row count, plus the table reference (`MY_PROJECT_<ADDR>.MY_TABLE`).

### `dreamspace-query:proof-of-sql-foundations` — the constraint guardrail

**Triggers on:** any time another skill is generating SQL. Activates passively as a check, not via direct user invocation.

**What it does:** holds the Proof-of-SQL surface area in the agent's context — `SELECT/WHERE/GROUP BY`, single-chain `JOIN`, `=/≥/≤`, `AND/OR/NOT`, `+/-/*`, `SUM/COUNT`, types `BOOLEAN/BIGINT/VARCHAR/DECIMAL75/TIMESTAMP`. When `run-proven-query` (below) translates your goal into SQL, this skill is the rubric Claude checks against. If your goal needs `ORDER BY`, `LIMIT`, `AVG`, `DISTINCT`, subqueries, or cross-chain joins, this skill **refuses and offers a rewrite** — saving you from spending 100 SXT on a query the executor would silently drop.

**What you see in the conversation:** if your request is in-bounds, nothing — the skill is silent. If out-of-bounds, Claude says *"that needs `ORDER BY` which isn't provable. I can rewrite it as `WHERE x = …` instead, which IS provable, or run it unproven if you only want exploration."*

### `dreamspace-query:run-proven-query` — "prove this row is in my table"

**Triggers on:** "prove that 0xABC… is in my table", "verify the row count", "run a proven query", "is X a member of my dataset?"

**What Claude does:**

1. Confirms which table you mean (asks if ambiguous).
2. Translates your goal into a single SQL string using the proven surface (cross-checked against `proof-of-sql-foundations` above).
3. Either runs the off-chain prover via REST (`/v1/zkquery`, ~1 second, no SXT cost) **or** prepares the on-chain path — your choice. The skill explains both:
   - **REST:** API-key→JWT exchange, submit, poll status, fetch result + HyperKZG proof. JSON receipt.
   - **On-chain:** generate hex proof plan, render Solidity contract, deploy, call `query()` with 100 SXT, watch for the `QueryFulfilled` callback. Trustless event on Base.
4. Surfaces both the result and the proof bytes (or the on-chain transaction hashes) in a structured block.

**What you see in the conversation:** the proven row, the proof's chain-state binding, and either an API receipt or four BaseScan-linkable tx hashes — depending on which path you chose.

### `dreamspace-contracts:deploy-contract` — "deploy this contract"

**Triggers on:** "deploy this Solidity contract", "deploy to Base / Sepolia / mainnet", "ship this query contract."

**What Claude does:**

1. Asks which network (Base mainnet by default — refuses without explicit "yes deploy to mainnet" confirmation).
2. Inspects your contract source to detect constructor arguments and prompt for them.
3. Estimates gas via `forge`.
4. Runs `examples/scripts/deploy-onchain-query.mjs` — wraps `forge create` with `.deploy-state.json` for idempotency (so a second run doesn't redeploy by accident).
5. Verifies on Etherscan/BaseScan if `ETHERSCAN_API_KEY` is set.
6. Reports the deployed address + tx hash.

**What you see:** a deployed contract address and the deploy tx, plus a hint about the next step (approve + call query()).

### `dreamspace-contracts:pre-deploy-audit` — "audit this before mainnet"

**Triggers on:** "audit this contract", "check this for safety", "is this safe to deploy", "cross-reference against known exploits."

**What Claude does:**

1. Runs `slither` static analysis on the source.
2. Computes the bytecode hash and queries any user-published reference tables (e.g., a known-exploits CSV you've published via `dataset-publish`) for matches.
3. Cross-references the deployer wallet against drainer-wallet allowlists if you've published one.
4. Produces a structured audit report — refuses to certify "safe", but presents the evidence the user reviews.

**What you see:** a markdown audit report with green/yellow/red findings and a recommendation. If anything is yellow or red, the skill asks you to confirm before recommending deployment.

---

## A complete demo conversation, step by step

This is what an end-to-end session looks like in the Claude Code CLI. The user types six natural-language prompts; Claude does the rest.

```
┌─ User ────────────────────────────────────────────────────────────────┐
│ I want to publish examples/data/sxt_stakers.csv to Space and Time so  │
│ I can prove on-chain that specific addresses are members of it.        │
└────────────────────────────────────────────────────────────────────────┘

┌─ Claude (loads dreamspace-data:dataset-publish) ──────────────────────┐
│ I'll publish this dataset to the SXT chain. Looking at the CSV I see  │
│ one VARCHAR column STAKER with 2062 rows.                             │
│                                                                       │
│ I'll publish under namespace MY_AUDIT_V2.STAKERS — your wallet's      │
│ address gets auto-suffixed per chain rule. The DDL will be:           │
│                                                                       │
│   CREATE TABLE MY_AUDIT_V2_<wallet>.STAKERS (STAKER VARCHAR NOT NULL) │
│                                                                       │
│ No PRIMARY KEY — that's intentional, it would block the dreamspace    │
│ indexer from promoting your table to MAINNET. Cost: ~0.001 SxT chain  │
│ native. OK to proceed?                                                │
└────────────────────────────────────────────────────────────────────────┘

┌─ User ────────────────────────────────────────────────────────────────┐
│ Yes                                                                    │
└────────────────────────────────────────────────────────────────────────┘

┌─ Claude (runs publish-dataset-cli.mjs as a subprocess) ───────────────┐
│ Running:                                                              │
│   $ node publish-dataset-cli.mjs ../data/sxt_stakers.csv \            │
│         MY_AUDIT_V2.STAKERS                                           │
│         --schema ../data/sxt_stakers.schema.json                      │
│                                                                       │
│ ✓ createTable batch finalized in block 0xfdb9d3c9…                    │
│ ✓ insert finalized in block 0x0979eee1…                                │
│ ✓ Published 2062 rows to MY_AUDIT_V2_<wallet>.STAKERS                 │
│                                                                       │
│ Table is on chain. Indexer typically promotes to MAINNET in ~30 sec.  │
└────────────────────────────────────────────────────────────────────────┘

┌─ User ────────────────────────────────────────────────────────────────┐
│ Now prove on-chain that 0x45c5e138881fd3ff46359ba1826d5fc6fccaedc      │
│ is a member of that table. I want it as a Base mainnet event.          │
└────────────────────────────────────────────────────────────────────────┘

┌─ Claude (loads dreamspace-query:run-proven-query) ────────────────────┐
│ This is the on-chain proof path. Plan:                                │
│                                                                       │
│ 1. Generate hex proof plan via the SXT chain RPC (free)               │
│ 2. Render an OnchainQuery.sol contract baking that plan in (free)     │
│ 3. Deploy to Base (~$0.50 ETH gas)                                    │
│ 4. Approve 100 SXT, call query(), wait for the executor callback     │
│    (100 SXT)                                                          │
│                                                                       │
│ Before spending the 100 SXT, I'll run the off-chain pre-flight        │
│ (zero cost, ~1 sec) — if the prover backend can return a proof, the   │
│ on-chain executor will too. Proceed with the pre-flight?              │
└────────────────────────────────────────────────────────────────────────┘

┌─ User ────────────────────────────────────────────────────────────────┐
│ Yes                                                                    │
└────────────────────────────────────────────────────────────────────────┘

┌─ Claude (runs verify-stakers.mjs) ────────────────────────────────────┐
│ ✓ JWT obtained from /auth/apikey                                      │
│ ✓ Best attested SXT block: 0x83e8f250…                                 │
│ ✓ Submitted /v1/zkquery → 202 Accepted                                │
│ ✓ Status: queued → done (1 poll, 1.2 sec)                             │
│ ✓ Proof returned: HyperKZG, success=true                              │
│ ✓ Result: 1 row, STAKER = 0x45c5…aedc                                  │
│                                                                       │
│ Pre-flight passes. Same prover backend as the on-chain executor →    │
│ the on-chain query() will fulfill. Want me to proceed with the        │
│ render → deploy → query sequence (~$0.50 ETH + 100 SXT)?              │
└────────────────────────────────────────────────────────────────────────┘

┌─ User ────────────────────────────────────────────────────────────────┐
│ Yes                                                                    │
└────────────────────────────────────────────────────────────────────────┘

┌─ Claude (runs the four-step pipeline) ────────────────────────────────┐
│ ✓ save-proof-plans.mjs: 3 plans regenerated against MY_AUDIT_V2       │
│ ✓ render-onchain-query.mjs: OnchainQuery.sol updated                  │
│ ✓ forge build: clean                                                  │
│ ✓ deploy-onchain-query.mjs: deployed at 0x1fc02a8d… (block 45564048)  │
│ ✓ query-onchain.mjs: approve 100 SXT… query()… polling…               │
│ ✓ QueryRow callback fired in 3 blocks (~6 sec)                        │
│                                                                       │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                        │
│   ✅ ON-CHAIN PROOF OF SQL CALLBACK FIRED                              │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                        │
│                                                                       │
│   QueryRow event:                                                     │
│     arg0: 0x45c56e138881fd3ff46359ba1826d5fc6fccaedc                  │
│                                                                       │
│   Verdict: 1 verified row(s) returned for the proven query.           │
│                                                                       │
│ Demo artifacts:                                                       │
│   Deploy:        0xe4c84044…                                          │
│   Approve:       0x1f01c094…                                          │
│   requestQuery:  0x9ae67b2d…                                          │
│   QueryFulfilled callback: 0xd702a401…                                │
│   Contract: 0x1fc02a8dc0A4050B2DA5D075838F37705fcF0Aa1                │
└────────────────────────────────────────────────────────────────────────┘
```

The user typed three short prompts. Claude orchestrated five protocol-aware skills, ran six scripts as subprocesses, exchanged auth credentials with two REST APIs, signed two Substrate extrinsics on the SXT chain, deployed a Solidity contract, paid 100 SXT in ERC-20 to a router contract, and surfaced the resulting verifiable on-chain event — all while gating each spend behind a confirmation.

---

## Why this works as an open-source toolkit

Three properties make the SXT Toolkit composable into anyone's project:

### 1. The skills are agent-runtime-agnostic

Each `SKILL.md` is a Markdown file with YAML frontmatter naming the skill and listing trigger phrases. The body is natural-language instructions plus example bash/JavaScript code blocks. That format is portable — Cursor, Aider, future agent runtimes that adopt the SKILL convention can all consume the same files.

We ship a Claude Code marketplace (`.claude-plugin/marketplace.json`) as the first runtime. The skills themselves have **no Claude-specific code or assumptions**. Install them anywhere a SKILL.md reader exists.

### 2. The example scripts are the canonical implementation

`examples/scripts/` is not a "demo dump" — it's the reference implementation the skills point to. Every script is:
- Self-contained (one purpose per file)
- Argument- and env-driven (no hardcoded user state in the source)
- Idempotent or clearly stateful (`.deploy-state.json`, `.last-rendered.json`)
- Observable (prints what it's doing, exits cleanly on failure)

When Claude follows a skill's instructions, it runs these scripts as subprocesses. When you want to run the same flow without an agent — `node bootstrap.mjs --run` does it directly. The agent path and the manual path use the same code.

### 3. Skills compose freely across plugins

The five skills are split across three plugin packages so you can install only what you need:

| Plugin | When to install |
|---|---|
| `dreamspace-data` | You want to publish CSV → SXT chain |
| `dreamspace-query` | You want to run proven SQL (off-chain or on-chain) |
| `dreamspace-contracts` | You want to deploy/audit Solidity contracts that consume Proof of SQL |

Install one, two, or all three:

```
/plugin marketplace add biffbuster/sxt-tools
/plugin install dreamspace-data@sxt-tools
/plugin install dreamspace-query@sxt-tools
/plugin install dreamspace-contracts@sxt-tools
```

A project doing only off-chain analytics installs `dreamspace-data` + `dreamspace-query` and skips contracts entirely. A project deploying audited contracts that consume SXT data installs all three. The skills cross-reference each other via "pairs with" sections in their bodies, so the agent knows which other skill to load when one's job ends.

---

## Setup checklist for installing into your own project

```bash
# 1. Add the marketplace and install the plugins you need
/plugin marketplace add biffbuster/sxt-tools
/plugin install dreamspace-data@sxt-tools
/plugin install dreamspace-query@sxt-tools
/plugin install dreamspace-contracts@sxt-tools

# 2. Have these credentials ready (for any project, not just this repo)
#    PRIVATE_KEY        ETH key, separate from your daily wallet
#    SXT_API_KEY        from app.spaceandtime.ai → Account → API Authentication

# 3. Have these network funds in the same wallet
#    - SxT chain native (~10 SxT — covers many publishes)
#    - Base ETH (~0.005 ETH per full demo run)
#    - Base SXT ERC-20 (≥100 SXT per query() call)
#      token: 0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8

# 4. Talk to your agent in plain English
#    - "Publish my CSV at ./data/exploits.csv to SXT"
#    - "Prove on-chain that this contract address appears in my exploits table"
#    - "Audit this contract before deploying"
```

The agent loads the relevant SKILL.md, asks for any missing details, and runs the same scripts our reference demo runs. No source-code edits required to use your own data — `SXT_TABLE`, `SXT_POINT_LOOKUP`, `SAMPLE_STAKER` env vars in `.env` parameterize the pipeline.

---

## What you're paying the agent for

The agent's value isn't typing commands you couldn't type yourself. It's:

1. **Knowing the right script for your goal.** Five skills, eight scripts, multiple combinations. Claude picks correctly because the SKILL.md files describe their triggers precisely.
2. **Enforcing protocol-level rules** that aren't checked by the chain or the API but break the pipeline silently — "no `PRIMARY KEY` in the DDL", "`MAINNET` is the only valid `sourceNetwork`", "exchange API key for JWT before any REST call". These are encoded in the skill bodies and the script defaults.
3. **Refusing unprovable queries** before you spend 100 SXT discovering the executor will silently drop them. `proof-of-sql-foundations` is the airtight refusal layer.
4. **Gating real-money operations** behind confirmations. Every deploy and every `query()` requires explicit approval — the skills' instructions tell the agent to stop and ask.
5. **Surfacing verifiable evidence**, not just "it worked". Every successful proof returns the four tx hashes you can paste into BaseScan.

That's why this is an *agent toolkit*, not a CLI. The CLI is open-source underneath — you can run any script by hand. The agent layer is what turns "I have a CSV and I want a Base event proving X" into one prompt.

---

## Where to go next

- **`README.md`** — the entry point. Quickstart, prerequisites, troubleshooting.
- **`packages/plugins/<plugin>/skills/<skill>/SKILL.md`** — each skill's full body. These are the instructions Claude actually reads.
- **`examples/scripts/README.md`** — the script-by-script reference for the underlying CLI.
- **`spaceandtimefdn/sxt-chain-examples`** — the canonical SXT publishing tutorial. Our publish flow mirrors it exactly (verified end-to-end).
