# @biffbuster/sxt-mcp

MCP server for Space and Time. Exposes the publish-and-prove pipeline as typed MCP tools, callable from Claude Desktop, Cursor, ChatGPT Developer Mode, and any other client that speaks the Model Context Protocol.

The package ships two binaries.

| Binary | Transport | Tools exposed | Use |
|---|---|---|---|
| `sxt-mcp` | stdio | All four (`publish_dataset`, `run_proven_query`, `audit_contract`, `deploy_contract`) | Claude Desktop, Claude Code, Cursor |
| `sxt-mcp-http` | Streamable HTTP | Read-only `run_proven_query` | ChatGPT Developer Mode connector, custom web-MCP clients |

The HTTP binary deliberately narrows to one tool. Publish and deploy need a private key; audit needs filesystem access. Neither belongs on a network-exposed connector. Read-only proof queries do, and that is what `sxt-mcp-http` exposes.

Each handler mirrors the canonical script under `examples/scripts/` line-for-line. The server is a protocol adapter, not a re-implementation.

---

## Surface

| Tool | Cost surface | Mirror script |
|---|---|---|
| `sxt.publish_dataset` | SXT chain credits per row | `examples/scripts/publish-dataset-cli.mjs` |
| `sxt.run_proven_query` | One `/v1/zkquery` API tick | `examples/scripts/verify-stakers.mjs` |
| `sxt.audit_contract` | None (pure local `forge build` + `slither`) | `examples/scripts/audit-with-sxt.mjs` |
| `sxt.deploy_contract` | ~$0.50 ETH gas | `examples/scripts/deploy-onchain-query.mjs` |
| `sxt://docs/proof-of-sql-foundations` | None (MCP resource, Markdown) | `packages/plugins/dreamspace-query/skills/proof-of-sql-foundations/SKILL.md` |

---

## Status

`v0.1.0`. All four tools are live. Mainnet operations are enabled behind the double-gate. The package is marked `private: true` in `package.json` until the Tier 2 polish lands (error sanitizer, structured audit log, vitest suite). Until then, install by building from source.

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
node scripts/day1-smoke.mjs        # stdio: 4 protocol checks
node scripts/day2-http-smoke.mjs   # http:  12 protocol + security checks
```

---

## Stdio transport

Wire into Claude Desktop via `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sxt": {
      "command": "node",
      "args": ["/absolute/path/to/sxt-tools/packages/mcp/sxt-mcp/dist/index.js"],
      "env": {
        "SXT_API_KEY": "...",
        "PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Restart Claude Desktop. The four `sxt.*` tools appear in the tool picker. The `proof_of_sql_foundations` resource is reachable from the same picker.

For Cursor, the same config shape lives at `~/.cursor/mcp.json`.

---

## HTTP transport

```bash
node dist/http.js
# listens on http://127.0.0.1:3333/mcp
```

By default the HTTP server binds to loopback. To expose it to a remote client (ChatGPT Developer Mode connector, hosted agent), set a bearer token and a non-loopback bind:

```bash
SXT_MCP_HTTP_BEARER="<a random secret>" \
SXT_MCP_BIND_HOST="0.0.0.0" \
  node dist/http.js
```

The HTTP entrypoint refuses to start a non-loopback bind without `SXT_MCP_HTTP_BEARER` set. Constant-time bearer comparison defeats length-leaking timing attacks. Host header allowlist and Origin header allowlist run before any MCP handler.

For ChatGPT, tunnel the loopback server to a public HTTPS URL (`cloudflared`, `ngrok`) and paste the URL plus the bearer into the Developer Mode connector dialog.

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
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   index.ts      │    │    http.ts      │    │  (future)       │
│   stdio entry   │    │   HTTP entry    │    │                 │
└────────┬────────┘    └────────┬────────┘    └─────────────────┘
         │                      │
         │                      │
         └──────────┬───────────┘
                    ▼
           ┌────────────────────┐
           │   server.ts        │  buildServer({ allowedTools? })
           │   tool registry    │  ALL_TOOLS = [4 handlers]
           │   Zod schemas      │  HTTP_READ_ONLY_TOOLS = [run_proven_query]
           │   MCP annotations  │
           └────────┬───────────┘
                    │
                    ▼
           ┌────────────────────┐
           │   tools/*.ts       │  one file per tool
           │   lib/network.ts   │  mainnet double-gate
           │   lib/logger.ts    │  level-gated logger, secret redaction
           │   lib/config.ts    │  env-var loader
           └────────────────────┘
```

The factory in `server.ts` is the single source of truth for tool logic. Both entrypoints call `buildServer()`; only the transport differs. Adding a tool means editing `ALL_TOOLS` in `server.ts`. If the tool is safe to expose over HTTP, add its name to `HTTP_READ_ONLY_TOOLS` in the same file.

---

## Sources

Built on public surfaces only.

- [`spaceandtimefdn/sxt-chain-examples`](https://github.com/spaceandtimefdn/sxt-chain-examples) for the canonical Substrate extrinsic patterns mirrored by `sxt.publish_dataset`.
- [`sxt-proof-of-sql-sdk`](https://www.npmjs.com/package/sxt-proof-of-sql-sdk) for the off-chain prover client used by `sxt.run_proven_query`.
- Public Substrate metadata via `state_getMetadata` from `wss://rpc.mainnet.sxt.network`.
- QueryRouter, Verifier, and SXT token ABIs from BaseScan and Etherscan.
- The [Model Context Protocol](https://modelcontextprotocol.io) spec and TypeScript SDK.
