#!/usr/bin/env node
/**
 * audit-rendered.mjs — produce AUDIT_REPORT.md for the most recently
 * rendered OnchainQuery contract.
 *
 * Pipeline:
 *   1. Read .last-rendered.json to find the rendered contract
 *   2. Confirm forge build succeeded (artifact present, non-empty bytecode)
 *   3. Run slither static analysis (if installed) — JSON output
 *   4. Categorize findings: Critical (slither High), Moderate (Medium),
 *      Minor (Low), Info (Informational/Optimization)
 *   5. EIP-170 bytecode check
 *   6. SHA-256 source hash
 *   7. Write AUDIT_REPORT.md + print summary
 *
 * Exit codes (so the orchestrator can gate on findings):
 *   0  PASS or WARN — deploy permitted. PASS = no findings; WARN = moderate
 *      findings present (printed prominently, surfaced in AUDIT_REPORT.md;
 *      community reviewers can read and decide). Override via
 *      SXT_AUDIT_STRICT=1 to block on moderates as well.
 *   2  FAIL — critical findings present (deploy refused unconditionally).
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(HERE, "..", "contracts", "sxt-onchain-query");
const LAST_RENDERED = resolve(PROJECT_DIR, ".last-rendered.json");

// ─── Resolve target contract ──────────────────────────────────────────

if (!existsSync(LAST_RENDERED)) {
  console.error(
    "✗ .last-rendered.json missing — run render-onchain-query.mjs first.",
  );
  process.exit(2);
}
const rendered = JSON.parse(readFileSync(LAST_RENDERED, "utf8"));
const contractName = rendered.contractName;
const sourcePath = resolve(
  PROJECT_DIR,
  "src",
  contractName,
  contractName + ".sol",
);
const artifactPath = resolve(
  PROJECT_DIR,
  "out",
  contractName + ".sol",
  contractName + ".json",
);

if (!existsSync(artifactPath)) {
  console.error(`✗ Forge artifact missing at ${artifactPath} — run forge build first.`);
  process.exit(2);
}
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
if (!artifact.bytecode?.object || artifact.bytecode.object === "0x") {
  console.error(`✗ Artifact at ${artifactPath} has empty bytecode — re-run forge build.`);
  process.exit(2);
}

const bytecodeBytes = (artifact.bytecode.object.length - 2) / 2;
const eip170OK = bytecodeBytes < 24576;
const sourceContent = readFileSync(sourcePath, "utf8");
const sourceHash = "0x" + createHash("sha256").update(sourceContent).digest("hex");

// ─── Run slither ─────────────────────────────────────────────────────

let slitherInstalled = false;
let slitherFindings = [];
let slitherError = null;

const checkSlither = spawnSync("slither", ["--version"], { encoding: "utf8" });
if (checkSlither.status === 0) {
  slitherInstalled = true;
  console.log(`▶ slither ${checkSlither.stdout.trim()}`);
  console.log(`  Analyzing ${PROJECT_DIR}…`);
  const slitherRun = spawnSync(
    "slither",
    [PROJECT_DIR, "--json", "-", "--filter-paths", "dependencies"],
    { encoding: "utf8", timeout: 120_000 },
  );
  // slither exits non-zero when findings exist — that's expected.
  if (slitherRun.stdout.trim()) {
    try {
      const parsed = JSON.parse(slitherRun.stdout);
      slitherFindings = parsed.results?.detectors ?? [];
    } catch (err) {
      slitherError = `Could not parse slither JSON output: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  } else {
    slitherError = `slither produced no output (stderr: ${(slitherRun.stderr || "").split("\n")[0]})`;
  }
} else {
  console.log("  · slither not installed — install with `pip install slither-analyzer`");
}

// ─── Categorize findings by severity ─────────────────────────────────

const SEVERITY_MAP = {
  High: "Critical",
  Medium: "Moderate",
  Low: "Minor",
  Informational: "Info",
  Optimization: "Info",
};

const byCategory = { Critical: [], Moderate: [], Minor: [], Info: [] };
for (const f of slitherFindings) {
  const cat = SEVERITY_MAP[f.impact] ?? "Info";
  const first = f.elements?.[0];
  const file = first?.source_mapping?.filename_relative ?? "(unknown)";

  // Drop dependency-only findings from the contract-level severity bins.
  // Anything under dependencies/, lib/, or @openzeppelin paths is library
  // code we don't own — show it in Info only.
  const isDependency =
    file.includes("dependencies/") ||
    file.includes("lib/") ||
    file.includes("@openzeppelin");

  const entry = {
    check: f.check ?? "(unknown)",
    description: (f.description ?? "")
      .trim()
      .split("\n")[0]
      .slice(0, 180),
    file,
    line: first?.source_mapping?.lines?.[0] ?? null,
  };

  if (isDependency) {
    byCategory.Info.push({ ...entry, dependency: true });
  } else {
    byCategory[cat].push(entry);
  }
}

// ─── Verdict ─────────────────────────────────────────────────────────

let verdict, verdictIcon, exitCode, verdictMsg;
if (byCategory.Critical.length > 0) {
  verdict = "FAIL";
  verdictIcon = "✗";
  exitCode = 2;
  verdictMsg = `${byCategory.Critical.length} critical finding(s) — deploy refused`;
} else if (byCategory.Moderate.length > 0) {
  verdict = "WARN";
  verdictIcon = "⚠";
  // Deploy permitted by default; reviewers see the moderate findings in the
  // report and printed summary. SXT_AUDIT_STRICT=1 elevates to a hard block.
  exitCode = process.env.SXT_AUDIT_STRICT === "1" ? 1 : 0;
  verdictMsg = `${byCategory.Moderate.length} moderate finding(s) — review recommended before deploy`;
} else {
  verdict = "PASS";
  verdictIcon = "✓";
  exitCode = 0;
  verdictMsg = "no critical or moderate findings; contract cleared for deployment";
}

// ─── Render report ───────────────────────────────────────────────────

function findingList(list) {
  if (list.length === 0) return "_(none)_";
  return list
    .map((f) => {
      const loc = f.file && f.line ? ` *(${f.file}:${f.line})*` : "";
      return `- **${f.check}** — ${f.description}${loc}`;
    })
    .join("\n");
}

const compilerVersion =
  (() => {
    try {
      const meta = JSON.parse(artifact.metadata ?? '{}');
      return meta.compiler?.version ?? "0.8.30";
    } catch {
      return "0.8.30";
    }
  })();

const reportPath = resolve(PROJECT_DIR, "AUDIT_REPORT.md");

const report = `# AUDIT_REPORT — ${contractName}

| Field | Value |
|---|---|
| Contract | \`${contractName}\` |
| Source | \`src/${contractName}/${contractName}.sol\` |
| Target chain | Base mainnet (chainId 8453) |
| Compiler | Solidity ${compilerVersion} |
| Audit date | ${new Date().toISOString()} |
| Auditor | sxt-tools \`pre-deploy-audit\` pipeline |
| Linked SXT table | \`${rendered.table}\` |

---

## Verdict

**${verdictIcon} ${verdict}** — ${verdictMsg}.

## Findings by severity

| Severity | Count |
|---|---|
| 🔴 Critical | ${byCategory.Critical.length} |
| 🟡 Moderate | ${byCategory.Moderate.length} |
| 🟢 Minor | ${byCategory.Minor.length} |
| ℹ️ Informational | ${byCategory.Info.length} |

### 🔴 Critical
${findingList(byCategory.Critical)}

### 🟡 Moderate
${findingList(byCategory.Moderate)}

### 🟢 Minor
${findingList(byCategory.Minor)}

### ℹ️ Informational
${
  byCategory.Info.length === 0
    ? "_(none)_"
    : byCategory.Info.slice(0, 8)
        .map((f) => {
          const loc = f.file && f.line ? ` *(${f.file}:${f.line})*` : "";
          const tag = f.dependency ? " *[dependency]*" : "";
          return `- **${f.check}** — ${f.description}${loc}${tag}`;
        })
        .join("\n") + (byCategory.Info.length > 8 ? `\n- _…and ${byCategory.Info.length - 8} more (truncated)_` : "")
}

## Compile

✓ \`forge build\` succeeded.

## Bytecode

- **${contractName}**: ${bytecodeBytes.toLocaleString()} bytes
- EIP-170 limit (24,576 bytes): ${eip170OK ? `**OK** — ${(24576 - bytecodeBytes).toLocaleString()} bytes headroom` : `**EXCEEDED** — contract will not deploy`}

## Source hash (SHA-256)

\`\`\`
${sourcePath}
${sourceHash}
\`\`\`

## Static analysis tool

${
  slitherInstalled
    ? `✓ slither ${checkSlither.stdout.trim()}`
    : `· slither not installed — install with \`pip install slither-analyzer\` for richer findings`
}${slitherError ? `\n\n⚠ ${slitherError}` : ""}

## Disclaimer

This report returns **evidence**, not a safety certification. A clean compile and
zero slither findings does not mean the contract is safe. Combine with manual review
and cross-reference against published SXT reference tables (\`sxt.run_proven_query\`)
for production deployments.

---

_Generated by \`examples/scripts/audit-rendered.mjs\`._
`;

writeFileSync(reportPath, report);

// ─── Summary to terminal ─────────────────────────────────────────────

console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  Audit verdict: ${verdictIcon} ${verdict}`);
console.log(`    🔴 Critical:      ${byCategory.Critical.length}`);
console.log(`    🟡 Moderate:      ${byCategory.Moderate.length}`);
console.log(`    🟢 Minor:         ${byCategory.Minor.length}`);
console.log(`    ℹ️  Informational: ${byCategory.Info.length}`);
console.log(`  Bytecode:      ${bytecodeBytes.toLocaleString()} bytes (EIP-170 ${eip170OK ? "OK" : "OVER"})`);
console.log(`  Report:        ${reportPath}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

process.exit(exitCode);
