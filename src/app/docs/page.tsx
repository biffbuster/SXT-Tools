import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import SkillsCatalog, { type SkillCard } from "./SkillsCatalog";

type SkillSpec = {
  plugin: string;
  skill: string;
  lifecycle: SkillCard["lifecycle"];
  stage: number;
  highlights: string[];
  languages: string[];
  cardDescription: string;
  // "stable" = ready to use today. "coming-soon" = SKILL.md scaffolded
  // (visible on the catalog so the roadmap is honest) but the CLI
  // implementation is in progress; the SKILL.md documents today's
  // workaround until shipping. Default: "stable".
  status?: "stable" | "coming-soon";
};

const SKILL_SPECS: SkillSpec[] = [
  {
    plugin: "dreamspace-data",
    skill: "dataset-publish",
    lifecycle: "Publish",
    stage: 1,
    languages: ["TypeScript", "JavaScript"],
    cardDescription:
      "Publish a CSV, Parquet, or JSON file to Space and Time as a chain-secured table queryable with Proof of SQL.",
    highlights: [
      "Schema inference from CSV / Parquet / JSON",
      "Apache Arrow IPC encoding",
      "Substrate RPC: createNamespace + createTables + submitData",
    ],
  },
  {
    plugin: "dreamspace-data",
    skill: "index-contract",
    lifecycle: "Publish",
    stage: 1,
    languages: ["TypeScript", "Solidity"],
    cardDescription:
      "Register any EVM contract for SXT to index its events into queryable tables under your namespace. CLI registration ships now (index-contract.mjs via the createTableWithSciMetadata extrinsic — the same one the Studio UI submits). SXT's docs still list SCI zk-commitment itself as 'coming soon', so the on-chain proof pipeline against SCI tables isn't end-to-end yet.",
    highlights: [
      "Keyless --event-signature mode, or verified-ABI fetch via Etherscan v2",
      "createTableWithSciMetadata extrinsic + per-table indexer funding (~100 SXT/event)",
      "Trustless onchain data: events from the chain itself, not curated CSVs",
    ],
    status: "coming-soon",
  },
  {
    plugin: "dreamspace-query",
    skill: "proof-of-sql-foundations",
    lifecycle: "Foundations",
    stage: 0,
    languages: ["Markdown", "SQL"],
    cardDescription:
      "The proven SQL surface — what compiles to a HyperKZG proof, what doesn't, and the refusal rules.",
    highlights: [
      "The proven SQL surface: what compiles to a HyperKZG proof and what doesn't",
      "Refusal rules for unproven operators (windowed aggregates, recursive CTEs)",
      "Background reading every other query skill assumes",
    ],
  },
  {
    plugin: "dreamspace-query",
    skill: "run-proven-query",
    lifecycle: "Query",
    stage: 2,
    languages: ["TypeScript", "SQL"],
    cardDescription:
      "Run a SELECT against a published SXT table with proveExecution=true and return the proof receipt.",
    highlights: [
      "REST submission with proveExecution=true via /v1/zkquery",
      "JWT exchange flow at /auth/apikey (NOT raw API key as bearer)",
      "EVM proof plan via commitments_v1_evmProofPlan for onchain verification",
    ],
  },
  {
    plugin: "dreamspace-query",
    skill: "chain-data-query",
    lifecycle: "Query",
    stage: 2,
    languages: ["TypeScript", "Solidity", "SQL"],
    cardDescription:
      "Generate a HyperKZG-provable parameterized SQL query against SXT's zk-committed Ethereum index, consumable by a Solidity contract on Base via IQueryRouter.requestQuery.",
    highlights: [
      "Restricted to the empirically zk-committed surface (ETHEREUM.BLOCKS, ETHEREUM.TRANSACTIONS)",
      "Parameterized plans — one deployed contract serves any wallet / block / tx hash at call time",
      "Trust-minimized L1 → L2: prove Ethereum activity in a Base callback in ~150K gas",
    ],
  },
  {
    plugin: "dreamspace-contracts",
    skill: "pre-deploy-audit",
    lifecycle: "Audit",
    stage: 3,
    languages: ["Solidity", "TypeScript"],
    cardDescription:
      "Static analysis plus SXT cross-references for a Solidity source — produces a structured audit report.",
    highlights: [
      "forge build + optional slither static analysis",
      "Cross-references against published SXT reference tables",
      "Structured AUDIT_REPORT.md the user reviews before deciding",
    ],
  },
  {
    plugin: "dreamspace-contracts",
    skill: "deploy-contract",
    lifecycle: "Deploy",
    stage: 4,
    languages: ["Solidity", "TypeScript"],
    cardDescription:
      "Deploy a Solidity contract to an EVM chain via forge create, gated behind a mainnet confirmation prompt.",
    highlights: [
      "forge create wrapped with mainnet confirmation gate",
      "Idempotent .deploy-state.json prevents accidental redeploy",
      "Hands off to block-explorer verification post-deploy",
    ],
  },
];

