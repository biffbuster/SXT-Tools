/**
 * sxt.proof_of_sql_foundations — exposed as an MCP RESOURCE (not a tool).
 *
 * Implemented in v0.0.1 because reading a Markdown file from disk is a pure
 * filesystem read with zero chain or network exposure. Lets the user verify
 * the server is alive even before any chain-touching tool is implemented.
 *
 * Returns the canonical SKILL.md content from
 * packages/plugins/sxt-query/skills/proof-of-sql-foundations/SKILL.md
 * so any agent calling sxt.run_proven_query can self-validate its SQL
 * against the proven surface before submitting.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const FOUNDATIONS_RESOURCE_URI = "sxt://docs/proof-of-sql-foundations";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Resolution order matters for installed users.
 *
 * 1. `<package>/docs/` — written by `scripts/bundle-docs.mjs` at prebuild and
 *    shipped in the npm tarball. This is the ONLY path that exists when the
 *    server is installed via npx, so it must be tried first.
 * 2. The monorepo source, five levels up from `dist/tools/`. Keeps `npm run dev`
 *    serving live edits to the SKILL.md without a rebuild.
 * 3. The fallback stub, which points at the canonical URL.
 */
const FOUNDATIONS_CANDIDATES = [
  // dist/tools/ → dist/ → <package>/docs/
  resolve(HERE, "..", "..", "docs", "proof-of-sql-foundations.md"),
  resolve(
    HERE,
    "..",
    "..",
    "..",
    "..",
    "..",
    "packages",
    "plugins",
    "sxt-query",
    "skills",
    "proof-of-sql-foundations",
    "SKILL.md",
  ),
];

const FALLBACK_BODY =
  "# Proof of SQL Foundations\n\n" +
  "Could not locate the canonical SKILL.md on this host. The published source of truth is at:\n" +
  "https://github.com/biffbuster/sxt-tools/blob/main/packages/plugins/sxt-query/skills/proof-of-sql-foundations/SKILL.md\n";

export async function readFoundationsResource(): Promise<{
  uri: string;
  mimeType: "text/markdown";
  text: string;
}> {
  let text = FALLBACK_BODY;
  for (const candidate of FOUNDATIONS_CANDIDATES) {
    try {
      text = await readFile(candidate, "utf8");
      break;
    } catch {
      // Try the next candidate.
    }
  }
  return {
    uri: FOUNDATIONS_RESOURCE_URI,
    mimeType: "text/markdown",
    text,
  };
}
