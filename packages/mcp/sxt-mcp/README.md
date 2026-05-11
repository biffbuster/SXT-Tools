# @biffbuster/sxt-mcp

MCP server for Space and Time. Exposes the publish-and-prove pipeline as
typed MCP tools — callable from Claude Desktop, Cursor, and any other client
that speaks Anthropic's Model Context Protocol.

> **Status: v0.0.1 (scaffold).** Tool surface is registered; handlers throw
> `NotImplementedError` until their phase lands. The `proof_of_sql_foundations`
> resource serves real Markdown today. See [`SAFETY.md`](./SAFETY.md) for the
> phased rollout.

---

## Surface

| Tool / resource                       | Action                                              | Reference                                       |
|---------------------------------------|-----------------------------------------------------|-------------------------------------------------|
| `sxt.publish_dataset`                 | Publish CSV/Parquet/JSON as a chain-secured table   | `examples/scripts/publish-dataset-cli.mjs`      |
| `sxt.run_proven_query`                | SELECT against a published table, returns proof    | `examples/scripts/verify-stakers.mjs`           |
| `sxt.audit_contract`                  | Solidity audit (`forge build` + slither + xrefs)    | `examples/scripts/audit-with-sxt.mjs`           |
| `sxt.deploy_contract`                 | `forge create`, idempotent + double-gated mainnet   | `examples/scripts/deploy-onchain-query.mjs`     |
| `sxt://docs/proof-of-sql-foundations` | Proven SQL surface reference (MCP resource)         | `packages/plugins/dreamspace-query/skills/...`  |

Each handler mirrors the canonical pipeline script line-for-line. The server
is a thin protocol adapter; it does not invent flows.

---

## Local development

Requirements: Node 20+.

```bash
cd packages/mcp/sxt-mcp
npm install
npm run typecheck
npm run dev          # stdio MCP server on stdin/stdout
```

Wire into Claude Desktop via
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sxt-dev": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/sxt-tools/packages/mcp/sxt-mcp/src/index.ts"]
    }
  }
}
```

Restart Claude Desktop. The four `sxt.*` tools appear in the tool picker. The
`proof_of_sql_foundations` resource is reachable today; the four tools return
a structured `NotImplementedError` until their phase ships.

---

## Production usage

After build:

```bash
npm run build        # tsc → dist/
node dist/index.js   # stdio server, production
```

Production config:

```json
{
  "mcpServers": {
    "sxt": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "PRIVATE_KEY": "0x…",
        "SXT_API_KEY": "sxt_…"
      }
    }
  }
}
```

---

## Mainnet gate

Mainnet is double-gated. The tool argument `mainnet: true` AND the env var
`SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` are both required. Either alone returns
`MainnetGateError`. Default networks are testnet (SXT) and Sepolia (EVM).

Detail: [`SAFETY.md`](./SAFETY.md).

---

## Implementation phases

Defined in [`SAFETY.md`](./SAFETY.md). Phases ship in order:

- **v0.0.1** — Scaffold (current). Tool surface registered, resource live.
- **v0.0.3** — `sxt.run_proven_query` testnet.
- **v0.0.4** — `sxt.audit_contract` (no chain).
- **v0.0.5** — `sxt.publish_dataset` testnet.
- **v0.1.0** — Mainnet enabled, double-gated.

---

## Sources

Built on public surfaces only:

- [`spaceandtimefdn/sxt-chain-examples`](https://github.com/spaceandtimefdn/sxt-chain-examples)
  — canonical Substrate extrinsic patterns.
- [`sxt-proof-of-sql-sdk`](https://www.npmjs.com/package/sxt-proof-of-sql-sdk)
  — off-chain prover client, JWT exchange.
- Public Substrate metadata via `state_getMetadata` from
  `wss://rpc.mainnet.sxt.network`.
- QueryRouter / Verifier / SXT token ABIs from BaseScan and Etherscan.
- [Anthropic Model Context Protocol](https://modelcontextprotocol.io) spec
  and TypeScript SDK.
