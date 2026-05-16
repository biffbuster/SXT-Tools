# Engineering protocol

This document defines how `sxt-mcp` is built and shipped. The defaults below
are derived from the operational rules in the root `CLAUDE.md` and from the
canonical SXT examples repo (`spaceandtimefdn/sxt-chain-examples`). These are the same conventions that govern the CLI scripts in `examples/scripts/`, adapted for an agent-driven surface.

---

## Phased rollout

Versions ship in order. Each version is locally testable end-to-end before
the next one starts.

| Phase | Tag    | What ships                                                         | Risk surface     |
|-------|--------|--------------------------------------------------------------------|------------------|
| 1     | v0.0.1 | Scaffold: tool surface registered, handlers throw NotImplemented   | None             |
| 2     | v0.0.2 | `proof_of_sql_foundations` resource (Markdown only)                | None             |
| 3     | v0.0.3 | `sxt.run_proven_query` against testnet                             | API quota only   |
| 4     | v0.0.4 | `sxt.audit_contract`: local `forge build` + slither                | None             |
| 5     | v0.0.5 | `sxt.publish_dataset` against testnet                              | Testnet credits  |
| 6     | v0.1.0 | All four tools mainnet-enabled, double-gated                       | Gated mainnet    |

Current: **v0.1.0**. All four tools live, mainnet enabled behind the double-gate. The stdio binary exposes the full surface to Claude Desktop / Cursor / Claude Code. The HTTP binary exposes a narrowed read-only surface (`sxt.run_proven_query` only) for ChatGPT Developer Mode connectors.

---

## Mainnet double-gate

Mainnet execution requires **both**:

1. The tool argument `mainnet: true`, AND
2. The env var `SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` set in the MCP host config.

Either alone returns `MainnetGateError`. The env literal is intentionally not the default `true`/`1` so it has to be typed deliberately. Agents exploring tools cannot accidentally configure mainnet by guessing.

The gate is enforced in `src/lib/network.ts → selectNetwork()`. Every
chain-touching tool routes through that single function. There is no bypass
elsewhere in the codebase.

---

## Default networks

| Action                | Default            | Mainnet                                      |
|-----------------------|--------------------|----------------------------------------------|
| SXT chain RPC         | testnet WSS        | `wss://rpc.mainnet.sxt.network`              |
| EVM chain             | Sepolia (`11155111`) | Base (`8453`) or Ethereum (`1`)            |
| Off-chain prover      | testnet path       | `api.makeinfinite.dev` mainnet path          |

The CLI scripts in `examples/scripts/` default to mainnet because they're operated by humans typing arguments directly. The MCP server defaults to testnet because it's invoked by agents. Different surface, conservative default. Reaching mainnet from the MCP server requires the explicit double-gate documented above.

---

## Authentication

Two env vars carry through from the host config:

- **`PRIVATE_KEY`**. Ethereum private key, `0x`-prefixed. Used by both the SXT EthEcdsa signer (publish flow) and EVM tools (deploy and contract calls). Same name as the existing scripts.
- **`SXT_API_KEY`** (alias `MAKEINFINITE_API_KEY`). Studio API key. The server exchanges it for a 25-minute JWT at `/auth/apikey` before each prover call, matching the pattern in `verify-stakers.mjs`.

Both are validated **lazily**. The server starts and lists tools regardless
of whether credentials are set. Validation happens inside the handler when
the tool is actually called. This means the tool catalog is always
inspectable without configuring secrets.

Never commit MCP host config files (`claude_desktop_config.json`,
`~/.cursor/mcp.json`) with credentials inline. Use a host-managed env
indirection where supported.

---

## Cost surface per tool

What each tool spends, by design, when fully implemented:

| Tool                  | SXT chain credits | EVM gas      | API quota |
|-----------------------|-------------------|--------------|-----------|
| `sxt.publish_dataset` | Yes (per row)     | None         | None      |
| `sxt.run_proven_query`| None              | None         | One call  |
| `sxt.audit_contract`  | None              | None         | None      |
| `sxt.deploy_contract` | None              | ~$0.50 ETH   | None      |

The 100-SXT on-chain query path (`query()` against a deployed `OnchainQuery`
contract) is intentionally NOT a top-level tool in v0.1. It will land in v0.2
behind a quote-then-confirm flow: a separate `sxt.quote_query` returns the
expected payment + estimated gas; a separate `sxt.execute_query` actually
spends. Splitting quote from execute keeps the agent's commit step distinct
from the cost-estimation step, so the 100-SXT charge is never implicit in a
lookup.

Until v0.2 lands, agents pre-flight via `sxt.run_proven_query`. The off-chain prover guarantees on-chain parity (the executor and the prover share a backend), so a successful off-chain proof means an on-chain query would also fulfill.

---

## Failure-mode prevention

Each rule below is enforced in code, not just documentation. The two smoke scripts (`scripts/day1-smoke.mjs` and `scripts/day2-http-smoke.mjs`) exercise the enforcement paths that are reachable without network calls. A full vitest suite is on the Tier 2 punch list and will replace the smokes once it lands.

| Failure mode                                          | Where it's prevented                              |
|-------------------------------------------------------|---------------------------------------------------|
| Agent flips `mainnet: true` without env gate          | `selectNetwork()` throws `MainnetGateError`       |
| Agent publishes table with `PRIMARY KEY` clause       | DDL builder rejects PK; refused before submit     |
| Agent sends `sourceNetwork: "mainnet"` lowercase      | Zod schema locks to literal `"MAINNET"`           |
| Agent uses raw API key as Bearer                      | Server handles JWT exchange internally            |
| Agent redeploys to live address                       | `.deploy-state.json` idempotency check            |
| Agent submits unproven SQL operator                   | SQL validation against proven surface             |
| Agent calls `query()` skipping off-chain pre-flight   | `run_proven_query` skill is a documented prereq   |

