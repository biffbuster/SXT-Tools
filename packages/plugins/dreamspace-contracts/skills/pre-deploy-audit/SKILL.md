---
name: pre-deploy-audit
description: Pre-deployment and post-deployment Solidity contract audit. Combines slither static analysis with Space and Time onchain due diligence — cross-referencing the contract against user-published reference datasets (known exploit signatures, drainer wallets, trusted deployer allowlists) and indexed contract event history. Produces a structured audit report. Use when the user is about to deploy a Solidity contract, asks to audit a source file or deployed address, asks "is this contract safe", or mentions cross-referencing against reference data. Refuses to certify any contract as "safe" — only produces evidence the user reviews before deciding.
---

# Pre-Deploy Audit

## What this skill produces

A structured Markdown audit report with four sections:

1. **Static Analysis** — slither findings, severity-ranked.
2. **Reference Cross-Reference** — proven SQL queries that JOIN the contract against user-published reference tables (exploit signatures, drainer denylists, trusted-deployer allowlists).
3. **Indexed Contract History** — if the target is deployed and registered with SXT for event indexing, proven queries against its event log.
4. **Verdict** — list of issues to resolve before deploy, *not* a "safe" stamp.

The skill never certifies a contract as audited. It surfaces evidence; the user decides.

## What changed from a generic auditor

Static analyzers like slither catch known code-level patterns: reentrancy, overflow, arbitrary sends. They cannot tell you that a contract's bytecode hash matches a known honeypot template, or that the deployer wallet appears on a community-curated drainer list. Space and Time fills that gap — but only for data you have either **published yourself** (via the `dataset-publish` skill) or **registered for indexing** (a contract whose events SXT is now tracking).

This skill does **not** rely on pre-built core-chain tables (e.g., a global `ETHEREUM.TRANSACTIONS` table). It uses only:

- Static analysis of the Solidity source or deployed bytecode (works regardless of SXT).
- User-published reference tables (created via `dreamspace-data:dataset-publish`).
- Indexed contract event tables (created when the user registers a target contract with SXT for indexing).

This makes the skill honest about what it can do given the user's setup. If the user has neither published reference data nor registered any contract for indexing, the skill produces a slither-only report and tells the user what they're missing.

## When to invoke

- Before any mainnet deployment, regardless of contract complexity.
- When reviewing a deployed contract someone else asked you to integrate with.
- When the user asks "is this address safe to interact with."
- When the user has published a known-exploit reference table and wants to cross-check a new contract against it.

## Inputs

The skill needs at least one of:

- **Solidity source file path** (for pre-deploy audit) — e.g., `./contracts/MyToken.sol`.
- **Deployed contract address + chain** (for post-deploy audit) — e.g., `0xa0b8...` on `ethereum`.

Optional but high-value:

- **A reference dataset name** the user has published via `dataset-publish`, e.g., `MY_AUDIT.KNOWN_EXPLOITS`. Without this, Phase 2 is skipped.
- **The target's SXT-indexed table name**, if the user has registered the deployed contract with SXT for event indexing. Without this, Phase 3 is skipped.

You also need:

- `slither` installed (`pip install slither-analyzer`) — required for Phase 1.
- An SXT API key in `SXT_API_KEY` env var — required for Phases 2 and 3.
- `solc` matching the contract's pragma — required if running slither against source.

If any prerequisite is missing, list what's missing and decide whether to proceed degraded (e.g., slither-only) or stop. Do not silently skip phases.

## Phase 1: Static analysis

For source files, run slither and parse the JSON output:

```bash
slither ./contracts/MyToken.sol --json - 2>/dev/null
```

For deployed contracts with verified source on Etherscan:

```bash
slither <contract-address> --etherscan-apikey $ETHERSCAN_API_KEY --json -
```

Categorize findings by slither's severity (`High`, `Medium`, `Low`, `Informational`, `Optimization`). For each `High` and `Medium` finding, include:

- The detector name (e.g., `reentrancy-eth`, `arbitrary-send-eth`).
- The function and line number.
- A one-line explanation of the risk.

