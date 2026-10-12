#!/usr/bin/env node
/**
 * Copies the canonical SKILL.md docs the server serves as MCP resources into
 * `docs/` inside this package, so they ship in the npm tarball.
 *
 * Without this, an npm-installed server resolves the foundations resource by
 * walking five directories up from `dist/tools/`, which lands nowhere inside
 * a consumer's `node_modules`, and every installed user silently receives the
 * fallback stub instead of the real proven-surface reference.
 *
 * Runs as `prebuild`. Fails soft: when the monorepo source is absent (someone
 * building from an extracted tarball), it leaves any already-bundled copy in
 * place rather than erroring.
 */

import { copyFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(PKG_ROOT, "..", "..", "..");

const DOCS = [
  {
    from: resolve(
      REPO_ROOT,
      "packages/plugins/dreamspace-query/skills/proof-of-sql-foundations/SKILL.md",
    ),
    to: resolve(PKG_ROOT, "docs", "proof-of-sql-foundations.md"),
  },
];

let copied = 0;
for (const doc of DOCS) {
  try {
    await access(doc.from);
  } catch {
    console.log(`[bundle-docs] source absent, skipping: ${doc.from}`);
    continue;
  }
  await mkdir(dirname(doc.to), { recursive: true });
  await copyFile(doc.from, doc.to);
  copied += 1;
}

console.log(`[bundle-docs] bundled ${copied}/${DOCS.length} doc(s) into docs/`);
