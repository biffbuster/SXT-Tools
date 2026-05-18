import Link from "next/link";

export default function QuickStart() {
  return (
    <>
      <h1>Quick start</h1>
      <p className="docs-subtitle">
        From a fresh clone to a verified Proof of SQL event on Base mainnet. Covers setup, Claude Code wiring (MCP + plugins), a free dry-run against a real published table, and the full on-chain pipeline.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">What you&apos;ll have at the end</div>
        A deployed Solidity contract on Base mainnet whose <code>QueryRow</code> event log is a Proof of SQL receipt, validated by the on-chain Verifier in ~150K gas. No trust assumption in SXT, the API, or your wallet.
      </div>

      <h2 id="prerequisites">Prerequisites</h2>

      <h3>Software</h3>
      <ul>
        <li><strong>Node.js 20+</strong></li>
        <li><strong>Foundry</strong>: <code>curl -L https://foundry.paradigm.xyz | bash &amp;&amp; foundryup</code></li>
        <li><strong>Claude Code CLI</strong> (or Claude Desktop / Cursor / ChatGPT Developer Mode)</li>
      </ul>

      <h3>Credentials</h3>
      <ul>
        <li><strong>SXT API key</strong> — free signup at <a href="https://chain.spaceandtime.io" target="_blank" rel="noopener noreferrer">chain.spaceandtime.io</a> → API Authentication</li>
        <li><strong>Ethereum private key</strong> (0x-prefixed) — signs both SXT chain extrinsics and Base transactions. Generate with <code>node bootstrap.mjs --new-wallet</code> if you don&apos;t have one.</li>
      </ul>

      <h3>Funding (only for on-chain steps)</h3>
      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">Funding requirements</div>
        <ul style={{ marginTop: 8, marginBottom: 0 }}>
          <li><strong>SXT chain native</strong>: ≥ 1 SxT for publish fees. Fund via the <code>SXTChainFunding</code> contract on Ethereum mainnet (<code>0xb1bc1d7eb1e6c65d0de909d8b4f27561ef568199</code>): <code>approve</code> SXT, then <code>fundAddress(yourAddress, amount)</code>.</li>
          <li><strong>Base ETH</strong>: ~0.005 ETH for deploy + approve + query gas.</li>
          <li><strong>Base SXT (ERC-20)</strong>: ≥ 100 SXT per <code>query()</code>. Token: <code>0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8</code>.</li>
        </ul>
      </div>

      <h2 id="setup">1. Setup</h2>
      <pre><code>{`$ git clone https://github.com/biffbuster/sxt-tools.git
$ cd sxt-tools
$ npm install                            # postinstall builds MCP + scripts deps
$ cp examples/scripts/.env.example examples/scripts/.env
$ # edit examples/scripts/.env — set SXT_API_KEY and PRIVATE_KEY`}</code></pre>

      <p>Verify wallet funding:</p>
      <pre><code>{`$ cd examples/scripts && node bootstrap.mjs --status
▶ Verdict: GO — all prerequisites met. Pipeline can run end-to-end.`}</code></pre>

      <h2 id="verify">2. Verify the MCP server (free)</h2>
      <p>
        Run the parity test. It calls the same proven query two ways (through the MCP server and via the SDK directly), then diffs canonical results. If they match, the MCP wrapping is correct.
      </p>
      <pre><code>{`$ node examples/scripts/mcp-parity-test.mjs
  Path A: via MCP server (sxt.run_proven_query tool)…  ✓ verified=true  ROW_COUNT=2062
  Path B: direct SDK call (verify-stakers.mjs equiv)…   ✓ verified=true  ROW_COUNT=2062
  ✓ Parity confirmed.`}</code></pre>
      <p>Cost: 1 API tick, zero chain spend.</p>

      <h2 id="wire-claude">3. Wire into Claude Code</h2>
      <p>Three commands. Everything is local; nothing is published.</p>

      <pre><code>{`# 3.1 Register the MCP server (local scope keeps keys out of the repo)
$ set -a && . examples/scripts/.env && set +a
$ claude mcp add sxt \\
    -s local \\
    -e SXT_API_KEY="$SXT_API_KEY" \\
    -e PRIVATE_KEY="$PRIVATE_KEY" \\
    -e SXT_MCP_ALLOW_MAINNET="I-UNDERSTAND" \\
    -- node "$(pwd)/packages/mcp/sxt-mcp/dist/index.js"

# 3.2 Add the local marketplace (points Claude at .claude-plugin/marketplace.json)
$ claude plugin marketplace add "$(pwd)"

# 3.3 Install the three plugins
$ claude plugin install dreamspace-data@sxt-tools
$ claude plugin install dreamspace-query@sxt-tools
$ claude plugin install dreamspace-contracts@sxt-tools`}</code></pre>

      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">Restart your Claude Code session</div>
        MCP and plugin changes don&apos;t apply to running sessions. Quit and reopen <code>claude</code> in the repo. Confirm with <code>/mcp</code> and <code>/plugin</code>.
      </div>

      <h2 id="demo-prompts">4. Demo prompts (free, against a real table)</h2>
      <p>
        The repo ships with one published table on SXT mainnet (<code>MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS</code>, 2,062 rows). Use it to exercise the wiring without spending on-chain.
      </p>

      <h3>Count rows (~1 API tick)</h3>
      <pre><code>{`Use the run-proven-query skill via the sxt MCP to count rows in
MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS.
Report verified=true/false and the row count.`}</code></pre>

      <h3>Positive + negative membership (~2 API ticks)</h3>
      <pre><code>{`Use the run-proven-query skill to do two proof queries via the sxt MCP
against MY_AUDIT_V2_5731EC0BBEB5F7BCAA2E4BAF3179A7A4C59C2552.STAKERS:

  1. Confirm staker 0x45c56e138881fd3ff46359ba1826d5fc6fccaedc IS in the table.
  2. Confirm 0x0000000000000000000000000000000000000000 is NOT in the table.

Report verified=true/false for each.`}</code></pre>
      <p>Exercises both proof shapes the on-chain contracts use.</p>

      <h2 id="run">5. Run the full pipeline (~$10–15)</h2>
      <pre><code>{`$ node bootstrap.mjs --run`}</code></pre>
      <p>
        Executes <strong>publish → save proof plans → render → compile → deploy → approve → query</strong> and stops on the first failure. Final output: the staker address from the verified callback event, four transaction hashes, and the deployed contract address.
      </p>

      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">Off-chain prove before on-chain spend</div>
        The off-chain <code>/v1/zkquery</code> step is the gate. If it returns 422, do <strong>not</strong> continue. A 422 means your table didn&apos;t make it into the MAINNET catalog (usually a <code>PRIMARY KEY</code> in the DDL). Continuing burns 100 SXT, locked for 1 hour.
      </div>

      <h2 id="own-csv">Use your own CSV</h2>
      <p>
        SXT auto-suffixes the namespace with your wallet&apos;s address. Same scripts, different inputs:
      </p>
      <pre><code>{`$ DEMO_CSV=/abs/path/to/your.csv \\
    DEMO_TABLE_REF="DEMO.MYTABLE_$(date +%s)" \\
    SXT_LOOKUP_COLUMN=EMAIL \\
    SXT_POINT_LOOKUP=alice@example.com \\
    npm run demo:fullpipeline`}</code></pre>
      <p>
        Seven steps with confirmation prompts between each. Add <code>--rehearse</code> to skip the 100-SXT climax, or <code>--from=N</code> to resume after a failure.
      </p>
      <p>
        The renderer maps SQL types (<code>VARCHAR</code>, <code>BIGINT</code>, <code>BOOLEAN</code>, <code>TIMESTAMP</code>, <code>INT</code>, <code>BINARY</code>, <code>TINYINT</code>, <code>SMALLINT</code>) to the appropriate <code>ProofOfSqlTable</code> reader and emits a <code>QueryRow</code> event with one parameter per projected column.
      </p>

      <h2 id="contracts">Contracts you&apos;ll interact with</h2>
      <table className="comparison-table">
        <thead>
          <tr><th>Contract</th><th>Base mainnet</th><th>Ethereum mainnet</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>QueryRouter</strong></td>
            <td><code>0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB</code></td>
            <td><code>0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB</code></td>
          </tr>
          <tr>
            <td><strong>Verifier</strong> (HyperKZG)</td>
            <td><code>0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518</code></td>
            <td><code>0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9</code></td>
          </tr>
          <tr>
            <td><strong>SXT</strong> (ERC-20)</td>
            <td><code>0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8</code></td>
            <td><code>0xE6Bfd33F52d82Ccb5b37E16D3dD81f9FFDAbB195</code></td>
          </tr>
        </tbody>
      </table>
      <p>
        Method signatures and the contract internals (proof plan format, <code>queryCallback</code>, <code>cancelQuery</code>) are documented in <Link href="/docs/space-and-time">Space and Time primitives</Link>.
      </p>

      <h2 id="troubleshooting">Failure-mode quick reference</h2>
      <table className="comparison-table">
        <thead>
          <tr><th>Symptom</th><th>First check</th><th>Likely cause</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>422 &quot;does not exist in source network MAINNET&quot;</td>
            <td>Did the publish use <code>PRIMARY KEY</code>?</td>
            <td>PK in DDL — indexer silently skips. Republish without it under a new namespace.</td>
          </tr>
          <tr>
            <td>400 &quot;source network not supported&quot;</td>
            <td><code>sourceNetwork</code> value in request body</td>
            <td>Must be literal <code>&quot;MAINNET&quot;</code> — uppercase, case-sensitive.</td>
          </tr>
          <tr>
            <td><code>401 SECURITY: Invalid JWT</code></td>
            <td>Did you exchange the API key first?</td>
            <td>Send raw key to <code>/auth/apikey</code> (header <code>apikey:</code>), then use the returned <code>accessToken</code> as Bearer.</td>
          </tr>
          <tr>
            <td><code>query()</code> times out at 1 hour</td>
            <td><code>node check-executor-activity.mjs 48</code></td>
            <td>If executor is live but yours skipped, the table isn&apos;t in the MAINNET catalog.</td>
          </tr>
          <tr>
            <td>Deploy: &quot;Already deployed at 0x…&quot;</td>
            <td><code>.deploy-state.json</code> exists</td>
            <td>Delete it to force redeploy.</td>
          </tr>
          <tr>
            <td>Renderer: <code>--name StakersQuery refused</code></td>
            <td>Overwriting the canonical contract</td>
            <td>Use a different <code>--name</code>. <code>StakersQuery.sol</code> is hand-curated.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="next">Next</h2>
      <ul>
        <li>The five skills with trigger phrases and refusal rules: <Link href="/docs">Skills catalog</Link></li>
        <li>MCP server tools, transport, and roadmap: <Link href="/docs/mcp">MCP integration</Link></li>
        <li>Protocol primitives (Proof of SQL, QueryRouter, Verifier): <Link href="/docs/space-and-time">Space and Time primitives</Link></li>
        <li>Architecture deep-dive: <a href="https://github.com/biffbuster/sxt-tools/blob/main/HOW_IT_WORKS.md" target="_blank" rel="noopener noreferrer">HOW_IT_WORKS.md</a></li>
      </ul>
    </>
  );
}