**False positives to filter out**:
- `solc-version` informational — only flag if the pragma is below `0.8.0` (overflow checks default in 0.8+).
- `naming-convention` — never report; not a security concern.
- `unused-state` on contracts inheriting OpenZeppelin — common false positive for storage gaps.

## Phase 2: Reference dataset cross-reference

This phase requires the user to have published at least one reference table via `dataset-publish`. Skip if none provided and tell the user what they're missing. Confirm `SXT_API_KEY` is set in the environment before attempting.

### Concrete execution recipe

Use the Bash tool to run these steps in order:

**Step 1 — Compute the contract hash.**

If you have a Solidity source file:

```bash
# Production: hash the compiled bytecode
solc --bin ./contracts/MyToken.sol | grep -E '^[0-9a-fA-F]+$' | head -1 | tr -d '\n' | sha256sum | awk '{print "0x"$1}'

# Demo / no-solc fallback: hash the source file directly
sha256sum ./contracts/MyToken.sol | awk '{print "0x"$1}'
```

If the user passes a known demo-marker hash (e.g., `--demo` flag or pasted hash), skip this step and use their value.

**Step 2. Query SXT with Proof of SQL via the SDK.**

The `/v1/zkquery` flow requires a JWT exchanged from your raw API key first. The `sxt-proof-of-sql-sdk` package handles the exchange, submit, poll, and proof verification in one call. Mirror the pattern in `examples/scripts/verify-table.mjs`:

```javascript
import { SxTClient } from 'sxt-proof-of-sql-sdk';

const client = new SxTClient(
  'https://api.makeinfinite.dev',
  'https://proxy.api.makeinfinite.dev/auth/apikey',
  'https://rpc.mainnet.sxt.network/',
  process.env.SXT_API_KEY,
);

const HASH = '0x<computed-hash-from-step-1>';
const TABLE = process.env.REFERENCE_TABLE ?? 'MY_AUDIT.KNOWN_EXPLOITS';
const sql = `SELECT BYTECODE_HASH, EXPLOIT_TYPE, SEVERITY, SOURCE_URL FROM ${TABLE} WHERE BYTECODE_HASH = '${HASH}'`;

const result = await client.queryAndVerify(sql);
```

The runnable script `examples/scripts/audit-with-sxt.mjs` does exactly this. Defer to it rather than rebuilding the call by hand.

**Step 3. Parse the verified result.**

`client.queryAndVerify(sql)` returns the rows after the proof has been verified locally. The SDK throws on prover or verifier error; otherwise the rows are trustworthy.

If `rows` is non-empty, surface the match as a finding with severity from the `SEVERITY` column.

If multiple reference tables exist (e.g., a drainer denylist for the deployer address, a trusted-deployer allowlist), repeat steps 2–3 for each, substituting the table name and column predicate.

If the user has multiple reference tables (e.g., a drainer denylist for the deployer address, a trusted-deployer allowlist), run a query against each:

```sql
-- Deployer denylist check
SELECT ADDRESS, FIRST_SEEN, EVIDENCE_URL
FROM MY_AUDIT.DRAINER_WALLETS
WHERE ADDRESS = :deployer
```

```sql
-- Trusted-deployer allowlist check
SELECT ADDRESS, LABEL, SOURCE
FROM MY_AUDIT.TRUSTED_DEPLOYERS
WHERE ADDRESS = :deployer
```

Synthesize findings:

- **Bytecode match in `KNOWN_EXPLOITS`** → severity from the dataset (typically High).
- **Deployer match in `DRAINER_WALLETS`** → High; refuse to proceed without explicit user override.
- **Deployer match in `TRUSTED_DEPLOYERS`** → reduces false positives on the slither side; do not treat as "safe", just lower the noise floor.

Each finding cites the exact proof receipt hash returned by SXT, so the audit report is independently verifiable.

## Phase 3: Indexed contract history

This phase requires the deployed contract (or one of its dependencies) to have been registered with SXT for event indexing. Skip if not registered and tell the user how to register (point them at the chain.spaceandtime.io "Index Smart Contracts" tutorial).

Once a contract is indexed, its events become queryable as a table:

