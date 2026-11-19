 Engineering protocol

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
| 7     | v0.1.1 | `sxt.generate_proof_plan`; publish/deploy correctness fixes         | None (read-only) |
| 8     | v0.2.0 | Hosted HTTP: OAuth 2.1, bring-your-own SXT key, stateless transport, error sanitizer, rate limit, JSON logs | Caller's own API quota |
| 9     | v0.3.0 | Own the prover poll loop: retried status/result fetches, real progress, async job handles | Caller's own API quota |
| 10    | v0.4.0 | Cloudflare Workers hosting: read-only catalog split, WASM verifier extraction, edge client IP, Rate Limiting binding | Caller's own API quota |
| 11    | v0.5.0 | `sxt.quote_query` / `sxt.execute_query` on-chain path (stdio only)  | Gated mainnet    |

Current: **v0.4.0**. Six tools live, mainnet enabled behind the double-gate. The stdio binary exposes the full surface to Claude Desktop / Cursor / Claude Code. The HTTP binary exposes the read-only allowlist (`sxt.run_proven_query`, `sxt.get_proof_result`, `sxt.generate_proof_plan`) in two modes: local (one operator, env key) and public (many users, each with their own SXT key over OAuth).

---

## Mainnet double-gate

Mainnet execution requires **both**:

1. The tool argument `mainnet: true`, AND
2. The env var `SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` set in the MCP host config.

Either alone returns `MainnetGateError`. The env literal is intentionally not the default `true`/`1` so it has to be typed deliberately. Agents exploring tools cannot accidentally configure mainnet by guessing.

The gate is enforced in `src/lib/network.ts → selectNetwork()`. Every tool
that writes to a chain or spends from a wallet routes through that single
function. There is no bypass elsewhere in the codebase.

One class of tool reads mainnet without the gate: tools that read the
prover's catalog (`run_proven_query`, `get_proof_result`, `list_tables`,
`describe_table`). The prover has exactly one catalog, mainnet, so there is
no network to choose, and these tools write nothing and spend no SXT, ETH or
gas. `run_proven_query` spends one query credit on the caller's own API key.
Any new tool that writes or spends must still call `selectNetwork()`.

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
- **`SXT_API_KEY`** (alias `MAKEINFINITE_API_KEY`). Studio API key. The server exchanges it for a 25-minute JWT at `/auth/apikey` before each prover call, matching the pattern in `verify-table.mjs`.

`sxt.generate_proof_plan` needs neither. It is a plain JSON-RPC read against a public chain endpoint, so an agent can compile a plan before the user has configured any credential.

**Per-user isolation.** Credentials come from process env, so one server process acts as exactly one identity. Each user's data is scoped on chain by their own wallet: the namespace is suffixed with the publishing address, so two users of the same tooling can never write to each other's tables. The server holds no cross-invocation state and writes no shared handoff file — every artifact path is derived from the caller's own input path (`<their-csv>.inferred-schema.json`, `<their-project>/.deploy-state.json`), and results are returned inline so the agent's conversation carries the pipeline state rather than a file on disk.

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
| `sxt.generate_proof_plan` | None          | None         | None      |
| `sxt.run_proven_query`| None              | None         | One call  |
| `sxt.audit_contract`  | None              | None         | None      |
| `sxt.deploy_contract` | None              | ~$0.50 ETH   | None      |

The 100-SXT on-chain query path (`query()` against a deployed `OnchainQuery`
contract) is intentionally NOT a top-level tool yet. It will land in v0.5
behind a quote-then-confirm flow: a separate `sxt.quote_query` returns the
expected payment + estimated gas; a separate `sxt.execute_query` actually
spends. Splitting quote from execute keeps the agent's commit step distinct
from the cost-estimation step, so the 100-SXT charge is never implicit in a
lookup.

Until v0.5 lands, agents pre-flight via `sxt.run_proven_query`. The off-chain prover guarantees on-chain parity (the executor and the prover share a backend), so a successful off-chain proof means an on-chain query would also fulfill.

---

## Hosting: Cloudflare Workers

Production runs on Cloudflare Workers (`wrangler.jsonc`, entry `src/worker/index.ts`). The Node binary and the Docker image remain a supported fallback; both run the same `http-app.ts`.

