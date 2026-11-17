import Link from "next/link";

// The hosted connector URL. Swap in the production domain when it is attached.
const HOSTED_URL = "https://mcp.example.com/mcp";

export default function McpPage() {
  return (
    <>
      <h1>MCP server</h1>
      <p className="docs-subtitle">
        Ask questions about Ethereum and your own published data from Claude, ChatGPT,
        Cursor or any other MCP client. Every answer comes back with a Proof of SQL proof,
        and the server verifies that proof before your agent sees the result.
      </p>

      <div className="docs-callout">
        <div className="docs-callout-title">Status: v0.4.0, hosted launch pending</div>
        <p>
          The hosted connector and the npm package are built and tested. The public URL
          and the npm release go live together. Until then, run it locally from source
          (see <a href="#local">Run it locally</a>).
        </p>
        <p>
          <strong>Built in partnership with Space and Time.</strong>
        </p>
      </div>

      <h2 id="connect">Connect in three steps</h2>
      <ol>
        <li>
          Get a Space and Time API key with an active subscription at{" "}
          <a href="https://app.spaceandtime.ai" target="_blank" rel="noopener noreferrer">
            app.spaceandtime.ai
          </a>{" "}
          (API Authentication).
        </li>
        <li>
          Add this URL to your client as a remote MCP server: <code>{HOSTED_URL}</code>
        </li>
        <li>
          Sign in once in the browser window that opens and paste your key. SXT checks it,
          and your client stores it inside an encrypted token. The server keeps no copy.
        </li>
      </ol>
      <p>
        Queries are billed to your own SXT account. Finding tables and compiling plans is
        free.
      </p>

      <h2 id="setup">Setup by client</h2>

      <h3>Claude (web and desktop)</h3>
      <p>
        Go to Customize, then Connectors, then <strong>Add custom connector</strong>. Paste
        the URL and click Connect.
      </p>

      <h3>Claude Code</h3>
      <pre>
        <code>{`claude mcp add --transport http sxt ${HOSTED_URL}`}</code>
      </pre>
      <p>
        Then run <code>/mcp</code> inside Claude Code to finish signing in.
      </p>

      <h3>Cursor</h3>
      <p>
        In <code>~/.cursor/mcp.json</code>, or through Cursor Settings, then MCP:
      </p>
      <pre>
        <code>{`{
  "mcpServers": {
    "sxt": { "url": "${HOSTED_URL}" }
  }
}`}</code>
      </pre>

      <h3>ChatGPT</h3>
      <p>
        Turn on Developer mode, then add a connector with the URL above. ChatGPT runs the
        same sign-in flow.
      </p>

      <h3>Agents and scripts</h3>
      <p>
        Clients that cannot open a browser skip sign-in and send the key on every request:
      </p>
      <pre>
        <code>{`X-SXT-API-Key: <your SXT API key>`}</code>
      </pre>

      <h2 id="ask">What you can ask</h2>
      <ul>
        <li>&quot;Which tables can I prove queries against?&quot;</li>
        <li>&quot;Find a public iris dataset and prove the first five rows.&quot;</li>
        <li>&quot;How large was block 20,000,000 and how many transactions did it hold? Prove it.&quot;</li>
        <li>&quot;Is this wallet in the allowlist table I published?&quot;</li>
        <li>&quot;Compile this query into a plan my Base contract can submit.&quot;</li>
      </ul>
      <p>
        The agent finds the right table and its columns on its own, writes SQL that the
        prover accepts, and returns rows with a verified proof.
      </p>

      <h2 id="tools">Tools</h2>
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>What it does</th>
            <th>Cost</th>
            <th>Where</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>sxt.list_tables</code></td>
            <td>
              Every public table on SXT mainnet: Ethereum blocks plus the tables other users have
              published, with size and date. Search, filter by namespace, page through.
            </td>
            <td>Free</td>
            <td>Hosted, local</td>
          </tr>
          <tr>
            <td><code>sxt.describe_table</code></td>
            <td>Whether any table (including one you published) can be proven, plus its exact columns and types.</td>
            <td>Free</td>
            <td>Hosted, local</td>
          </tr>
          <tr>
            <td><code>sxt.run_proven_query</code></td>
            <td>
              Runs a SELECT on any public table with a proof, verifies the proof, returns readable
              rows. SQL the prover cannot prove is refused first, for free. Long proofs return a
              query id.
            </td>
            <td>One query credit</td>
            <td>Hosted, local</td>
          </tr>
          <tr>
            <td><code>sxt.get_proof_result</code></td>
            <td>Picks up a long-running proof by its query id.</td>
            <td>Free</td>
            <td>Hosted, local</td>
          </tr>
          <tr>
            <td><code>sxt.generate_proof_plan</code></td>
            <td>Compiles SQL into the plan a Solidity contract submits to the onchain QueryRouter.</td>
            <td>Free</td>
            <td>Hosted, local</td>
          </tr>
          <tr>
            <td><code>sxt.publish_dataset</code></td>
            <td>Publishes a CSV as a provable table.</td>
            <td>SXT chain credits</td>
            <td>Local</td>
          </tr>
          <tr>
            <td><code>sxt.audit_contract</code></td>
            <td>Runs <code>forge build</code> and <code>slither</code> on a Solidity project.</td>
            <td>Free</td>
            <td>Local</td>
          </tr>
          <tr>
            <td><code>sxt.deploy_contract</code></td>
            <td>Deploys a contract from a forge artifact.</td>
            <td>Gas</td>
            <td>Local</td>
          </tr>
        </tbody>
      </table>
      <p>
        The hosted server is read-only. Publishing and deploying need a wallet key and
        auditing needs your files, so those three tools only run on your own machine.
      </p>

      <h2 id="trust">Why you can trust the numbers</h2>
      <ul>
        <li>
          Each result carries a HyperKZG proof that the rows are the output of that SQL over
          the committed table. The server checks it before returning anything.
        </li>
        <li>
          The same proof system backs the onchain verifier on Base, so a query that proves
          here also fulfills onchain.
        </li>
        <li>
          The repo&apos;s parity test runs the same query through the MCP server and through
          the Space and Time SDK directly and compares the output.
        </li>
      </ul>

      <h2 id="security">Security</h2>
      <ul>
        <li>No database. Your key lives only inside an AES-256-GCM sealed token held by your client.</li>
        <li>OAuth 2.1 with PKCE. Refresh tokens rotate on every use.</li>
        <li>Per-user rate limits. Errors return a stable code and a request id, never upstream internals.</li>
        <li>
          Locally, mainnet writes need two switches: <code>mainnet: true</code> on the call and{" "}
          <code>SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND</code> in the server environment. Defaults
          are testnet and Sepolia.
        </li>
      </ul>

      <h2 id="local">Run it locally</h2>
      <p>
        The local server has all eight tools. Add it to Claude Desktop, Cursor or any stdio
        client:
      </p>
      <pre>
        <code>{`{
  "mcpServers": {
    "sxt": {
      "command": "npx",
      "args": ["-y", "@biffbuster/sxt-mcp"],
      "env": {
        "SXT_API_KEY": "<your SXT API key>",
        "PRIVATE_KEY": "0x<wallet key, only for publish and deploy>"
      }
    }
  }
}`}</code>
      </pre>
      <p>
        Until the npm release, build from source and point <code>command</code> at{" "}
        <code>node</code> with the path to <code>packages/mcp/sxt-mcp/dist/index.js</code>:
      </p>
      <pre>
        <code>{`git clone https://github.com/biffbuster/sxt-tools.git
cd sxt-tools && npm install   # builds the MCP server`}</code>
      </pre>
      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">Keep keys out of git</div>
        Never commit a client config file with keys in it. <code>PRIVATE_KEY</code> can spend
        funds; leave it out unless you need publish or deploy.
      </div>

      <h2 id="troubleshooting">Troubleshooting</h2>
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Error code</th>
            <th>Meaning</th>
            <th>Fix</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>SXT_KEY_INVALID</code></td>
            <td>SXT rejected the key.</td>
            <td>Reconnect with a current key from app.spaceandtime.ai.</td>
          </tr>
          <tr>
            <td><code>SXT_SUBSCRIPTION_REQUIRED</code></td>
            <td>The key works but the account has no active subscription.</td>
            <td>Activate a subscription, then retry.</td>
          </tr>
          <tr>
            <td><code>TABLE_NOT_PROVABLE</code></td>
            <td>The table does not exist or has no proof commitments.</td>
            <td>
              Check the name with <code>sxt.describe_table</code>. Tables published with a
              PRIMARY KEY never become provable; republish without it.
            </td>
          </tr>
          <tr>
            <td><code>SQL_REJECTED</code></td>
            <td>The SQL uses something the prover cannot prove. Nothing was spent.</td>
            <td>
              The message says what to change. See the{" "}
              <Link href="/docs/space-and-time">proven SQL surface</Link>. Aggregates need GROUP BY
              on one non-text column; DECIMAL and TIMESTAMP columns cannot be filtered; large
              tables need a WHERE or LIMIT.
            </td>
          </tr>
          <tr>
            <td><code>QUERY_FAILED</code></td>
            <td>The prover accepted the query but could not run it.</td>
            <td>Retrying the same SQL fails the same way. Narrow it or rewrite it.</td>
          </tr>
          <tr>
            <td><code>RATE_LIMITED</code></td>
            <td>Too many calls in a minute.</td>
            <td>Wait for the time in the message.</td>
          </tr>
          <tr>
            <td>Result says <code>pending</code></td>
            <td>The proof is still running.</td>
            <td>
              Call <code>sxt.get_proof_result</code> with the query id. It does not spend
              another credit.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="related">Related</h2>
      <ul>
        <li>
          <Link href="/docs">Skills catalog</Link>: the Claude Code skills behind the same
          pipeline
        </li>
        <li>
          <Link href="/docs/quick-start">Quick start</Link>: the <code>sxt</code> CLI from
          clone to a verified Base event
        </li>
        <li>
          <Link href="/docs/space-and-time">SXT primitives</Link>: the protocol surface the
          server uses
        </li>
        <li>
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">
            modelcontextprotocol.io
          </a>
          : the open spec
        </li>
      </ul>
    </>
  );
}
