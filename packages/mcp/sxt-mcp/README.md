 @biffbuster/sxt-mcp

MCP server for Space and Time. Exposes the publish-and-prove pipeline as typed MCP tools, callable from Claude Desktop, Cursor, ChatGPT, Codex, and any other client that speaks the Model Context Protocol.

The package ships two binaries.

| Binary | Transport | Tools exposed | Use |
|---|---|---|---|
| `sxt-mcp` | stdio | All eight | Claude Desktop, Claude Code, Cursor |
| `sxt-mcp-http` | Streamable HTTP | The five read-only tools: `list_tables`, `describe_table`, `run_proven_query`, `get_proof_result`, `generate_proof_plan` | Hosted connector for Claude, ChatGPT, Cursor and any remote MCP client |

The HTTP binary deliberately narrows to read-only tools. Publish and deploy need a private key; audit needs filesystem access. Neither belongs on a network-exposed connector. Discovery, proof queries and plan compilation do, and that is what `sxt-mcp-http` exposes. In public mode every user signs in with their own SXT API key, so queries are billed to the caller's own account.

Each handler mirrors the canonical script under `examples/scripts/` line-for-line. The server is a protocol adapter, not a re-implementation.

---

## Surface

| Tool | Cost surface | Mirror script |
|---|---|---|
| `sxt.list_tables` | None (discovery API read with the caller's key; curated list without one) | `examples/scripts/tables.mjs` (`sxt tables`) |
| `sxt.describe_table` | None (chain RPC read, plus discovery for size and owner) | `sxt tables --describe` (decodes the column list from a `SELECT *` proof plan) |
| `sxt.publish_dataset` | SXT chain credits per row | `examples/scripts/publish-dataset-cli.mjs` |
| `sxt.run_proven_query` | One `/v1/zkquery` API tick | `examples/scripts/verify-table.mjs` (request sequence of the SDK's `queryAndVerify`, with an owned poll loop; see SAFETY.md) |
| `sxt.get_proof_result` | None (resumes a pending proof) | none |
| `sxt.generate_proof_plan` | None (chain RPC read) | `examples/scripts/save-proof-plans.mjs` |
| `sxt.audit_contract` | None (pure local `forge build` + `slither`) | `examples/scripts/audit-with-sxt.mjs` |
| `sxt.deploy_contract` | ~$0.50 ETH gas | `examples/scripts/deploy-onchain-query.mjs` |
| `sxt://docs/proof-of-sql-foundations` | None (MCP resource, Markdown) | `packages/plugins/sxt-query/skills/proof-of-sql-foundations/SKILL.md` |

---

## Status

`v0.4.0`. All eight tools are live. Mainnet operations are enabled behind the double-gate. The HTTP binary runs as a hosted, multi-user connector with OAuth 2.1 and bring-your-own SXT key (see "Hosted deployment"). The package is ready for npm (`npm pack` installs and runs cleanly from an empty folder) but not yet published; build from source until then.

---

## Local development

Requires Node 20+.

```bash
cd packages/mcp/sxt-mcp
npm install
npm run typecheck
npm run build
```

Run the smoke tests. Both are zero-cost. Neither calls SXT.

```bash
npm test                           # vitest: sealed tokens, sanitizer, rate limit, full OAuth flow
npm run smoke                      # day1 (stdio) + day2 (http, 12 protocol + security checks)
```

---

## Stdio transport

Wire into Claude Desktop via `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sxt": {
      "command": "npx",
      "args": ["-y", "@biffbuster/sxt-mcp"],
      "env": {
        "SXT_API_KEY": "...",
        "PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Restart Claude Desktop. The eight `sxt.*` tools appear in the tool picker, and the `proof_of_sql_foundations` resource is reachable from the same picker. Until the npm release, use `"command": "node"` with the absolute path to `dist/index.js`. `PRIVATE_KEY` is only needed for publish and deploy; leave it out otherwise.

For Cursor, the same config shape lives at `~/.cursor/mcp.json`.

---

## HTTP transport

```bash
node dist/http.js
# listens on http://127.0.0.1:3333/mcp
```

By default the HTTP server binds to loopback. To expose it to a remote client (a ChatGPT custom MCP server, a hosted agent), set a bearer token and a non-loopback bind:

```bash
SXT_MCP_HTTP_BEARER="<a random secret>" \
SXT_MCP_BIND_HOST="0.0.0.0" \
  node dist/http.js
```

The HTTP entrypoint refuses to start a non-loopback bind without `SXT_MCP_HTTP_BEARER` set. Constant-time bearer comparison defeats length-leaking timing attacks. Host header allowlist and Origin header allowlist run before any MCP handler.

For ChatGPT, tunnel the loopback server to a public HTTPS URL (`cloudflared`, `ngrok`) and add it under Plugins, then Add custom MCP server, with the bearer.

## Hosted deployment

Public mode turns the HTTP binary into a hosted connector, like any remote MCP server: users add one URL to their client and sign in once in the browser.

```bash
SXT_MCP_PUBLIC_URL=https://mcp.example.com \
SXT_MCP_TOKEN_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" \
SXT_MCP_BIND_HOST=0.0.0.0 \
  node dist/http.js
```

Production runs on **Cloudflare Workers**, the same edge platform the major data-provider MCP servers sit behind:

```bash
npx wrangler secret put SXT_MCP_TOKEN_SECRET
npm run deploy:worker          # extracts the verifier WASM, then wrangler deploy
```

Set `SXT_MCP_PUBLIC_URL` in `wrangler.jsonc` and attach a custom domain. `npm run dev:worker` runs it locally under `workerd`. `SAFETY.md` → "Hosting: Cloudflare Workers" covers how the Worker differs.

As a fallback, build the image from this directory with `docker build -t sxt-mcp .` and run it with the same two variables. The image honours the platform's `PORT`, logs JSON to stderr, and answers `/healthz` and `/readyz`.

How a user connects:

1. Add `https://mcp.example.com/mcp` as a remote MCP server in their client.
2. The client discovers the OAuth server, registers itself, and opens the consent page.
3. The user pastes their SXT API key. The server checks it with SXT, then issues tokens sealed over it. The server stores nothing.

Headless agents skip OAuth and send `X-SXT-API-Key: <their key>` on each request.

The server needs no SXT key and no wallet key of its own. Run it with neither set. `SAFETY.md` → "Public mode" lists every rule and variable.

### HTTP environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SXT_MCP_HTTP_PORT` | `3333` | TCP port |
| `SXT_MCP_BIND_HOST` | `127.0.0.1` | Bind address. Non-loopback requires a bearer. |
| `SXT_MCP_HTTP_BEARER` | (unset) | Static bearer token. Required for any non-loopback bind. |
| `SXT_MCP_ALLOWED_ORIGINS` | (empty) | Comma-separated Origin allowlist for cross-origin POSTs. Same-origin is always allowed. |

---

## Mainnet gate

Mainnet is double-gated. Both the tool argument `mainnet: true` and the environment variable `SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` are required. Either alone returns `MainnetGateError`. Defaults are testnet (SXT chain) and Sepolia (EVM).

Full security model: [`SAFETY.md`](./SAFETY.md).

---

## Architecture

```
index.ts (stdio)         http.ts (Node)          worker/index.ts (Cloudflare)
      │                        │                         │
      ▼                        └──────────┬──────────────┘
server.ts                                 ▼
  all 8 tools                       http-app.ts
      │                         OAuth, rate limit, sanitizer
      │                                   │
      └──────────────┬────────────────────┘
                     ▼
                  core.ts            buildMcpServer(tools, options)
                     │
   tools/catalog-read.ts             5 read-only tools (the only HTTP surface)
   tools/{publish,audit,deploy}      write tools, stdio only
   lib/                              prover loop, chain RPC, network gate, sealing
```

`core.ts` builds the server from whatever tool list it is given. HTTP entrypoints pass only `READ_ONLY_TOOLS` from `tools/catalog-read.ts` and never import `server.ts`, so the write tools and their dependencies are never loaded on a network-exposed server. A tool that is safe to expose over HTTP (no private key, no filesystem, spends at most the caller's own credit) goes in `catalog-read.ts`; anything else goes in `WRITE_TOOLS` in `server.ts`.

---

## Sources

Built on public surfaces only.

- [`spaceandtimefdn/sxt-chain-examples`](https://github.com/spaceandtimefdn/sxt-chain-examples) for the canonical Substrate extrinsic patterns mirrored by `sxt.publish_dataset`.
- [`sxt-proof-of-sql-sdk`](https://www.npmjs.com/package/sxt-proof-of-sql-sdk) for the off-chain prover client used by `sxt.run_proven_query`.
- Public Substrate metadata via `state_getMetadata` from `wss://rpc.mainnet.sxt.network`.
- QueryRouter, Verifier, and SXT token ABIs from BaseScan and Etherscan.
- The [Model Context Protocol](https://modelcontextprotocol.io) spec and TypeScript SDK.