- **One code path.** The Worker runs the Express app from `http-app.ts` through Cloudflare's Node HTTP layer (`httpServerHandler`, `nodejs_compat`), so OAuth, consent, sealed tokens and every defense layer are identical on both platforms.
- **Read-only catalog only.** HTTP entrypoints build from `core.ts` + `tools/catalog-read.ts` and never import the write tools, so `@polkadot/api`, `ethers`, `child_process` and the filesystem tools are not in the bundle. The bundle is about 810 KiB gzipped.
- **Verifier WASM.** Workers refuse to compile WebAssembly from bytes at runtime, which is how the SDK loads its verifier. `scripts/build-worker-verifier.mjs` decodes the SDK's embedded WASM into `worker-gen/sxt-verifier.wasm` and rewrites only the two decode/instantiate lines of the glue. It refuses to run unless the SDK is 0.54.0 with the pinned sha256. `wrangler.jsonc` aliases `sxt-proof-of-sql-sdk` to the generated module.
- **Lazy init.** The app is built on the first request. Workers forbid timers in global scope, and the SDK's OAuth rate limiters start one.
- **Client IP.** `CF-Connecting-IP`, set by Cloudflare's edge, overwrites any client-sent `X-Forwarded-For` and keys the OAuth endpoint rate limits.
- **Tool-call limit.** The `TOOL_LIMITER` Rate Limiting binding (60 per minute per caller) is shared per Cloudflare location. Without it the Worker falls back to the in-memory bucket.
- **Logs.** JSON lines through `console.log`, captured by Workers observability.
- **Per-isolate state.** Spent authorization codes and `/revoke` entries live in memory, so on Workers they hold per isolate. Codes stay bound to their PKCE verifier and expire in 5 minutes. Rotating the SXT key or `SXT_MCP_TOKEN_SECRET` remains the global revocation. A Durable Object can make these exact if that is ever needed.

Deploy:

```bash
cd packages/mcp/sxt-mcp
npx wrangler secret put SXT_MCP_TOKEN_SECRET     # 32+ random chars
# set SXT_MCP_PUBLIC_URL in wrangler.jsonc "vars" (or per environment), and a custom domain route
npm run deploy:worker
```

`npm run dev:worker` runs it locally under `workerd` (reads `.dev.vars`). `npm run check:worker` builds the deployable bundle without uploading. CI runs both.

## Prover poll loop

`sxt.run_proven_query` does not call the SDK's `queryAndVerify`. `src/lib/prover.ts` sends the same six requests with the same bodies as `SxTClient.queryAndVerify` in `sxt-proof-of-sql-sdk` 0.54.0, and keeps the SDK's WASM verifier for the final step. The SDK version is pinned exactly in `package.json`; re-diff `prover.ts` against the SDK source before bumping it. The differences are deliberate:

| Step | SDK | `prover.ts` |
|------|-----|-------------|
| Auth exchange | every call | cached per key for 20 min, refreshed once on a 401 |
| Attestation, status, results | one attempt; any dropped request fails the proof | 5 attempts with backoff on network errors, 429 and 5xx |
| Submit (`POST /v1/zkquery`) | one attempt | **one attempt, never retried.** It is the only call that spends a credit |
| Polling | 60 polls at 1s, then fetches results even if not done | 0.5s growing to 2s, until `waitSeconds` |
| Proof still running at the deadline | fails | returns `status: "pending"` + `queryId`; `sxt.get_proof_result` resumes for free |
| Progress | none | the prover's own status, as MCP progress notifications |

## Failure-mode prevention

Each rule below is enforced in code, not just documentation. The two smoke scripts (`scripts/day1-smoke.mjs` and `scripts/day2-http-smoke.mjs`) exercise the enforcement paths that are reachable without network calls. The vitest suite (`npm test`) covers sealed tokens, the sanitizer, the rate limiter, and the full public-mode OAuth flow in process. CI (`.github/workflows/mcp.yml`) runs typecheck, build, tests, smokes, the production audit, and a Docker boot.

