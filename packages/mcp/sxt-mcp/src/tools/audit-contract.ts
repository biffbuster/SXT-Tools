/**
 * sxt.audit_contract — local-only Solidity audit.
 *
 * Phase 3 (v0.0.3). Pure local execution: spawns `forge build` and optionally
 * `slither` against a project root or single source file, parses their output,
 * returns a structured report. Computes SHA-256 of every .sol file under the
 * project (consumed by v0.0.4 cross-reference against published SXT reference
 * tables).
 *
 * No network calls. No chain interaction. No credentials read. The handler is
 * functionally equivalent to running `forge build && slither .` from a shell.
 *
 * Refusal language: this tool returns EVIDENCE, never a safety certification.
 * A clean build + zero slither findings does not mean the contract is safe.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

export const auditContractSchema = z.object({
  sourcePath: z
    .string()
    .describe(
      "Path to a Foundry project root (containing foundry.toml + src/) or a single " +
        ".sol file. Relative paths are resolved against the MCP server's CWD.",
    ),
  slither: z
    .boolean()
    .default(true)
    .describe(
      "Run slither static analysis if available on PATH. Default true; the tool " +
        "fails-soft when slither is missing — it skips the slither step with a hint " +
        "rather than failing the whole audit.",
    ),
  outputPath: z
    .string()
    .optional()
    .describe(
      "Optional path to write a Markdown rendering of the report (AUDIT_REPORT.md). " +
        "When omitted, only the structured JSON is returned.",
    ),
});

export type AuditContractArgs = z.infer<typeof auditContractSchema>;

// ─── Output shape ───────────────────────────────────────────────────────────

interface ForgeArtifact {
  contractName: string;
  artifactPath: string;
  bytecodeSize: number;
}

interface ForgeMessage {
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
}

interface SlitherFinding {
  severity: string;
  check: string;
  description: string;
  file?: string;
  line?: number;
}

type SlitherResult =
  | { ran: true; findings: SlitherFinding[]; raw?: unknown }
  | { ran: false; reason: string };

interface AuditReport {
  schemaVersion: 1;
  summary: {
    projectRoot: string;
    mode: "project" | "single-file";
    contractsBuilt: number;
    forgeSuccess: boolean;
    slitherRan: boolean;
    findingsBySeverity: Record<string, number>;
  };
  forge: {
    success: boolean;
    artifacts: ForgeArtifact[];
    messages: ForgeMessage[];
    rawExitCode: number;
  };
  slither: SlitherResult;
  sourceHashes: Record<string, string>;
  notes: string[];
}

// ─── Path resolution ────────────────────────────────────────────────────────

interface ResolvedTarget {
  projectRoot: string;
  mode: "project" | "single-file";
  hasFoundryToml: boolean;
}

async function resolveTarget(sourcePath: string): Promise<ResolvedTarget> {
  const abs = isAbsolute(sourcePath) ? sourcePath : resolve(process.cwd(), sourcePath);
  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new Error(`Path does not exist: ${abs}`);
  }

  if (info.isFile()) {
    if (extname(abs) !== ".sol") {
      throw new Error(`Single-file audit requires a .sol file, got: ${abs}`);
    }
    return { projectRoot: dirname(abs), mode: "single-file", hasFoundryToml: false };
  }

  if (info.isDirectory()) {
    const hasFoundryToml = await fileExists(join(abs, "foundry.toml"));
    return {
      projectRoot: abs,
      mode: "project",
      hasFoundryToml,
    };
  }

  throw new Error(`Path is neither a file nor a directory: ${abs}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ─── Subprocess helper ──────────────────────────────────────────────────────

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  spawnError?: NodeJS.ErrnoException;
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<SpawnResult> {
  return new Promise((resolveResult) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timeoutHandle: NodeJS.Timeout | undefined;
    let spawnError: NodeJS.ErrnoException | undefined;

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", (err) => {
      spawnError = err as NodeJS.ErrnoException;
    });

    child.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolveResult({
        stdout,
        stderr,
        exitCode: code ?? -1,
        spawnError,
      });
    });

    timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      resolveResult({
        stdout,
        stderr: stderr + `\n[sxt-mcp] killed after ${timeoutMs}ms timeout`,
        exitCode: -1,
        spawnError,
      });
    }, timeoutMs);
  });
}

// ─── forge build ────────────────────────────────────────────────────────────

async function runForgeBuild(
  projectRoot: string,
): Promise<AuditReport["forge"]> {
  const result = await runCommand("forge", ["build", "--json"], projectRoot);

  if (result.spawnError && result.spawnError.code === "ENOENT") {
    throw new Error(
      "forge is not on PATH. Install Foundry from https://getfoundry.sh — the tool " +
        "wraps `forge build`, so a working foundry install is required.",
    );
  }

  const messages = parseForgeMessages(result.stdout, result.stderr);
  const artifacts = await collectArtifacts(projectRoot);
  const success = result.exitCode === 0;

  return {
    success,
    artifacts,
    messages,
    rawExitCode: result.exitCode,
  };
}

function parseForgeMessages(stdout: string, stderr: string): ForgeMessage[] {
  const messages: ForgeMessage[] = [];
  const combined = stdout + "\n" + stderr;

  // Try the structured `forge build --json` output first. Older / interrupted
  // builds may not emit valid JSON; we fall back to line-based parsing below.
  for (const line of combined.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed) as {
        severity?: string;
        message?: string;
        sourceLocation?: { file?: string; start?: number };
      };
      if (obj.severity === "error" || obj.severity === "warning") {
        messages.push({
          severity: obj.severity,
          message: obj.message ?? trimmed,
          file: obj.sourceLocation?.file,
          line: obj.sourceLocation?.start,
        });
      }
    } catch {
      // not JSON — ignore, fall back to line-based detection
    }
  }

  // Fallback: detect bare error/warning lines so users still see hints if
  // forge bails before emitting JSON.
  if (messages.length === 0) {
    for (const line of combined.split("\n")) {
      if (/^\s*(Error|error)\b/.test(line)) {
        messages.push({ severity: "error", message: line.trim() });
      } else if (/^\s*(Warning|warning)\b/.test(line)) {
        messages.push({ severity: "warning", message: line.trim() });
      }
    }
  }

  return messages;
}

async function collectArtifacts(projectRoot: string): Promise<ForgeArtifact[]> {
  const outDir = join(projectRoot, "out");
  if (!(await fileExists(outDir))) return [];

  const artifacts: ForgeArtifact[] = [];
  const stack: string[] = [outDir];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        stack.push(full);
      } else if (entry.endsWith(".json") && !entry.includes("dbg.json")) {
        const contractName = entry.replace(/\.json$/, "");
        try {
          const raw = await readFile(full, "utf8");
          const parsed = JSON.parse(raw) as {
            bytecode?: { object?: string };
            deployedBytecode?: { object?: string };
          };
          const bytecode =
            parsed.bytecode?.object ?? parsed.deployedBytecode?.object ?? "";
          if (bytecode && bytecode !== "0x") {
            artifacts.push({
              contractName,
              artifactPath: relative(projectRoot, full),
              bytecodeSize: Math.max(0, (bytecode.length - 2) / 2),
            });
          }
        } catch {
          // skip unparseable artifacts
        }
      }
    }
  }
  return artifacts;
}

// ─── slither ────────────────────────────────────────────────────────────────

async function runSlither(target: ResolvedTarget): Promise<SlitherResult> {
  const targetArg = target.mode === "single-file" ? target.projectRoot : ".";
  const result = await runCommand("slither", [targetArg, "--json", "-"], target.projectRoot);

  if (result.spawnError && result.spawnError.code === "ENOENT") {
    return {
      ran: false,
      reason:
        "slither is not on PATH. Install with `pip install slither-analyzer` to enable " +
        "static analysis findings. The audit continues without it.",
    };
  }

  // Slither exits non-zero when findings exist — treat that as success too,
  // and only flag as failed if we couldn't parse the JSON at all.
  const trimmed = result.stdout.trim();
  if (!trimmed) {
    return {
      ran: false,
      reason: `slither produced no output (exit ${result.exitCode}). stderr: ${result.stderr.trim() || "(empty)"}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ran: false,
      reason: `slither output was not valid JSON (exit ${result.exitCode}). Run \`slither ${targetArg} --json -\` manually to inspect.`,
    };
  }

  const findings = extractSlitherFindings(parsed);
  return { ran: true, findings, raw: parsed };
}

function extractSlitherFindings(parsed: unknown): SlitherFinding[] {
  if (!parsed || typeof parsed !== "object") return [];
  const root = parsed as { results?: { detectors?: unknown[] } };
  const detectors = root.results?.detectors;
  if (!Array.isArray(detectors)) return [];

  const findings: SlitherFinding[] = [];
  for (const detRaw of detectors) {
    if (!detRaw || typeof detRaw !== "object") continue;
    const det = detRaw as {
      check?: string;
      impact?: string;
      description?: string;
      elements?: Array<{ source_mapping?: { filename_relative?: string; lines?: number[] } }>;
    };
    const firstElement = det.elements?.[0];
    findings.push({
      severity: det.impact ?? "informational",
      check: det.check ?? "(unknown)",
      description: (det.description ?? "").trim(),
      file: firstElement?.source_mapping?.filename_relative,
      line: firstElement?.source_mapping?.lines?.[0],
    });
  }
  return findings;
}

// ─── source hashes ──────────────────────────────────────────────────────────

async function computeSourceHashes(target: ResolvedTarget): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  const candidates: string[] = [];
  if (target.mode === "single-file") {
    // sourcePath was resolved to projectRoot = dirname(file), but we lost the
    // filename. Re-find the .sol files in projectRoot.
    const entries = await readdir(target.projectRoot);
    for (const entry of entries) {
      if (entry.endsWith(".sol")) candidates.push(join(target.projectRoot, entry));
    }
  } else {
    const srcDir = join(target.projectRoot, "src");
    if (await fileExists(srcDir)) {
      const stack = [srcDir];
      while (stack.length) {
        const dir = stack.pop();
        if (!dir) continue;
        const entries = await readdir(dir);
        for (const entry of entries) {
          const full = join(dir, entry);
          const info = await stat(full);
          if (info.isDirectory()) stack.push(full);
          else if (entry.endsWith(".sol")) candidates.push(full);
        }
      }
    }
  }

  for (const path of candidates) {
    try {
      const buf = await readFile(path);
      const hash = "0x" + createHash("sha256").update(buf).digest("hex");
      hashes[relative(target.projectRoot, path)] = hash;
    } catch {
      // skip unreadable
    }
  }

  return hashes;
}

// ─── Markdown rendering ─────────────────────────────────────────────────────

function renderMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# AUDIT_REPORT`);
  lines.push(``);
  lines.push(`**Project:** \`${report.summary.projectRoot}\`  `);
  lines.push(`**Mode:** ${report.summary.mode}  `);
  lines.push(
    `**forge build:** ${report.summary.forgeSuccess ? "✓ success" : "✗ failed"} (${report.summary.contractsBuilt} contract${report.summary.contractsBuilt === 1 ? "" : "s"})  `,
  );
  lines.push(
    `**slither:** ${report.summary.slitherRan ? "✓ ran" : `· skipped — ${(report.slither as { reason: string }).reason}`}  `,
  );
  if (report.summary.slitherRan) {
    const sevs = Object.entries(report.summary.findingsBySeverity)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push(`**Findings:** ${sevs || "none"}  `);
  }
  lines.push(``);

  if (report.forge.messages.length > 0) {
    lines.push(`## Compiler messages`);
    lines.push(``);
    for (const msg of report.forge.messages) {
      const loc = msg.file ? ` *(${msg.file}${msg.line ? `:${msg.line}` : ""})*` : "";
      lines.push(`- **${msg.severity}**: ${msg.message}${loc}`);
    }
    lines.push(``);
  }

  if (report.summary.slitherRan) {
    const findings = (report.slither as { findings: SlitherFinding[] }).findings;
    lines.push(`## Slither findings`);
    lines.push(``);
    if (findings.length === 0) {
      lines.push(`No findings.`);
    } else {
      for (const f of findings) {
        const loc = f.file ? ` *(${f.file}${f.line ? `:${f.line}` : ""})*` : "";
        lines.push(`- **[${f.severity}]** \`${f.check}\`: ${f.description}${loc}`);
      }
    }
    lines.push(``);
  }

  if (Object.keys(report.sourceHashes).length > 0) {
    lines.push(`## Source hashes (SHA-256)`);
    lines.push(``);
    lines.push(`Use these with \`sxt.run_proven_query\` against a published reference table to cross-check against known-exploit signatures (v0.0.4+):`);
    lines.push(``);
    lines.push(`\`\`\``);
    for (const [path, hash] of Object.entries(report.sourceHashes)) {
      lines.push(`${path}  ${hash}`);
    }
    lines.push(`\`\`\``);
    lines.push(``);
  }

  lines.push(`## Disclaimer`);
  lines.push(``);
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  lines.push(``);
  return lines.join("\n");
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function auditContractHandler(args: AuditContractArgs): Promise<AuditReport> {
  const target = await resolveTarget(args.sourcePath);

  if (target.mode === "project" && !target.hasFoundryToml) {
    throw new Error(
      `No foundry.toml found at ${target.projectRoot}. Either point sourcePath at a ` +
        `Foundry project root or pass a single .sol file.`,
    );
  }

  const forge = await runForgeBuild(target.projectRoot);
  const slither: SlitherResult = args.slither
    ? await runSlither(target)
    : { ran: false, reason: "slither: false passed in args" };
  const sourceHashes = await computeSourceHashes(target);

  const findingsBySeverity: Record<string, number> = {};
  if (slither.ran) {
    for (const f of slither.findings) {
      findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] ?? 0) + 1;
    }
  }

  const report: AuditReport = {
    schemaVersion: 1,
    summary: {
      projectRoot: target.projectRoot,
      mode: target.mode,
      contractsBuilt: forge.artifacts.length,
      forgeSuccess: forge.success,
      slitherRan: slither.ran,
      findingsBySeverity,
    },
    forge,
    slither,
    sourceHashes,
    notes: [
      "This report returns evidence, not a safety certification.",
      "A clean compile and zero slither findings does not mean the contract is safe.",
      "Combine with manual review and a cross-reference against published SXT reference tables (sxt.run_proven_query, v0.0.4+).",
      "The bytecode size in artifacts reflects deployed bytecode; if it exceeds 24,576 bytes the contract will fail to deploy under EIP-170.",
    ],
  };

  if (args.outputPath) {
    const outPath = isAbsolute(args.outputPath)
      ? args.outputPath
      : resolve(process.cwd(), args.outputPath);
    await writeFile(outPath, renderMarkdown(report), "utf8");
  }

  return report;
}
