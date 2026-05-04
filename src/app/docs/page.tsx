import Link from "next/link";

export default function DocsOverview() {
  return (
    <>
      <h1>SXT Tools</h1>
      <p className="docs-subtitle">
        An agent skills marketplace for the Space and Time stack. Five protocol-aware skills compose a publish-and-prove pipeline that takes a CSV from a local file to a Base-mainnet event a smart contract can verify cryptographically. <strong>Claude Code is the first supported agent runtime;</strong> the skill format is portable Markdown, so additional agent integrations land cleanly without changing the skills.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">Implemented and runnable in this repo</div>
        Five skills ship in <code>packages/plugins/</code>. The canonical demo dataset (<code>examples/data/sxt_stakers.csv</code>) is published to SXT mainnet; the bootstrap script wires the whole pipeline; the <code>StakersQuery.sol</code> contract is audit-clean and deploys to Base mainnet. See the README at the repo root for the run-it-yourself walkthrough.
      </div>

      <h2 id="install">Install the marketplace</h2>
      <pre>
        <code>{`/plugin marketplace add biffbuster/sxt-tools
/plugin install dreamspace-data@sxt-tools
/plugin install dreamspace-query@sxt-tools
/plugin install dreamspace-contracts@sxt-tools`}</code>
      </pre>
      <p>
        Three plugins, five skills. Each skill is a single Markdown file with YAML frontmatter — no SDK installed, no runtime servers, no API tokens bundled.
      </p>

      <h2 id="quick-nav">Where to start</h2>
      <div className="docs-quicknav-grid">
        <Link href="/docs/quick-start" className="docs-quicknav-card">
          <div className="docs-quicknav-card-title">Quick start</div>
          <div className="docs-quicknav-card-desc">
            Five commands from a fresh clone to a verified Base-mainnet event. The bootstrap script wires the prereqs check, balance probes, and pipeline runner.
          </div>
        </Link>
        <Link href="/docs/spaceandtime-ai/overview" className="docs-quicknav-card">
          <div className="docs-quicknav-card-title">What this repo ships</div>
          <div className="docs-quicknav-card-desc">
            Architecture of the publish-and-prove pipeline, the chain rules the skills carry for you, and the loop diagram showing where each skill fits.
          </div>
        </Link>
        <Link href="/docs/spaceandtime-ai/skills" className="docs-quicknav-card">
          <div className="docs-quicknav-card-title">Skills catalog</div>
          <div className="docs-quicknav-card-desc">
            All five shipped skills with their trigger phrases, refusal rules, and the SKILL.md format reference for authoring more.
          </div>
        </Link>
        <Link href="/docs/space-and-time" className="docs-quicknav-card">
          <div className="docs-quicknav-card-title">Space and Time primitives</div>
          <div className="docs-quicknav-card-desc">
            Background reading on the SXT pieces the skills touch — Proof of SQL surface, EVM proof plan flow, QueryRouter + Onchain Verifier addresses.
          </div>
        </Link>
      </div>

      <h2 id="what-it-does">How the pipeline works</h2>
      <p>
        A user types a prompt into Claude Code. The agent loads the matching skill, reads the chain rules baked into the SKILL.md, and runs the workflow. Five skills, eight steps, three networks, one verifiable Base-mainnet event:
      </p>
      <ol style={{ paddingLeft: "20px", color: "var(--light-grey)", fontSize: "15px", lineHeight: "1.85", marginBottom: "20px" }}>
        <li><strong>Publish.</strong> <code>dreamspace-data:dataset-publish</code> infers a schema from the user&apos;s CSV, batches <code>tables.createNamespace</code> + <code>tables.createTables</code> on SXT chain, encodes data as Apache Arrow IPC, and submits via <code>indexing.submitData</code>.</li>
        <li><strong>Plan.</strong> <code>dreamspace-query:run-proven-query</code> validates the SQL against the proven surface, then calls the chain RPC method <code>commitments_v1_evmProofPlan</code> for an EVM-encoded query plan + the chain state hash that anchors any future proof.</li>
        <li><strong>Render.</strong> The render script substitutes the proof plan + column types into a Solidity template; the result compiles clean against the pinned SXT and OpenZeppelin Soldeer dependencies.</li>
        <li><strong>Audit.</strong> <code>dreamspace-contracts:pre-deploy-audit</code> runs <code>forge build</code>, optional slither, optional cross-references against published SXT reference tables, and writes a structured <code>AUDIT_REPORT.md</code>.</li>
        <li><strong>Deploy.</strong> <code>dreamspace-contracts:deploy-contract</code> wraps <code>forge create</code> with a mainnet confirmation gate, env-var key handling, and an idempotent state file.</li>
        <li><strong>Verify.</strong> The deployed contract&apos;s <code>query()</code> function pulls 100 SXT from the caller, dispatches the request through the QueryRouter contract on Base mainnet (project default for cheap gas; Ethereum mainnet works identically), and waits for the SXT executor&apos;s callback. The callback verifies the Proof of SQL receipt against the on-chain Verifier in ~150K gas before invoking the contract&apos;s callback handler — which decodes the result and emits an event a smart contract can rely on without trusting SXT, the API, or the publishing wallet.</li>
      </ol>

      <h2 id="repo-layout">Repo layout</h2>
      <pre>
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

      <h2 id="next">Next</h2>
      <ul>
        <li>Run it: <Link href="/docs/quick-start">Quick start</Link>.</li>
        <li>Understand it: <Link href="/docs/spaceandtime-ai/overview">What this repo ships</Link>.</li>
        <li>Use the catalog: <Link href="/docs/spaceandtime-ai/skills">Skills catalog</Link>.</li>
        <li>Read the underlying primitives: <Link href="/docs/space-and-time">Space and Time primitives</Link>.</li>
      </ul>
    </>
  );
}