function parseFrontmatter(src: string): Record<string, string> {
  const match = src.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  const lines = match[1].split("\n");
  let currentKey: string | null = null;
  let currentVal = "";
  let multiline = false;

  const commit = () => {
    if (currentKey) {
      fm[currentKey] = currentVal.trim().replace(/\s+/g, " ");
    }
  };

  for (const line of lines) {
    const kv = line.match(/^([a-z_][a-z_0-9]*):\s*(.*)$/i);
    if (kv && !multiline) {
      commit();
      currentKey = kv[1];
      const v = kv[2];
      if (v === ">-" || v === "|" || v === ">" || v === "|-") {
        currentVal = "";
        multiline = true;
      } else {
        currentVal = v;
        multiline = false;
      }
    } else if (currentKey && (multiline || /^\s/.test(line))) {
      currentVal += " " + line.trim();
    }
  }
  commit();
  return fm;
}

function loadSkills(): SkillCard[] {
  const repoRoot = process.cwd();
  return SKILL_SPECS.map((spec) => {
    const fp = path.join(
      repoRoot,
      "packages/plugins",
      spec.plugin,
      "skills",
      spec.skill,
      "SKILL.md",
    );
    const src = fs.readFileSync(fp, "utf8");
    const fm = parseFrontmatter(src);
    return {
      name: fm.name || spec.skill,
      // Card uses the curated short copy — frontmatter description is verbose AI-targeted prose.
      description: spec.cardDescription,
      plugin: spec.plugin,
      lifecycle: spec.lifecycle,
      highlights: spec.highlights,
      languages: spec.languages,
      githubUrl: `https://github.com/biffbuster/sxt-tools/blob/main/packages/plugins/${spec.plugin}/skills/${spec.skill}/SKILL.md`,
      status: spec.status ?? "stable",
    } satisfies SkillCard;
  });
}

const PIPELINE_STEPS = [
  { label: "CSV / Parquet / JSON", sub: "Local file" },
  { label: "SXT chain", sub: "Substrate RPC" },
  { label: "MAINNET indexer", sub: "Catalog promotion" },
  { label: "Proof plan", sub: "commitments_v1_evmProofPlan" },
  { label: "Your contract", sub: "OnchainQuery.sol" },
  { label: "QueryRouter", sub: "Base mainnet" },
  { label: "Verifier", sub: "~150K gas" },
  { label: "Callback event", sub: "QueryRow / QueryFulfilled" },
];

