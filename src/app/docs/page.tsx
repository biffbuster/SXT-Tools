import Link from "next/link";

export default function DocsOverview() {
  return (
    <>
      <h1>SXT Tools</h1>
      <p className="docs-subtitle">
        An agent skills marketplace for the Space and Time stack. Five protocol-aware skills compose a publish-and-prove pipeline that takes a CSV from a local file to a Base-mainnet event a smart contract can verify cryptographically. <strong>Claude Code is the first supported agent runtime;</strong> the skill format is portable Markdown, so additional agent integrations land cleanly without changing the skills.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">Verified live on Base mainnet</div>
        End-to-end pipeline confirmed 2026-05-04 — a 2 062-row CSV was published to SXT chain, deployed as <code>OnchainQuery.sol</code> at <a href="https://basescan.org/address/0x1fc02a8dc0A4050B2DA5D075838F37705fcF0Aa1" target="_blank" rel="noopener noreferrer"><code>0x1fc02a8d…</code></a>, queried via <code>IQueryRouter.requestQuery</code>, and the SXT executor fulfilled the proof in 3 blocks. <a href="https://basescan.org/tx/0xd702a4014ec5258a032b39bf9dcfceea838aed51c519d9285f463c1eb23e25b0" target="_blank" rel="noopener noreferrer">QueryFulfilled callback on BaseScan</a>. The <code>QueryRow</code> event proves <code>0x45c5…aedc</code> is a member of the published table.
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
        <a href="https://github.com/biffbuster/sxt-tools/blob/main/HOW_IT_WORKS.md" target="_blank" rel="noopener noreferrer" className="docs-quicknav-card">
          <div className="docs-quicknav-card-title">How it works</div>
          <div className="docs-quicknav-card-desc">
            Architecture of the publish-and-prove pipeline, what Claude Code reads, and a sample three-prompt conversation that takes a CSV to a verified Base event.
          </div>
        </a>
        <a href="https://github.com/biffbuster/sxt-tools/tree/main/packages/plugins" target="_blank" rel="noopener noreferrer" className="docs-quicknav-card">
          <div className="docs-quicknav-card-title">Skills catalog</div>
          <div className="docs-quicknav-card-desc">
            All five shipped <code>SKILL.md</code> files with their trigger phrases, refusal rules, and example invocations — read directly from the plugins directory.
          </div>
        </a>
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
        <li>Understand it: <a href="https://github.com/biffbuster/sxt-tools/blob/main/HOW_IT_WORKS.md" target="_blank" rel="noopener noreferrer">HOW_IT_WORKS.md</a> on GitHub — architecture + sample agent conversation.</li>
        <li>Use the catalog: <a href="https://github.com/biffbuster/sxt-tools/tree/main/packages/plugins" target="_blank" rel="noopener noreferrer">packages/plugins/</a> — all five <code>SKILL.md</code> files.</li>
        <li>Read the underlying primitives: <Link href="/docs/space-and-time">Space and Time primitives</Link>.</li>
      </ul>
    </>
  );
}
