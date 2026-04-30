# DreamSpace AI — Live Demo Guide

Three demo tiers, scaling from "works in 30 seconds with zero setup" to "full audit loop with SXT cross-references." Pick the tier that matches your time budget for the pitch meeting.

**Everything below runs from this repo** — the same repo you have open right now (`C:\Users\buster\Desktop\idea-sdk`). There is no second repo. The skill prototypes live at `packages/plugins/` inside this directory.

**The demo is a conversation with Claude, not a standalone script.** You install the skills, ask Claude a question in plain English, and Claude — following the skill's `SKILL.md` instructions — runs the SXT API calls itself via its Bash tool and reports back. The standalone script (`examples/scripts/audit-with-sxt.mjs`) is a *verification tool* you can use to confirm your SXT API key works before doing the Claude demo. It is not the demo itself.

---

## Prerequisites

All demos run from this repo root:

```bash
cd C:\Users\buster\Desktop\idea-sdk
```

You need [Claude Code](https://docs.claude.com/en/docs/claude-code/quickstart) installed and authenticated. That's it for Tier 1.

---

## Tier 1 — Foundations skill (works today, zero setup)

**What it shows**: AI agents correctly stay inside the Proof of SQL surface and refuse queries that can't carry a proof. Demonstrates the skill format, contextual activation, and constraint enforcement.

**Setup**: none.

**Run it**:

```bash
claude --plugin-dir packages/plugins/dreamspace-query
```

**Demo prompts** (try one or both):

> *"Write me a SELECT with ORDER BY against MY_DEX.SWAP_EVENTS and prove it."*

The skill activates contextually. Claude refuses the `ORDER BY`, explains it's outside the proven surface, and offers either a rewrite (filter via `WHERE`, sort client-side) or an unproven fallback.

> *"What can I include in a Proof of SQL query?"*

Claude reads the skill body, returns the proven surface — `SELECT/WHERE/GROUP BY/JOIN`, the supported operators, types, and hard limits.

**What to point out during the demo**: the skill is one Markdown file with YAML frontmatter. Claude Code's `description` field drives auto-activation. No SDK, no API key, no infrastructure. **Skills are docs that agents follow.**

---

## Tier 2 — Skill catalog walkthrough (no extra setup)

**What it shows**: All three skills loaded together so the agent can compose them. Pure conversation, no tools beyond what Claude Code ships with. Demonstrates how the catalog hangs together as a workflow.

**Setup**: same as Tier 1. No additional installs.

**Run it**:

```bash
claude --plugin-dir packages/plugins/dreamspace-data \
       --plugin-dir packages/plugins/dreamspace-query \
       --plugin-dir packages/plugins/dreamspace-contracts
```

**Demo prompt** (one prompt walks all three skills):

> *"I want to audit `./examples/contracts/SampleToken.sol` against a list of known exploits. Walk me through the whole workflow — what data I need to publish, what queries you'd run, and how the proof works."*

Claude composes all three skills into a single response: it pulls the publish flow from `dreamspace-data:dataset-publish`, the proven SQL surface from `dreamspace-query:proof-of-sql-foundations`, and the audit workflow structure from `dreamspace-contracts:pre-deploy-audit`. The output is a step-by-step walkthrough of the whole loop without actually executing any of it.

**What to point out**: the agent already understands the workflow without any external tools. The Tier 3 demo executes what this Tier 2 walkthrough describes.

---

## Tier 3 — Live SXT cross-reference with real proof receipt (~15 min setup)

**What it shows**: The killer demo. A Solidity contract's hash is cross-referenced against a Space and Time table with a Proof of SQL receipt — the receipt is independently verifiable against the on-chain Verifier on Ethereum mainnet. **This is the unique value DreamSpace AI brings that no other tool can.**

**No slither required** — Tier 3 strips static analysis to focus on what only SXT can do: cryptographically proven cross-references against indexed/published data.

**Setup (one-time)**:

1. **Sign up** at https://chain.spaceandtime.io and connect any wallet (MetaMask works).
2. **Fund compute credits**. Click your wallet menu → fund credits with SXT, WETH, USDC, or USDT. A few dollars is plenty for testnet.
3. **Publish the reference table** via the official tutorial UI:
   - On chain.spaceandtime.io, click the "Create a Table of Your Data" tutorial card.
   - Schema: `MY_AUDIT`. Table: `KNOWN_EXPLOITS`. Access mode: `Community` (or `Owner-Permissioned` if you want write protection).
   - Define columns matching `examples/data/known-exploits-sample.csv`:
     - `BYTECODE_HASH VARCHAR NOT NULL`
     - `EXPLOIT_TYPE VARCHAR`
     - `SEVERITY VARCHAR`
     - `SOURCE_URL VARCHAR`
     - `REPORTED_AT TIMESTAMP`
     - Primary key: `BYTECODE_HASH`
   - Upload `examples/data/known-exploits-sample.csv` (already includes a row with the demo-marker hash `0xDEM0DEM0...DEM0`).
   - Sign the Substrate transaction with your wallet to commit.
4. **Get your API key** from the chain.spaceandtime.io dashboard.
5. **Set the env var**:

   ```bash
   export SXT_API_KEY=your_key_here
   ```

### Step A — Verify SXT API works (one-time, ~10 seconds)

Before doing the Claude demo, confirm your SXT API key and published table actually work. Run the verification script:

```bash
node examples/scripts/audit-with-sxt.mjs --demo
```

If you see a "MATCH FOUND" line and a proof receipt, your SXT side is good and you can move on to the actual demo. If something errors, fix it here first — it's much easier to debug a single curl-equivalent than a Claude conversation.

### Step B — The actual demo (Claude conversation, ~30 seconds)

This is the demo you show the team. Open Claude Code in this repo with all three plugins loaded:

```bash
claude --plugin-dir packages/plugins/dreamspace-data \
       --plugin-dir packages/plugins/dreamspace-query \
       --plugin-dir packages/plugins/dreamspace-contracts
```

Make sure `SXT_API_KEY` is in the environment Claude Code inherited.

Then **type this prompt in Claude Code** (or any phrasing close to it — contextual activation will catch it):

> *"Cross-reference the contract at `./examples/contracts/SampleToken.sol` against my `MY_AUDIT.KNOWN_EXPLOITS` table on SxT. Use the demo hash `0xDEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0DEM0` since the published reference row uses that. Run the proven SQL query and show me the proof receipt."*

What happens, step by step:

1. The `pre-deploy-audit` skill activates contextually because the prompt matches its trigger description.
2. Claude reads the skill's `SKILL.md`, finds the "Phase 2 concrete execution recipe" section.
3. Claude calls the Bash tool to run a `curl` against `https://api.makeinfinite.dev/v2/sql` with the demo hash and `proveExecution: true`.
4. Claude parses the JSON response, finds the matching row, finds the proof receipt field.
5. Claude returns a structured verdict: hash, exploit type, severity, source URL, proof receipt, and the Onchain Verifier addresses to verify against.

**That's the demo.** Nothing else for the user to do. Claude reads the skill, runs the call, prints the answer.

### What to point out during the demo

1. **No script ran.** The whole interaction is a Claude Code conversation. The skill's Markdown told Claude what to do; Claude did it.
2. **The proof receipt is the headline.** SXT returns a cryptographic receipt that anyone can independently verify against the Onchain Verifier contract on Ethereum or Base. Static analysis tools cannot produce verifiable receipts.
3. **The reference data is yours, not SxT's.** This demo uses your published `MY_AUDIT.KNOWN_EXPLOITS` — same pattern works for any reference set (drainer wallets, allowlists, signatures from Forta or Rekt News).
4. **The skill scales.** Same skill works against a real bytecode hash, a real exploits table, and a real deployed contract — only the inputs change.

---

## Recording the demo

For a Loom or screen recording the team can watch async:

1. **30-second intro** — show the docs site live (`npm run dev` in another terminal, navigate to `http://localhost:3001/docs/spaceandtime-ai/overview`). Read the proposal banner aloud.
2. **30-second skill install** — show the `claude --plugin-dir` command, point at `packages/plugins/`, mention the `marketplace.json` for the production install path.
3. **45-second Tier 1** — ORDER BY refusal. Watch the skill activate, refuse, suggest a rewrite.
4. **45-second Tier 3** — `node examples/scripts/audit-with-sxt.mjs --demo`. Show the match found. Point at the proof receipt. Read the Onchain Verifier addresses aloud.
5. **15-second wrap** — *"Funding v0.1 ships the other six skills and wires this exact REST call into the audit skill itself."*

Total: 2.5 minutes. That's the artifact for the team.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Skill doesn't activate on a prompt | Use direct invocation: `/dreamspace-query:proof-of-sql-foundations`. The plugin namespace is the prefix. |
| `claude --plugin-dir` errors | Update Claude Code: skills require Claude Code v2.x or later. |
| `audit-with-sxt.mjs --demo` returns 401/403 | Your `SXT_API_KEY` is wrong or expired. Get a fresh one from chain.spaceandtime.io. |
| Returns 404 / "no such table" | The reference table isn't published yet. Walk through Tier 3 step 3 again. Confirm schema name is `MY_AUDIT` and table is `KNOWN_EXPLOITS`. |
| Returns "no match found" | The CSV uploaded didn't include the demo-marker row. Re-upload `examples/data/known-exploits-sample.csv` exactly as shipped — it includes the `0xDEM0...` row. |
| API returns 200 but no proof receipt | Confirm `proveExecution: true` is the correct flag for your SxT API version. The script prints the raw response — paste it to your SxT contact if the field name differs. |
| Compute credits insufficient | Top up via chain.spaceandtime.io. Each query costs a tiny fraction of a credit. |
| `npm view @dreamspace/sdk` returns 404 | Expected — the SDK is part of the proposal, not yet published. Skills do not depend on it. |
| Want static analysis too? | Optional — `pip install slither-analyzer && slither examples/contracts/SampleToken.sol`. Slither is the industry-standard Solidity static analyzer; the production audit skill orchestrates it as one phase, but it's not required for the SXT-side demo. |

---

## What this demo proves to the team

1. **The skill format works against real Claude Code today** (Tier 1).
2. **The full DreamSpace value loop is executable on testnet right now** (Tier 3) — publish your reference data, query it with proof, get a receipt that the SxT Onchain Verifier on Ethereum or Base can independently check.
3. **The proof receipt is the unique value.** Static analyzers, AI auditors, and chain explorers cannot produce verifiable receipts. SxT can. DreamSpace AI is the agent layer that makes that capability accessible.
4. **Zero new SxT Foundation infrastructure required.** Every Tier 3 step uses public, working SxT primitives. The proposal funds skill authoring, not new APIs.

The decision in front of the team is small: accept the proposal and we ship the other six skills, wire the Tier 3 REST call directly into the audit skill, and migrate to a dedicated `dreamspace-ai` repo.
