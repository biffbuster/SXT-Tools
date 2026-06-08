/**
 * Cross-skill handoff for "the dataset just published is the active dataset."
 *
 * publish-dataset-cli.mjs (and the MCP publish_dataset tool) write
 * examples/data/.last-publish.json after a successful publish. Downstream
 * skills — save-proof-plans.mjs, verify-table.mjs, the MCP
 * run_proven_query tool — read it as a fallback when their explicit env
 * vars / args aren't supplied.
 *
 * Resolution order downstream tools should follow:
 *   1. Explicit env var or CLI arg (e.g. SXT_TABLE, SXT_LOOKUP_COLUMN)
 *   2. .last-publish.json
 *   3. Legacy hardcoded demo defaults (canonical STAKERS table)
 *
 * The file is gitignored — it contains the publisher's wallet hex which
 * shouldn't leak via PRs from forked repos.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(HERE, '..', '..', 'data', '.last-publish.json');

export function lastPublishPath() {
  return process.env.SXT_LAST_PUBLISH_PATH
    ? resolve(process.env.SXT_LAST_PUBLISH_PATH)
    : DEFAULT_PATH;
}

export function readLastPublish() {
  const p = lastPublishPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function writeLastPublish(record) {
  const p = lastPublishPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(record, null, 2) + '\n');
  return p;
}

/**
 * Derive a filesystem-safe slug from a table reference. Uses only the table
 * portion (after the last dot) lowercased — short, readable, and unique
 * within a single forked user's repo since the wallet hex is constant.
 */
export function tableSlug(tableRef) {
  if (!tableRef) return null;
  const parts = String(tableRef).split('.');
  const tbl = parts[parts.length - 1] ?? '';
  return tbl.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/**
 * Extract the user's chosen namespace PREFIX from a previously-published
 * table reference. SXT chain rule: namespaces are auto-suffixed with the
 * publishing wallet's 40-char uppercase hex address (e.g. `MY_AUDIT_V2`
 * → `MY_AUDIT_V2_5731EC0B...0552`). To recover the original prefix the
 * user typed, strip the trailing `_<40-hex>` segment from the namespace.
 *
 * Returns null if the reference doesn't match the expected shape (e.g.
 * legacy data or a hand-crafted ref that doesn't carry the hex suffix).
 *
 *   extractPrefix('MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS')
 *   → 'MY_AUDIT_V2'
 *
 * Used by publish-dataset-cli.mjs to "remember" the user's prefix across
 * publishes — on the second-onward publish the user can omit PREFIX.TABLE
 * and the CLI auto-derives `<remembered_prefix>.<CSV_STEM_UPPER>`.
 */
export function extractPrefix(tableRef) {
  if (!tableRef) return null;
  const m = String(tableRef).match(/^(.+)_[0-9A-F]{40}\..+$/);
  return m ? m[1] : null;
}

/**
 * Extract the TABLE portion (after the last dot) of a fully-suffixed
 * table reference. Round-trip with extractPrefix: given the original
 * `PREFIX.TABLE` typed by the user, the chain stores it as
 * `PREFIX_<HEX>.TABLE`, and these two helpers recover `PREFIX` and
 * `TABLE` respectively.
 */
export function extractTable(tableRef) {
  if (!tableRef) return null;
  const parts = String(tableRef).split('.');
  return parts[parts.length - 1] ?? null;
}

/**
 * Resolve where a downstream tool should write/read proof plans for a given
 * table. Canonical STAKERS demo plans stay at proof-plans/ (legacy paths
 * baked into StakersQuery.sol). Every other table gets its own subdir.
 */
export function planDirFor(tableRef, baseDir) {
  const slug = tableSlug(tableRef);
  // Preserve the canonical demo location so StakersQuery.sol and the
  // bundled demo orchestrator keep working unchanged.
  if (slug === 'stakers') return baseDir;
  return slug ? join(baseDir, slug) : baseDir;
}
