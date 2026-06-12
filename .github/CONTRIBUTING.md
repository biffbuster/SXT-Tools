# Contributing

Thanks for the interest. PRs that actually run and pass the smoke tests get merged fast.

## Setup

```bash
git clone https://github.com/biffbuster/sxt-tools.git
cd sxt-tools
npm install
```

## Run the smoke tests before pushing

```bash
cd packages/mcp/sxt-mcp
npm run typecheck
npm run build
node scripts/day1-smoke.mjs        # stdio, 4 checks
node scripts/day2-http-smoke.mjs   # http,  12 checks
```

Both are zero cost. They don't call SXT.

## Adding a skill

Drop a new `SKILL.md` under `packages/plugins/<plugin>/skills/<your-skill>/` with YAML frontmatter. The `description` field is what triggers auto-activation, so write it for the user's vocabulary.

## Adding an MCP tool

1. Add a Zod schema and handler in `packages/mcp/sxt-mcp/src/tools/`.
2. Register it in `ALL_TOOLS` inside `src/server.ts` with the MCP annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`, `idempotentHint`).
3. If the tool is read-only and needs no credentials or filesystem access, add it to `HTTP_READ_ONLY_TOOLS` so the HTTP transport exposes it.
4. Mirror the matching script under `examples/scripts/` line-for-line for any chain operation.

## A few things to know

- All Zod schemas use `.strict()`.
- Chain operations route through `selectNetwork()`. Don't bypass the mainnet gate.
- Never publish a CSV with a `PRIMARY KEY` clause. The chain accepts the DDL but the MAINNET catalog skips promotion, and the on-chain executor will silently drop your `query()` call. You'll lock 100 SXT for an hour finding out why.
- Never use `/v2/sql`. Proof of SQL is at `/v1/zkquery` and requires a JWT exchanged from your API key first.

## Reporting issues

GitHub issues for bugs and feature requests. For security, see [SECURITY.md](./SECURITY.md).

## License

MIT. By contributing you agree your work ships under the same license.