---

## Local development

```bash
cd packages/mcp/sxt-mcp
npm install
npm run typecheck      # strict TS
npm run dev            # stdio MCP server, ready for Claude Desktop
```

The dev server starts with the mainnet gate locked. Even with
`SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` exported in the shell, the per-tool
`mainnet: true` flag is still required. Two distinct deliberate actions are
needed to reach mainnet.

For testnet credits: the SXT chain has a public faucet flow at
`chain.spaceandtime.io`. Standard self-service.

---

## Pre-release checklist

Run before tagging any release:

- [ ] All tool handlers pass against testnet end-to-end with the relevant CLI script in `examples/scripts/`.
- [ ] `npm run build` and both smoke scripts (`scripts/day1-smoke.mjs`, `scripts/day2-http-smoke.mjs`) pass without spending mainnet resources.
- [ ] Operational rules from the root `CLAUDE.md` (no PRIMARY KEY, JWT exchange, `MAINNET` literal, mainnet double-gate) remain enforced in code.
- [ ] Idempotency guards present for any tool mutating chain state.
- [ ] Local end-to-end demo recorded (screen capture against Claude Desktop or the canonical pipeline script).

---

## Transport modes

The server ships two entrypoints. Both call the same `buildServer()` factory
in `src/server.ts`, so schemas, mainnet gate, and audit sandbox cannot drift
between transports.

| Binary           | Transport       | Tools exposed                                                                       | Audience                       | Auth                          |
|------------------|-----------------|-------------------------------------------------------------------------------------|--------------------------------|-------------------------------|
| `sxt-mcp`        | stdio           | All 4 (`publish_dataset`, `run_proven_query`, `audit_contract`, `deploy_contract`)  | Claude Code / Desktop / Cursor | host process credentials      |
| `sxt-mcp-http`   | Streamable HTTP | **Only `sxt.run_proven_query`** (read-only proof-query path)                        | ChatGPT / browser-MCP clients  | optional bearer (loopback OK) |

### Why the HTTP surface is narrowed

`sxt.publish_dataset` and `sxt.deploy_contract` require a chain-write private
key. `sxt.audit_contract` operates on filesystem paths and depends on
`forge` + `slither` being installed on the server. None of those fit a
network-exposed connector. Exposing only `sxt.run_proven_query` over HTTP keeps the worst-case impact of a compromised connector to "burned API quota on the operator's SXT key." No chain writes, no wallet exposure, no filesystem reads outside the server process.

This is enforced in code: `src/http.ts` calls
`buildServer({ allowedTools: HTTP_READ_ONLY_TOOLS })`, and the allowlist
constant `HTTP_READ_ONLY_TOOLS = ["sxt.run_proven_query"]` is defined in
`src/server.ts`. Adding a tool to the HTTP surface requires editing that constant. There is no env-var or runtime path that grows the surface.

### Network defences (HTTP transport)

Layered, in the order requests traverse them:

1. **Loopback default.** Binds to `127.0.0.1:3333`. Refuses to bind to
   `0.0.0.0` unless `SXT_MCP_BIND_HOST` is set explicitly.
2. **Bearer requirement for non-loopback bind.** A non-loopback bind without `SXT_MCP_HTTP_BEARER` refuses to start. An unauthenticated public endpoint to `/v1/zkquery` on the operator's API key is not a shipping configuration.
3. **Host header allowlist.** Requests with `Host` outside the loopback
   literals and the configured bind host are rejected before any MCP
   handler runs. Blocks DNS-rebinding via malicious names that resolve to
   loopback.
4. **Origin header allowlist.** Same-origin POSTs (no Origin header or
   Origin matching Host) pass. Cross-origin requests require an explicit
   match in `SXT_MCP_ALLOWED_ORIGINS` (comma-separated, empty by default).
5. **Bearer token check** (when `SXT_MCP_HTTP_BEARER` is set). Constant-time
   compare to defeat length-leaking timing attacks. `401` with
   `WWW-Authenticate: Bearer realm="sxt-mcp"` on failure.
6. **MCP protocol layer.** Tool registry is the read-only allowlist; calls to any other tool name return "Unknown tool." The handler is not reachable from this transport.
7. **`selectNetwork()` mainnet gate.** Same chokepoint as stdio.

### Environment variables (HTTP-only)

| Variable                    | Default     | Purpose                                                                        |
|-----------------------------|-------------|--------------------------------------------------------------------------------|
| `SXT_MCP_HTTP_PORT`         | `3333`      | TCP port. Avoids `3000` (docs site).                                           |
| `SXT_MCP_BIND_HOST`         | `127.0.0.1` | Bind address. Non-loopback values require a bearer (see above).                |
| `SXT_MCP_ALLOWED_ORIGINS`   | (empty)     | Comma-separated Origin allowlist for cross-origin POSTs.                       |
| `SXT_MCP_HTTP_BEARER`       | (unset)     | Static bearer token. Required for any non-loopback bind. Constant-time compare.|

OAuth (DCR + PKCE + JWKS) is a future replacement for the static bearer. Static bearer is sufficient for v1 of a read-only surface. The worst case on compromise is wasted API quota, not wallet drain.

---

## Reporting issues

Issues, anomalies, or feedback: open at the repo (issue tracker URL once public). Include the package version from the `mcp_client_info.version` field of the MCP initialize handshake. The server logs this on stderr when it starts.
