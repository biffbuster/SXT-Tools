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

      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">Status: pre-release</div>
        The MCP server (<code>@biffbuster/sxt-mcp</code>) is in active development —
        target tag v0.1 in Q3 2026, listing on the Claude MCP marketplace shortly
        after. The configuration and tool surface below is the spec we're building
        against; expect minor field renames before v1.0. Track the work at{" "}
        <a
          href="https://github.com/biffbuster/sxt-tools"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/biffbuster/sxt-tools
        </a>
        .
      </div>

      <h2 id="tldr">TL;DR install</h2>
      <p>
        Once v0.1 ships, install via the Claude MCP marketplace:
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
        Today the five skills install through Claude Code's plugin marketplace as
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
          <code>file</code> (CSV/Parquet/JSON path), <code>schema</code> (e.g.,{" "}
          <code>MY_AUDIT.KNOWN_EXPLOITS</code>), <code>columns</code> (typed array),{" "}
          <code>tableType</code> (Community / PublicPermissionless / etc). Returns the
          finalized table reference + chain block hash.
        </li>
        <li>
          <strong>
            <code>sxt.run_proven_query</code>
          </strong>{" "}
          — wraps <code>run-proven-query</code>. Args: <code>tableRef</code>,{" "}
          <code>sql</code> (must compile against the proven surface),{" "}
          <code>commitmentScheme</code> (default <code>HYPER_KZG</code>). Returns rows
          + Proof of SQL receipt.
        </li>
        <li>
          <strong>
            <code>sxt.audit_contract</code>
          </strong>{" "}
          — wraps <code>pre-deploy-audit</code>. Args: <code>sourcePath</code>,{" "}
          <code>references</code> (array of SXT table refs to cross-check). Returns
          structured <code>AUDIT_REPORT.md</code> contents.
        </li>
        <li>
          <strong>
            <code>sxt.deploy_contract</code>
          </strong>{" "}
          — wraps <code>deploy-contract</code>. Args: <code>contract</code>,{" "}
          <code>chain</code> (base / ethereum / sepolia), <code>constructorArgs</code>.
          Refuses mainnet without explicit <code>confirm: true</code>. Returns
          deployed address + tx hash.
        </li>
        <li>
          <strong>
            <code>sxt.proof_of_sql_foundations</code>
          </strong>{" "}
          — exposed as an MCP <em>resource</em> (not a tool). Returns the proven SQL
          surface reference docs so agents can self-validate SQL before calling{" "}
          <code>sxt.run_proven_query</code>.
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
      <p>
        Default is <strong>stdio</strong> — the local desktop hosts (Claude Desktop,
        Cursor) spawn the server as a child process and communicate over its stdin /
        stdout. No ports, no listening sockets.
      </p>
      <p>
        Optional <strong>HTTP/SSE</strong> transport for hosted clients will land
        post-v0.1. Run with <code>npx @biffbuster/sxt-mcp --transport=http --port=3845</code>
        and point the host at <code>http://localhost:3845/sse</code>. Useful for remote
        hosts and for sandboxing the server in a container.
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
          <Link href="/docs">Skills catalog</Link> — the five skills the server wraps
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
