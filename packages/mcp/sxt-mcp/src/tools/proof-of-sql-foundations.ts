/**
 * sxt.proof_of_sql_foundations — exposed as an MCP RESOURCE (not a tool).
 *
 * Implemented in v0.0.1 because reading a Markdown file from disk is a pure
 * filesystem read with zero chain or network exposure. Lets the user verify
 * the server is alive even before any chain-touching tool is implemented.
 *
 * Returns the canonical SKILL.md content from
 * packages/plugins/dreamspace-query/skills/proof-of-sql-foundations/SKILL.md
 * so any agent calling sxt.run_proven_query can self-validate its SQL
 * against the proven surface before submitting.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const FOUNDATIONS_RESOURCE_URI = "sxt://docs/proof-of-sql-foundations";

const HERE = dirname(fileURLToPath(import.meta.url));

// Resolve the SKILL.md relative to the compiled output. From dist/tools/ → repo root → packages/plugins/...
const FOUNDATIONS_SKILL_PATH = resolve(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "plugins",
  "dreamspace-query",
  "skills",
  "proof-of-sql-foundations",
  "SKILL.md",
);

const FALLBACK_BODY =
  "# Proof of SQL Foundations\n\n" +
  "Could not locate the canonical SKILL.md on this host. The published source of truth is at:\n" +
  "https://github.com/biffbuster/sxt-tools/blob/main/packages/plugins/dreamspace-query/skills/proof-of-sql-foundations/SKILL.md\n";

export async function readFoundationsResource(): Promise<{
  uri: string;
  mimeType: "text/markdown";
  text: string;
}> {
  let text: string;
  try {
    text = await readFile(FOUNDATIONS_SKILL_PATH, "utf8");
  } catch {
    text = FALLBACK_BODY;
  }
  return {
    uri: FOUNDATIONS_RESOURCE_URI,
    mimeType: "text/markdown",
    text,
  };
}