```sql
-- Example shape — actual schema/table name depends on user's indexing setup
SELECT EVENT_NAME, COUNT(*) AS EVENT_COUNT
FROM MY_INDEXED.MY_TOKEN_EVENTS
WHERE BLOCK_NUMBER > :recent_block
GROUP BY EVENT_NAME
```

Patterns to flag:

- High volume of `Approval` events to a single recipient → potential drainer integration.
- `Transfer` events with anomalous distribution (single recipient receives > 50% of supply).
- Frequent `OwnershipTransferred` events → ownership instability.
- Admin function calls clustered in a short window (e.g., five `setFee` calls in one block) → governance attack pattern.

All queries run with `proveExecution: true`. The skill cites proof receipts in the report.

## Phase 4: Final report

Produce a single Markdown report. Format:

```markdown
# Pre-Deploy Audit: <contract name or address>

**Audit timestamp**: <UTC ISO>
**Inputs**: source / address / chain / reference tables used / indexed tables used

## Verdict

<N High / M Medium / K Low findings. Block deploy / proceed with caution / no blockers found.>

## High-severity findings

1. **<detector or signal>** — <function or context>. <Why it matters>. <Recommended action>.
   - Source: <slither | reference-table-name | indexed-event-pattern>
   - Proof receipt (if from SXT): <hash>
...

## Medium-severity findings

...

## Reference cross-reference summary

| Reference table | Match? | Details |
|---|---|---|
| MY_AUDIT.KNOWN_EXPLOITS | yes | bytecode_hash matched 1 row, severity=High |
| MY_AUDIT.DRAINER_WALLETS | no | — |
| MY_AUDIT.TRUSTED_DEPLOYERS | yes | deployer is on the allowlist (label: "audited-team-v1") |

## Indexed contract history (if available)

- Indexed table: <schema.table>
- Recent block range: <from>–<to>
- Anomalies: <list or "none">

## Phases not run

<List any phases skipped because prerequisites were missing, e.g., "Phase 2 skipped: no reference tables provided. Publish reference data with the dataset-publish skill to enable.">

## Caveats

This is automated triage, not a security audit. Engage a professional auditor for any contract handling material value. The skill produces evidence, not certification.
```

## When to refuse

Refuse to produce a verdict (and tell the user why) if:

- slither isn't installed.
- No SXT API key is set AND no reference tables / indexed contracts available — the skill produces only a slither-only report, which is too thin to call an audit unless the user explicitly asks for slither-only output.
- The contract uses non-trivial `assembly` blocks beyond standard OpenZeppelin patterns — recommend a human auditor.
- The contract is upgradeable and the user is integrating with it for the first time — flag explicitly that all guarantees can change at the next upgrade.
- Phase 2 returns a match in a `DRAINER_WALLETS` table the user trusts — refuse to proceed; require explicit override with reasoning logged in the report.

## What this skill is not

- **Not a substitute for a professional security audit.** Material-value contracts need humans with engagement contracts.
- **Not a "safe / unsafe" classifier.** It produces evidence; the user reads it.
- **Not exhaustive.** Slither has known blind spots (cross-contract reentrancy, off-chain oracle manipulation). The report should acknowledge what it didn't check.
- **Not a free intelligence service.** The reference tables are only as good as what the user has published. Garbage in, garbage out.

## The full audit loop

This skill is the third stage of a three-skill workflow:

1. `dreamspace-data:dataset-publish` — Publish your reference data (known exploits, denylists, allowlists).
2. *(Out-of-band)* — Register the target deployed contract with SXT for event indexing via chain.spaceandtime.io.
3. `dreamspace-contracts:pre-deploy-audit` — Run slither + cross-references + indexed-event analysis. Output a report.

Each stage is independently useful. Together they demonstrate the entire DreamSpace value loop: bring your data, index your target, get verifiable cross-references.

## References

- Slither: https://github.com/crytic/slither
- SXT smart contract indexing: https://chain.spaceandtime.io (look for "Index Smart Contracts" tutorial)
- Proof of SQL surface and refusal rules: see `dreamspace-query:proof-of-sql-foundations`.
- Publishing reference data: see `dreamspace-data:dataset-publish`.
- Onchain consumption (verifier addresses): see `dreamspace-query:proof-of-sql-foundations`.
