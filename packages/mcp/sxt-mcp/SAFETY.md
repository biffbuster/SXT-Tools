# Engineering protocol

This document defines how `sxt-mcp` is built and shipped. The defaults below
are not paranoia — they are the standard pattern for protocol-specific MCP
servers and SDK tooling (see Uniswap V3 SDK, Aave SDK, Compound SDK).

---

## Phased rollout

Versions ship in order. Each version is locally testable end-to-end before
the next one starts.

| Phase | Tag    | What ships                                                         | Risk surface     |
|-------|--------|--------------------------------------------------------------------|------------------|
| 1     | v0.0.1 | Scaffold: tool surface registered, handlers throw NotImplemented   | None             |
| 2     | v0.0.2 | `proof_of_sql_foundations` resource — Markdown only                | None             |
| 3     | v0.0.3 | `sxt.run_proven_query` against testnet                             | API quota only   |
| 4     | v0.0.4 | `sxt.audit_contract` — local `forge build` + slither               | None             |
| 5     | v0.0.5 | `sxt.publish_dataset` against testnet                              | Testnet credits  |
| 6     | v0.1.0 | All four tools mainnet-enabled, double-gated                       | Gated mainnet    |

Current: **v0.0.1**.

---

## Mainnet double-gate

Mainnet execution requires **both**:

1. The tool argument `mainnet: true`, AND
2. The env var `SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` set in the MCP host config.

Either alone returns `MainnetGateError`. The env literal is intentionally not
the default `true`/`1` so it has to be typed deliberately — agents exploring
tools can't accidentally configure mainnet by guessing.

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

The CLI scripts in `examples/scripts/` default to mainnet because they're
operated by humans typing arguments directly. The MCP server defaults to
testnet because it's invoked by agents — different surface, conservative
default. This matches the convention in other protocol-specific MCP servers.

---

## Authentication

Two env vars carry through from the host config:

- **`PRIVATE_KEY`** — Ethereum private key, `0x`-prefixed. Used by both the
  SXT EthEcdsa signer (publish flow) and EVM tools (deploy / contract calls).
  Same name as the existing scripts.
- **`SXT_API_KEY`** (alias `MAKEINFINITE_API_KEY`) — Studio API key. Server
  exchanges it for a 25-minute JWT at `/auth/apikey` before each prover call,
  matching the pattern in `verify-stakers.mjs`.

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
spends. Splitting quote from execute is the same pattern Uniswap's router uses
for swap quotes.

Until v0.2 lands, agents pre-flight via `sxt.run_proven_query` — the off-chain
prover guarantees on-chain parity (the executor and the prover share a
backend), so a successful off-chain proof means an on-chain query would also
fulfill.

---

## Failure-mode prevention

Each rule below is enforced in code, not just documentation. The corresponding
test in `tests/` (Phase 2+) asserts the rule.

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

Run before tagging any version after v0.0.1:

- [ ] All tool handlers in this version pass against testnet end-to-end
- [ ] `npm test` does not spend any mainnet resources
- [ ] CLAUDE.md rules (no PRIMARY KEY, JWT exchange, `MAINNET` literal, etc.)
      are enforced in code with tests, not just documented
- [ ] Idempotency guards present and tested for any tool mutating chain state
- [ ] CHANGELOG entry naming the new tools and any schema changes
- [ ] Local end-to-end demo recorded (screen capture against Claude Desktop)

---

## Reporting issues

Issues, anomalies, or feedback: open at the repo (issue tracker URL once
public). Include the package version from the `mcp_client_info.version` field
of the MCP initialize handshake — the server logs this on stderr when it
starts.
