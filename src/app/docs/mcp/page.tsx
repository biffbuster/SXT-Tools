import Link from "next/link";

export default function McpPage() {
  return (
    <>
      <h1>MCP integration</h1>
      <p className="docs-subtitle">
        One open-source server exposes the five SXT skills as MCP tools — callable from
        Claude Desktop, Cursor, and any other client that speaks Anthropic's Model
        Context Protocol. The skills themselves remain portable Markdown; the MCP
        server is a thin protocol adapter.
      </p>

      <div className="docs-callout">
        <div className="docs-callout-title">Status: v0.1.0 — shipped, npm publish pending</div>
        <p>
          All four <code>sxt.*</code> tools live in{" "}
          <code>packages/mcp/sxt-mcp/</code>: testnet defaults, mainnet behind a
          double-gate (<code>mainnet: true</code> arg <em>and</em>{" "}
          <code>SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND</code> env). The package is{" "}
          <code>private:true</code> pending external security review before npm
          publication; install today by building from source. Track at{" "}
          <a
            href="https://github.com/biffbuster/sxt-tools"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/biffbuster/sxt-tools
          </a>
          .
        </p>
        <p>
          <strong>Built independently — not endorsed or supported by Space and Time.</strong>{" "}
          The phased rollout + mainnet double-gate are self-imposed
          good-faith constraints, not SXT-imposed gates. Engage SXT
          engineering directly for production use cases until an official
          approval lands.
        </p>
      </div>

      <h2 id="tldr">TL;DR install</h2>
      <p>
        Build from source today:
      </p>
      <pre>
        <code>{`git clone https://github.com/biffbuster/sxt-tools.git
cd sxt-tools && npm install   # root postinstall builds the MCP server`}</code>
      </pre>
      <p>
        Once the package goes public on npm, the marketplace one-liner will be:
      </p>
      <pre>
        <code>{`claude mcp install @biffbuster/sxt`}</code>
      </pre>
      <p>
        Or paste a config block directly into your MCP host. See{" "}
        <a href="#setup">Setup by client</a> below for Claude Desktop and Cursor blocks.
      </p>

      <h2 id="why-mcp">Why MCP, not just the plugin marketplace</h2>
      <p>
        Today the seven skills install through Claude Code's plugin marketplace as
        Markdown <code>SKILL.md</code> files — works perfectly inside Claude Code, but
        nowhere else. MCP is Anthropic's open spec for connecting agents to tools and
        data. By shipping one MCP server, the same skills become callable from every
        compliant client without per-vendor SDKs. Today that's Claude Desktop and
        Cursor; soon Codex and Gemini as their MCP support lands.
      </p>
      <p>
        The skills stay the source of truth. The MCP server reads each{" "}
        <code>SKILL.md</code> and exposes it as a typed tool with structured arguments
        and the same refusal rules baked in.
      </p>

      <h2 id="tools">Tools exposed by the server</h2>
      <p>
        Each shipped skill maps to one MCP tool. Tool names are namespaced under{" "}
        <code>sxt.</code> for clean autocomplete in MCP host UIs.
      </p>

      <ul>
        <li>
          <strong>
            <code>sxt.publish_dataset</code>
          </strong>{" "}
          — wraps the <code>dataset-publish</code> skill. Args:{" "}
          <code>csvPath</code>, <code>tableRef</code> (e.g.{" "}
          <code>MY_AUDIT.KNOWN_EXPLOITS</code>),{" "}
          <code>mainnet?: boolean</code> (default <code>false</code> → testnet).
          The server auto-suffixes the namespace with the signer's uppercase hex,
          enforces NOT NULL on every column, refuses PRIMARY KEY, and is
          idempotent — catches <code>*AlreadyExists</code> errors and proceeds to
          insert. Returns the finalized table reference + finalized block hash.
        </li>
        <li>
          <strong>
            <code>sxt.run_proven_query</code>
          </strong>{" "}
          — wraps <code>run-proven-query</code>. Args: <code>tableRef</code>,{" "}
          <code>sql</code> (validated inline against the proven surface — no
          window funcs, no DML, no DDL),{" "}
          <code>commitmentScheme</code> (default <code>HYPER_KZG</code>). Returns
          rows + locally-verified HyperKZG proof.
        </li>
        <li>
          <strong>
            <code>sxt.audit_contract</code>
          </strong>{" "}
          — wraps <code>pre-deploy-audit</code>. Pure local execution: runs{" "}
          <code>forge build</code> and (optionally) <code>slither</code>, computes
          SHA-256 of every <code>.sol</code> source. No chain calls, no spend.
          Args: <code>sourcePath</code>, <code>outputPath?</code>. Returns
          structured <code>AUDIT_REPORT.md</code> contents with the
          PASS/WARN/FAIL verdict.
        </li>
        <li>
          <strong>
            <code>sxt.deploy_contract</code>
          </strong>{" "}
          — wraps <code>deploy-contract</code>. Args: <code>contractPath</code>,{" "}
          <code>mainnet?: boolean</code> (default <code>false</code> → Sepolia),{" "}
          <code>forceRedeploy?</code>. Mainnet requires both <code>mainnet: true</code>{" "}
          <em>and</em> <code>SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND</code> in the
          server's env. Idempotent via <code>.deploy-state.json</code>;{" "}
          <code>forceRedeploy</code> is refused on mainnet. Returns deployed
          address + tx hash.
        </li>
      </ul>

      <h2 id="setup">Setup by client</h2>

      <h3>Claude Desktop</h3>
      <p>
        Add to <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>:
      </p>
      <pre>
        <code>{`{
  "mcpServers": {
    "sxt": {
      "command": "npx",
      "args": ["-y", "@biffbuster/sxt-mcp"],
      "env": {
        "SXT_PRIVATE_KEY": "0x…",
        "MAKEINFINITE_API_KEY": "sxt_…"
      }
    }
  }
}`}</code>
      </pre>
      <p>Restart Claude Desktop. Tools appear in the tool picker prefixed <code>sxt.</code>.</p>

      <h3>Cursor</h3>
      <p>
        In <code>~/.cursor/mcp.json</code> (or via Cursor Settings → MCP):
      </p>
      <pre>
        <code>{`{
  "mcpServers": {
    "sxt": {
      "command": "npx",
      "args": ["-y", "@biffbuster/sxt-mcp"],
      "env": {
        "SXT_PRIVATE_KEY": "0x…",
        "MAKEINFINITE_API_KEY": "sxt_…"
      }
    }
  }
}`}</code>
      </pre>

      <h3>Codex / Gemini / others</h3>
      <p>
        Pending vendor MCP support. The server is host-agnostic — once a client
        implements the MCP spec, the same config block above works.
      </p>

      <h2 id="auth">Authentication</h2>
      <p>The server requires two secrets, supplied as env vars in the host's MCP config:</p>
      <ul>
        <li>
          <strong>
            <code>SXT_PRIVATE_KEY</code>
          </strong>{" "}
          — your SXT chain wallet (<code>0x…</code>, 32-byte hex). Used to sign{" "}
          <code>tables.createTables</code> + <code>indexing.submitData</code> when{" "}
          <code>sxt.publish_dataset</code> is called. Wallet must hold compute credits
          funded at <a href="https://chain.spaceandtime.io" target="_blank" rel="noopener noreferrer">chain.spaceandtime.io</a>.
        </li>
        <li>
          <strong>
            <code>MAKEINFINITE_API_KEY</code>
          </strong>{" "}
          — your Space and Time REST API key. Server exchanges it for a 25-min JWT at{" "}
          <code>POST /auth/apikey</code>, then submits proven queries via{" "}
          <code>/v1/zkquery</code>.
        </li>
      </ul>
      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">Don't ship secrets</div>
        Both values are sensitive. Store them in <code>~/.config/sxt-mcp/.env</code>
        and reference via <code>{`"env": { "SXT_PRIVATE_KEY": "$SXT_PRIVATE_KEY" }`}</code>
        if your host supports env interpolation. Never commit{" "}
        <code>claude_desktop_config.json</code> with values inline.
      </div>

      <h2 id="transport">Transport</h2>
      <p>Two binaries ship in v0.1.0, mapped to two use cases.</p>

      <table className="comparison-table">
        <thead>
          <tr>
            <th>Binary</th>
            <th>Transport</th>
            <th>Tools exposed</th>
            <th>For</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>sxt-mcp</code></td>
            <td>stdio</td>
            <td>All four (<code>publish</code>, <code>run_proven_query</code>, <code>audit</code>, <code>deploy</code>)</td>
            <td>Claude Desktop, Claude Code, Cursor</td>
          </tr>
          <tr>
            <td><code>sxt-mcp-http</code></td>
            <td>Streamable HTTP</td>
            <td>Read-only <code>sxt.run_proven_query</code></td>
            <td>ChatGPT Developer Mode, hosted web-MCP clients</td>
          </tr>
        </tbody>
      </table>

      <p>
        The HTTP binary deliberately narrows to one tool. Publish and deploy need a private key, audit needs filesystem access — neither belongs on a network-exposed endpoint. Read-only proof queries do, and that&apos;s what gets exposed.
      </p>
      <p>
        Default bind is loopback (<code>127.0.0.1:3333</code>). Exposing to a remote client requires a bearer token (constant-time comparison) plus host-header and Origin allowlists. Tunneling the loopback server through <code>cloudflared</code> or <code>ngrok</code> is the supported pattern today.
      </p>

      <h2 id="roadmap">Roadmap to production</h2>
      <p>
        v0.1.0 is <strong>single-tenant</strong>: one set of credentials in the host&apos;s MCP config, one user per server process. That&apos;s the right shape for personal use on Claude Desktop, Cursor, and Claude Code. The path beyond that — hosted multi-user deployments listed on claude.ai integrations, ChatGPT Developer Mode, or equivalents — is a two-step lift. Step 1 is purely engineering. Step 2 needs SXT team coordination.
      </p>

      <h3 id="v02">v0.2.0 — Hosted multitenant HTTP with OAuth</h3>
      <p>
        The MCP 2025-06 spec adds OAuth 2.1 with PKCE for HTTP transport. With that, one running server can serve many users, each authenticated and isolated.
      </p>
      <table className="comparison-table">
        <thead>
          <tr><th>What changes</th><th>Why it&apos;s needed</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>OAuth 2.1 + PKCE flow per user</td>
            <td>Replaces the shared bearer token. Each user authenticates separately and the server gets a short-lived per-user token.</td>
          </tr>
          <tr>
            <td>Per-request credential resolution</td>
            <td>No more shared <code>process.env.PRIVATE_KEY</code>. The server resolves the active tenant&apos;s credentials per call.</td>
          </tr>
          <tr>
            <td>Tenant isolation in tool handlers</td>
            <td>No shared state between calls. Audit sandbox paths, deploy-state files, and rate buckets all become per-tenant.</td>
          </tr>
          <tr>
            <td>Encrypted credential store</td>
            <td>Per-user SXT API key and signer key, encrypted at rest (DB or KMS).</td>
          </tr>
          <tr>
            <td>Per-tenant audit log + rate limit</td>
            <td>Observability and abuse control for a public endpoint.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Scope estimate: ~2 weeks. Server stays open source. Can be self-hosted or hosted under any operator. No external dependency.
      </p>

      <h3 id="v10">v1.0.0 — Sanctioned production launch</h3>
      <p>
        Five things community work alone can&apos;t deliver. Each is a coordination point with the SXT team.
      </p>
      <table className="comparison-table">
        <thead>
          <tr><th>What&apos;s needed</th><th>Why it requires SXT team input</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Removal of the &quot;not endorsed&quot; disclaimer</td>
            <td><code>SAFETY.md</code> today states the server is built independently. Production requires sign-off on the tool surface and security posture.</td>
          </tr>
          <tr>
            <td>Elevated API rate limits or OAuth federation</td>
            <td>Current per-key limits work for single-user CLI. A hosted multi-user service needs either provisioned higher limits, or federated OAuth so each user spends their own quota.</td>
          </tr>
          <tr>
            <td>Reviewed mainnet surface</td>
            <td>Today&apos;s <code>mainnet: true</code> double-gate is self-imposed. Production policy on which mainnet operations are safe to expose to OAuth users needs SXT team input.</td>
          </tr>
          <tr>
            <td>Listing in official integration directories</td>
            <td>claude.ai integrations, ChatGPT connectors, and equivalents list servers under a verified brand. Endorsement is the gate.</td>
          </tr>
          <tr>
            <td>Brand alignment</td>
            <td>The <code>dreamspace-*</code> plugin slugs are legacy. Production naming aligns with whatever the SXT team prefers for an official integration.</td>
          </tr>
        </tbody>
      </table>

      <h3 id="engage">How to engage</h3>
      <p>The repo is designed to make external review easy:</p>
      <ul>
        <li>Each tool handler mirrors a canonical script under <code>examples/scripts/</code> line for line — no novel protocol logic to audit</li>
        <li><code>SAFETY.md</code> is the contract: phased rollout, mainnet double-gate, dependency surface per phase</li>
        <li>The parity test (<code>sxt parity</code>) proves the MCP wrapping matches the SDK directly, byte-for-byte</li>
        <li>Day 1 hardening is in place: <code>zod.strict()</code> input validation, audit path sandbox, structured logger, per-tool annotations</li>
      </ul>
      <p>
        Open a discussion at{" "}
        <a href="https://github.com/biffbuster/sxt-tools/discussions" target="_blank" rel="noopener noreferrer">
          github.com/biffbuster/sxt-tools/discussions
        </a>{" "}
        referencing the <code>SAFETY.md</code> contract.
      </p>

      <h2 id="building">Build &amp; contribute</h2>
      <p>
        The server lives in <code>packages/mcp/sxt-mcp/</code> in this repo (TypeScript,
        Anthropic <code>@modelcontextprotocol/sdk</code>). Each tool handler reads its{" "}
        backing <code>SKILL.md</code> for the trigger phrases and refusal rules — no
        duplication.
      </p>
      <pre>
        <code>{`git clone https://github.com/biffbuster/sxt-tools
cd sxt-tools/packages/mcp/sxt-mcp
npm install
npm run build
npm run dev    # stdio, ready for local Claude Desktop wiring`}</code>
      </pre>

      <h2 id="troubleshooting">Troubleshooting</h2>
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Symptom</th>
            <th>First check</th>
            <th>Likely cause</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>sxt.run_proven_query</code> returns 422</td>
            <td>Was the table published with a <code>PRIMARY KEY</code> clause?</td>
            <td>
              MAINNET indexer skips tables with PK. Republish without it under a new
              namespace. See <Link href="/docs/space-and-time">SXT primitives</Link>.
            </td>
          </tr>
          <tr>
            <td>401 SECURITY: Invalid JWT</td>
            <td><code>MAKEINFINITE_API_KEY</code> set?</td>
            <td>
              Server exchanges the API key for a JWT at <code>/auth/apikey</code>; raw
              key as Bearer is not accepted.
            </td>
          </tr>
          <tr>
            <td>Tool list empty in Claude Desktop</td>
            <td>Config file path correct + Desktop restarted?</td>
            <td>Stdio servers only attach on host start. Quit and relaunch.</td>
          </tr>
          <tr>
            <td><code>sxt.deploy_contract</code> refuses mainnet</td>
            <td>Did you pass <code>confirm: true</code>?</td>
            <td>
              Mainnet deploys are gated by an explicit confirm arg — guards against
              accidental ~$0.50 ETH spend. Working as intended.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="related">Related</h2>
      <ul>
        <li>
          <Link href="/docs">Skills catalog</Link> — the seven skills the server wraps
        </li>
        <li>
          <Link href="/docs/quick-start">Quick start</Link> — five commands from clone
          to a verified Base-mainnet event (today, via Claude Code plugin)
        </li>
        <li>
          <Link href="/docs/space-and-time">SXT primitives</Link> — protocol surface
          the server interacts with
        </li>
        <li>
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
          >
            modelcontextprotocol.io
          </a>{" "}
          — the open spec
        </li>
      </ul>
    </>
  );
}