| Failure mode                                          | Where it's prevented                              |
|-------------------------------------------------------|---------------------------------------------------|
| Agent flips `mainnet: true` without env gate          | `selectNetwork()` throws `MainnetGateError`       |
| Agent publishes table with `PRIMARY KEY` clause       | DDL builder rejects PK; refused before submit     |
| Agent sends `sourceNetwork: "mainnet"` lowercase      | Zod schema locks to literal `"MAINNET"`           |
| Agent uses raw API key as Bearer                      | Server handles JWT exchange internally            |
| Agent redeploys to live address                       | `.deploy-state.json` idempotency check            |
| Agent submits unproven SQL operator                   | SQL validation against proven surface             |
| Agent calls `query()` skipping off-chain pre-flight   | `run_proven_query` skill is a documented prereq   |
| BOOLEAN column publishes as all-`false`               | `coerceValues()` before every Arrow vector build  |
| TIMESTAMP / bad value crashes after `createTables` paid | Encode pre-flight runs before any extrinsic     |
| Second publish leaves table unregistered              | `batchAll` rollback fallback re-sends `createTables` |
| Decimal column silently degrades to VARCHAR           | Refused at inference with an explicit rewrite path |
| Agent verifies a publish with `COUNT(*)`              | Ungrouped aggregates refused; `verifyHint` emits a point lookup |
| Agent submits SQL the prover cannot plan              | Free chain-RPC planner preflight refuses it with the reason, before submit |
| Agent pulls a whole large table into one proof        | Tables of 50 MB or more refuse SQL with no WHERE or LIMIT |
| Agent queries a table that fails or breaks the shared prover | `UNSTABLE_TABLES` (today `ETHEREUM.TRANSACTIONS` and ten other SXT tables that fail at execution) refused before submit |
| A proof fails at the prover                           | `QUERY_FAILED` carries the prover `queryId` in both modes, so the caller can report it to SXT |
| Agent retries a query the prover failed to execute    | `QUERY_FAILED` is non-retryable and says retrying fails the same way |
| Agent misreads DECIMAL limbs as numbers               | `rows` decodes DECIMAL to exact strings; raw `result` kept alongside |
| Dropped status request fails a paid proof             | `prover.ts` retries free calls; submit is never retried |
| Long proof times out and the agent resubmits          | Pending handle + `sxt.get_proof_result` resume without a credit |

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
| `sxt-mcp`        | stdio           | All 6 (`publish_dataset`, `run_proven_query`, `get_proof_result`, `generate_proof_plan`, `audit_contract`, `deploy_contract`) | Claude Code / Desktop / Cursor | host process credentials |
| `sxt-mcp-http` (local)  | Streamable HTTP | **Read-only allowlist** (`run_proven_query`, `get_proof_result`, `generate_proof_plan`) | One operator, tunnels | optional static bearer (loopback OK) |
| `sxt-mcp-http` (public) | Streamable HTTP | **Read-only allowlist** (`run_proven_query`, `get_proof_result`, `generate_proof_plan`) | Hosted, many users    | OAuth 2.1 or `X-SXT-API-Key`, caller's own key |

### Why the HTTP surface is narrowed

`sxt.publish_dataset` and `sxt.deploy_contract` require a chain-write private
key. `sxt.audit_contract` operates on filesystem paths and depends on
`forge` + `slither` being installed on the server. None of those fit a
network-exposed connector. The HTTP allowlist holds only tools that need no private key: `sxt.run_proven_query` spends API quota, and `sxt.generate_proof_plan` spends nothing. No chain writes, no wallet exposure. On the HTTP surface handlers also may not touch the filesystem: `generate_proof_plan` refuses `outputPath` there.

This is enforced in code: `src/http-app.ts` calls
`buildServer({ allowedTools: HTTP_READ_ONLY_TOOLS, surface: "hosted" })`, and the
allowlist constant `HTTP_READ_ONLY_TOOLS` is defined in `src/server.ts`. Adding a tool to the HTTP surface requires editing that constant. There is no env-var or runtime path that grows the surface.

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

The static bearer is the local-mode protection. Public mode replaces it with OAuth (below).

### Public mode (hosted, bring-your-own key)

Setting `SXT_MCP_PUBLIC_URL` switches the HTTP entrypoint to a multi-user hosted connector. The rules:

