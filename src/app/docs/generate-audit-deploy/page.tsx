import Link from "next/link";

export default function GenerateAuditDeploy() {
  return (
    <>
      <h1>Generate, audit &amp; deploy your own smart contracts</h1>
      <p className="docs-subtitle">
        The same three-step path Space and Time documents at{" "}
        <a href="https://docs.makeinfinite.com/docs/generate-audit-and-deploy-your-own-smart-contracts" target="_blank" rel="noopener noreferrer">docs.makeinfinite.com</a>{" "}
        — adapted for AI coding agents. The agent loads a SKILL.md, walks the conversation, and runs the workflow end-to-end against the Space and Time stack and Base mainnet.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">How this differs from the chatbot flow</div>
        MakeInfinite&apos;s docs describe a hosted chatbot + Code Editor + MetaMask UX. SXT Tools ships the same path as Markdown skills any AI agent can run — locally, in your terminal, with your existing wallet. No hosted chatbot, no Code Editor screen. The conversation happens in Claude Code (or any other agent that reads SKILL.md).
      </div>

      <h2 id="generation">1. Smart contract generation</h2>
      <p>
        The agent generates a Solidity consumer contract for an SXT-published table. You describe what you want in natural language; the agent loads the rendering toolchain, wires it to a published table reference, and writes a contract that compiles clean against the pinned SXT and OpenZeppelin Soldeer dependencies.
      </p>

      <h3 id="generation-prompt">What you say</h3>
      <p>Open Claude Code in a terminal and prompt the agent. Common shapes:</p>
      <pre><code>{`"Generate a Solidity contract that proves whether an address
 is in my published staker table on SXT mainnet."

"Render the OnchainQuery contract for proof plan
 ../data/proof-plans/point-lookup.json against my schema."

"Create a contract that returns the row count of MY_AUDIT.STAKERS
 with an onchain Proof of SQL receipt."`}</code></pre>

      <h3 id="generation-flow">What the agent does</h3>
      <ol>
        <li>Loads <code>dreamspace-query:proof-of-sql-foundations</code> as a guardrail to confirm the SQL fits the proven surface (SELECT, WHERE, GROUP BY, single-chain JOIN, =/≥/≤, AND/OR/NOT, +/-/*, SUM/COUNT, BOOLEAN/BIGINT/VARCHAR/DECIMAL75/TIMESTAMP).</li>
        <li>Calls <code>commitments_v1_evmProofPlan</code> on the SXT chain RPC to compile the SQL into a 255-byte EVM proof plan + a chain state hash that anchors the proof.</li>
        <li>Substitutes the proof plan and the table&apos;s column types into <code>templates/OnchainQuery.sol.template</code>; writes the resulting <code>OnchainQuery.sol</code> under <code>examples/contracts/sxt-onchain-query/src/</code>.</li>
        <li>Compiles with <code>forge build</code> against the pinned <code>sxt-proof-of-sql</code> and OpenZeppelin v5.2.0 dependencies.</li>
      </ol>
      <p>
        The agent never reconstructs proof-plan ABI or the QueryRouter handshake from scratch — those rules live in the SKILL.md files (<a href="https://github.com/biffbuster/sxt-tools/tree/main/packages/plugins" target="_blank" rel="noopener noreferrer">skills catalog</a>) and the rendering script.
      </p>

      <h3 id="generation-output">What you get</h3>
      <ul>
        <li>A typed Solidity contract pinned to one specific SQL question, against one specific SXT table, at one specific chain state.</li>
        <li>A <code>.last-rendered.json</code> state file the deploy and audit skills both read.</li>
        <li>A clean <code>forge build</code> artifact ready for the next two steps.</li>
      </ul>

      <h2 id="audit">2. Auditing your smart contract</h2>
      <p>
        Before deploy, run <code>dreamspace-contracts:pre-deploy-audit</code>. The skill produces a structured <code>AUDIT_REPORT.md</code> that combines slither static analysis with onchain due diligence — cross-referencing the contract against user-published reference tables (known-exploit signatures, drainer wallets, trusted-deployer allowlists) and indexed contract event history on SXT.
      </p>

      <h3 id="audit-prompt">What you say</h3>
      <pre><code>{`"Audit examples/contracts/sxt-onchain-query/src/OnchainQuery/OnchainQuery.sol
 before I deploy."

"Run the pre-deploy audit and tell me if anything blocks deploy."

"Cross-reference the bytecode hash of this contract against the
 known-exploits table I published earlier."`}</code></pre>

      <h3 id="audit-phases">What the agent does</h3>
      <ol>
        <li><strong>Phase 1 — Static analysis.</strong> Runs <code>slither</code> if installed; surfaces high/medium findings inline.</li>
        <li><strong>Phase 2 — Manual review heuristics.</strong> Walks the QueryRouter consumer pattern (callback selector, executor identity check, queryId provenance, replay protection via the pending-queries map).</li>
        <li><strong>Phase 3 — Onchain cross-references.</strong> Computes the bytecode hash; queries the user&apos;s SXT-published reference tables for matches against known-exploit hashes, drainer wallets in the constructor, or untrusted deployer addresses. Each cross-reference returns a Proof of SQL receipt the auditor can verify independently.</li>
        <li><strong>Phase 4 — Verdict.</strong> Writes <code>AUDIT_REPORT.md</code> next to the contract: blockers, informational notes, and the cross-reference receipts. Never certifies a contract as &quot;safe&quot; — only produces evidence.</li>
      </ol>

      <h3 id="audit-output">What you get</h3>
      <p>
        A structured Markdown report you (or a reviewer) read before deciding to ship. The skill <strong>refuses to certify safety</strong>; the verdict is &quot;no blockers found per the listed checks&quot;, and the human signs off.
      </p>

      <h2 id="deploy">3. Deploy your smart contract</h2>
      <p>
        Once the audit clears, deploy with <code>dreamspace-contracts:deploy-contract</code>. The skill wraps <code>forge create</code> with explicit network selection, gas estimation, env-var key handling, a mainnet confirmation gate, and an idempotent deploy-state file so re-runs don&apos;t double-deploy.
      </p>

      <h3 id="deploy-prompt">What you say</h3>
      <pre><code>{`"Deploy OnchainQuery.sol to Base mainnet."

"Deploy the audited contract — Base mainnet, my wallet from .env."`}</code></pre>

      <h3 id="deploy-flow">What the agent does</h3>
      <ol>
        <li>Reads <code>.last-rendered.json</code> + <code>.deploy-state.json</code> to confirm the right artifact is targeted and that no live deployment already exists for this chain.</li>
        <li>Connects to <code>https://base.publicnode.com</code> (override via <code>ETH_RPC</code>); reports network + chainId + deployer address + ETH balance before any tx.</li>
        <li>Trips the mainnet confirmation gate (5-second hold for Base or Ethereum mainnet) — Ctrl-C aborts.</li>
        <li>Submits the deploy transaction; prints the tx hash, block number, gas used, and contract address.</li>
        <li>Writes <code>.deploy-state.json</code> with <code>chainId</code>, <code>address</code>, <code>deployTxHash</code>, <code>deployBlock</code>, <code>deployer</code>, and <code>deployedAt</code>.</li>
        <li>Optionally runs source verification via <code>cast</code> if <code>ETHERSCAN_API_KEY</code> is set (BaseScan and Etherscan share the same API surface).</li>
      </ol>

      <h3 id="deploy-output">What you get</h3>
      <ul>
        <li>A deployed contract address on Base mainnet you can immediately link to on BaseScan.</li>
        <li>A persistent <code>.deploy-state.json</code> so the query script knows exactly what was deployed where.</li>
        <li>The four-tx receipt sequence (approve → query → callback) is now one prompt away — see <Link href="/docs/quick-start">Quick start</Link> for the verification step.</li>
      </ul>

      <h2 id="end-to-end">End-to-end recap</h2>
      <pre><code>{`Generate                  Audit                     Deploy
─────────                 ─────                     ──────

prompt → SKILL.md          slither  +               forge create →
proof plan render →        SXT cross-references →   tx hash + address
forge build                AUDIT_REPORT.md          on Base mainnet`}</code></pre>

      <p>
        The same three steps MakeInfinite documents — generate, audit, deploy — but the chatbot is now your local AI coding agent, the Code Editor is your existing IDE, and the deploy signer is whatever wallet you point <code>PRIVATE_KEY</code> at. The chain rules live in five SKILL.md files; the agent never reconstructs them.
      </p>

      <h2 id="next">Next</h2>
      <ul>
        <li>Run the full demo end-to-end: <Link href="/docs/quick-start">Quick start</Link>.</li>
        <li>Skill internals: <a href="https://github.com/biffbuster/sxt-tools/tree/main/packages/plugins" target="_blank" rel="noopener noreferrer">packages/plugins/</a> (the five <code>SKILL.md</code> files).</li>
        <li>The publish step that produces the table this contract reads from: <a href="https://github.com/biffbuster/sxt-tools/blob/main/docs/HOW_IT_WORKS.md" target="_blank" rel="noopener noreferrer">HOW_IT_WORKS.md</a>.</li>
        <li>Canonical SXT addresses on Base and Ethereum: <Link href="/docs/space-and-time">Space and Time primitives</Link>.</li>
      </ul>
    </>
  );
}