export default function DocsPage() {
  const skills = loadSkills();

  return (
    <div className="skills-page">
      {/* Hero */}
      <header className="skills-hero" id="skills">
        <div className="skills-hero-logo">
          <img src="/sxt-skills-logo.jpg" alt="" />
        </div>
        <div className="skills-hero-body">
          <h1 className="skills-hero-title">Skills</h1>
          <p className="skills-hero-subtitle">
            Protocol-aware agent skills for the Space and Time stack. A publish-and-prove
            pipeline that takes a CSV from a local file to a Base-mainnet event a smart
            contract can verify cryptographically — Claude Code today, portable Markdown
            for tomorrow's runtimes.
          </p>
          <ul className="skills-hero-stats">
            <li>
              <span className="skills-stat-dot" /> {skills.length} published skills
            </li>
            <li>
              <span className="skills-stat-dot" /> 3 plugins
            </li>
            <li>
              <span className="skills-stat-dot" /> Canonical{" "}
              <code>packages/plugins/*/skills/*/SKILL.md</code> source
            </li>
            <li>
              <span className="skills-stat-dot" />{" "}
              <a
                href="https://github.com/biffbuster/sxt-tools"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/biffbuster/sxt-tools
              </a>
            </li>
          </ul>
        </div>
      </header>

      {/* Two-column body: facet rail + catalog */}
      <div className="skills-body">
        <aside className="skills-facet-rail" aria-label="Skill facets">
          <section className="skills-facet">
            <h4 className="skills-facet-title">Supported runtimes</h4>
            <ul className="skills-facet-list">
              <li className="skills-facet-item">
                <span className="skills-facet-logo">
                  <img src="/anthropic-logo.png" alt="" />
                </span>
                <span>Claude Code</span>
              </li>
              <li className="skills-facet-item skills-facet-item-locked" title="Codex support coming">
                <span className="skills-facet-logo skills-facet-logo-locked">
                  <svg width="14" height="14" viewBox="0 0 320 320" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68C187.93 9.45 165.93-.07 142.95-.07c-35.16 0-66.3 22.78-77 56.55-22.51 4.62-41.94 18.73-53.31 38.71-17.59 30.32-13.58 68.51 9.92 94.51-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.46 17.36 37.46 26.88 60.45 26.88 35.16 0 66.3-22.78 77-56.55 22.51-4.62 41.94-18.73 53.31-38.71 17.59-30.32 13.58-68.51-9.92-94.51zm-120.28 168.11c-14.03 0-27.59-4.91-38.34-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.97-59.96 60.07zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.93-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08L74.1 184.2c-28.64-16.57-38.45-53.2-21.94-81.84zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.16c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74V82.97c.02-33.12 26.89-59.96 60.04-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"
                    />
                  </svg>
                </span>
                <span>Codex <span className="skills-facet-locked-tag">soon</span></span>
              </li>
              <li className="skills-facet-item skills-facet-item-locked" title="Gemini support coming">
                <span className="skills-facet-logo skills-facet-logo-locked">
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M12 24L9.4 16.6 2 14l7.4-2.6L12 4l2.6 7.4L22 14l-7.4 2.6L12 24z" />
                  </svg>
                </span>
                <span>Gemini <span className="skills-facet-locked-tag">soon</span></span>
              </li>
            </ul>
          </section>

          <section className="skills-facet">
            <h4 className="skills-facet-title">Networks</h4>
            <ul className="skills-facet-list">
              <li className="skills-facet-item">
                <span className="skills-facet-logo">
                  <img src="/sxt-skills-logo.jpg" alt="" />
                </span>
                SXT chain (mainnet)
              </li>
              <li className="skills-facet-item">
                <span className="skills-facet-logo">
                  <img src="/chain-base.svg" alt="" />
                </span>
                Base mainnet
              </li>
              <li className="skills-facet-item">
                <span className="skills-facet-logo">
                  <img src="/chain-ethereum.png" alt="" />
                </span>
                Ethereum mainnet
              </li>
            </ul>
          </section>

          <section className="skills-facet">
            <h4 className="skills-facet-title">Top languages</h4>
            <ul className="skills-facet-list">
              <li className="skills-facet-item">
                <span className="skills-facet-logo">
                  <img src="/lang-typescript.png" alt="" />
                </span>
                TypeScript
              </li>
              <li className="skills-facet-item">
                <span className="skills-facet-logo">
                  <img src="/lang-solidity.png" alt="" />
                </span>
                Solidity
              </li>
              <li className="skills-facet-item">
                <span className="skills-facet-logo">
                  <img src="/lang-javascript.png" alt="" />
                </span>
                JavaScript
              </li>
            </ul>
          </section>

          <section className="skills-facet">
            <h4 className="skills-facet-title">Maintainer</h4>
            <ul className="skills-facet-list">
              <li className="skills-facet-item">
                <span className="skills-facet-avatar">bb</span>
                <a
                  href="https://github.com/biffbuster"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  biffbuster
                </a>
              </li>
            </ul>
          </section>
        </aside>

        <div className="skills-main-col">
          <SkillsCatalog skills={skills} />
        </div>
      </div>

      {/* Plugins overview */}
      <section className="skills-plugins-section" id="plugins">
        <h2 className="skills-section-title">Plugins</h2>
        <p className="skills-section-lede">
          Three plugins bundle the seven skills by lifecycle stage. Install one or all.
        </p>
        <div className="skills-plugin-grid">
          <div className="skills-plugin-card">
            <div className="skills-plugin-card-name">dreamspace-data</div>
            <div className="skills-plugin-card-desc">
              Publish CSVs to SXT chain as Proof-of-SQL-queryable tables, or register EVM
              contracts for event indexing.
            </div>
            <div className="skills-plugin-card-skills">
              2 skills · dataset-publish, index-contract
            </div>
          </div>
          <div className="skills-plugin-card">
            <div className="skills-plugin-card-name">dreamspace-query</div>
            <div className="skills-plugin-card-desc">
              Verifiable SQL against published tables and SXT&apos;s pre-indexed Ethereum core.
              Foundations + REST execution with proof receipts.
            </div>
            <div className="skills-plugin-card-skills">
              3 skills · proof-of-sql-foundations, run-proven-query, chain-data-query
            </div>
          </div>
          <div className="skills-plugin-card">
            <div className="skills-plugin-card-name">dreamspace-contracts</div>
            <div className="skills-plugin-card-desc">
              Audit and deploy Solidity contracts that consume Proof of SQL on Base or Ethereum.
            </div>
            <div className="skills-plugin-card-skills">
              2 skills · pre-deploy-audit, deploy-contract
            </div>
          </div>
        </div>
      </section>

      {/* Install */}
      <section className="skills-install-section" id="install">
        <h2 className="skills-section-title">Install</h2>
        <p className="skills-section-lede">
          One marketplace add, then any subset of the three plugins. Each skill is a
          single Markdown file with YAML frontmatter — no SDK install, no runtime servers,
          no API tokens bundled.
        </p>
        <pre className="skills-install-block">
          <code>{`/plugin marketplace add biffbuster/sxt-tools
/plugin install dreamspace-data@sxt-tools
/plugin install dreamspace-query@sxt-tools
/plugin install dreamspace-contracts@sxt-tools`}</code>
        </pre>
      </section>

      {/* Architecture flow */}
      <section className="skills-flow-section" id="architecture">
        <h2 className="skills-section-title">Architecture</h2>
        <p className="skills-section-lede">
          Eight steps, three networks, one verifiable Base-mainnet event. The skills wrap
          each step — the protocol does the rest.
        </p>
        <ol className="skills-flow">
          {PIPELINE_STEPS.map((step, i) => (
            <li className="skills-flow-step" key={step.label}>
              <div className="skills-flow-step-num">{i + 1}</div>
              <div className="skills-flow-step-body">
                <div className="skills-flow-step-label">{step.label}</div>
                <div className="skills-flow-step-sub">{step.sub}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Repo layout */}
      <section className="skills-repo-section">
        <h2 className="skills-section-title">Repo layout</h2>
        <pre className="skills-install-block">
          <code>{`.
├── .claude-plugin/marketplace.json     marketplace manifest (3 plugins)
├── packages/plugins/                   the 5 shipped skills
├── examples/
│   ├── data/sxt_stakers.csv            demo dataset (2,062 staker addrs)
│   ├── data/proof-plans/               EVM proof plan artifacts
│   ├── contracts/sxt-onchain-query/
│   │   ├── src/StakersQuery/           hand-curated demo contract
│   │   ├── src/OnchainQuery/           generated for any user table
│   │   └── templates/                  generic contract template
│   └── scripts/                        bootstrap + the 8-step pipeline
└── src/app/                            this docs site (Next.js)`}</code>
        </pre>
      </section>

      {/* Next */}
      <section className="skills-next-section">
        <h2 className="skills-section-title">Where next</h2>
        <ul className="skills-next-list">
          <li>
            Run it end-to-end:{" "}
            <Link href="/docs/quick-start">Quick start</Link>
          </li>
          <li>
            Architecture deep dive:{" "}
            <a
              href="https://github.com/biffbuster/sxt-tools/blob/main/docs/HOW_IT_WORKS.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              HOW_IT_WORKS.md ↗
            </a>
          </li>
          <li>
            Underlying primitives:{" "}
            <Link href="/docs/space-and-time">Space and Time primitives</Link>
          </li>
          <li>
            Generation flow:{" "}
            <Link href="/docs/generate-audit-deploy">Generate, audit & deploy</Link>
          </li>
        </ul>
      </section>

      {/* Verified live on Base — proof footer */}
      <div className="docs-callout docs-callout-info skills-verified">
        <div className="docs-callout-title">Verified live on Base mainnet</div>
        End-to-end pipeline confirmed 2026-05-04 — a 2,062-row CSV was published to SXT
        chain, deployed as <code>OnchainQuery.sol</code> at{" "}
        <a
          href="https://basescan.org/address/0x1fc02a8dc0A4050B2DA5D075838F37705fcF0Aa1"
          target="_blank"
          rel="noopener noreferrer"
        >
          <code>0x1fc02a8d…</code>
        </a>
        , queried via <code>IQueryRouter.requestQuery</code>, and fulfilled in 3 blocks.{" "}
        <a
          href="https://basescan.org/tx/0xd702a4014ec5258a032b39bf9dcfceea838aed51c519d9285f463c1eb23e25b0"
          target="_blank"
          rel="noopener noreferrer"
        >
          QueryFulfilled callback on BaseScan ↗
        </a>
      </div>
    </div>
  );
}