1. **The operator's SXT key is never used for a caller.** `buildServer({ credentials: "request" })` makes `run_proven_query` require a key that arrived with the request. It does not fall back to `SXT_API_KEY`. The hosted image carries no SXT or wallet credentials at all.
2. **OAuth 2.1 from the MCP SDK.** `mcpAuthRouter` serves protected-resource and authorization-server metadata, dynamic client registration, PKCE (S256), token, and revocation. We supply only the provider (`src/auth/provider.ts`).
3. **Consent with the user's own key.** The authorize step renders a consent page. The user enters their SXT API key, and the server checks it with the free `/auth/apikey` exchange before issuing a code. A rejected key issues no code.
4. **Sealed tokens, no database.** Client ids, consent requests, codes, access tokens (1 hour) and refresh tokens (30 days) are AES-256-GCM sealed under `SXT_MCP_TOKEN_SECRET`, with the token type bound as AAD. Any instance holding the secret can serve any request.
5. **Revocation.** Each refresh re-checks the key with SXT, so rotating the key at the SXT console stops every refresh. Refresh tokens rotate on use. `/revoke` and spent codes are tracked per instance until expiry. Rotating `SXT_MCP_TOKEN_SECRET` (keep the old one in `SXT_MCP_TOKEN_SECRET_PREVIOUS` for an hour) invalidates everything once the previous secret is dropped.
6. **Header mode.** `X-SXT-API-Key: <key>` authenticates headless agents without OAuth. Disable with `SXT_MCP_ALLOW_KEY_HEADER=0`.
7. **Rate limit.** `SXT_MCP_RATE_LIMIT_PER_MIN` tool calls per caller per instance (default 60). Callers are identified by a hash of their key, never the key.
8. **Error sanitizer.** Hosted callers get a stable error code, a canned message, and a request id. Upstream detail goes to the server log under that id (`src/lib/sanitize.ts`).
9. **Stateless transport.** A fresh MCP server per POST. `GET` and `DELETE` on `/mcp` return 405.

Public mode refuses to start without `SXT_MCP_TOKEN_SECRET`, refuses a non-https `SXT_MCP_PUBLIC_URL` (localhost excepted), and refuses `SXT_MCP_HTTP_BEARER` alongside it.

| Variable                         | Default | Purpose |
|----------------------------------|---------|---------|
| `SXT_MCP_PUBLIC_URL`             | (unset) | https origin clients reach. Setting it turns public mode on. |
| `SXT_MCP_TOKEN_SECRET`           | (unset) | Required in public mode. At least 32 random characters. |
| `SXT_MCP_TOKEN_SECRET_PREVIOUS`  | (unset) | Previous secret, still accepted during a rotation. |
| `SXT_MCP_RATE_LIMIT_PER_MIN`     | `60`    | Tool calls per caller per minute, per instance. |
| `SXT_MCP_ALLOW_KEY_HEADER`       | on      | `0` disables `X-SXT-API-Key`. |
| `SXT_MCP_TRUST_PROXY`            | `1`     | Trusted reverse-proxy hops, for client IPs on the OAuth rate limits. |
| `SXT_MCP_MAX_WAIT_SECONDS`       | `120`   | Ceiling on the `waitSeconds` a caller may request. Longer proofs return a pending handle. |
| `SXT_MCP_LARGE_TABLE_BYTES`      | 50 MB   | Tables at or above this size refuse SQL with neither WHERE nor LIMIT. |
| `SXT_MCP_ALLOW_AGGREGATES`       | (unset) | `1` lifts the refusal of aggregates without GROUP BY, once the prover runs them again. |
| `SXT_MCP_ALLOW_UNSTABLE_TABLES`  | (unset) | `1` lets queries reach the tables in `UNSTABLE_TABLES` (today `ETHEREUM.TRANSACTIONS` and ten others that fail at execution). |
| `PORT`                           | `3333`  | Honoured when `SXT_MCP_HTTP_PORT` is unset, for container platforms. |

---

## Reporting issues

Issues, anomalies, or feedback: open at the repo (issue tracker URL once public). Include the package version from the `mcp_client_info.version` field of the MCP initialize handshake. The server logs this on stderr when it starts.
