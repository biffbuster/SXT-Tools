# Security policy

## Reporting a vulnerability

Open a private security advisory on this repository (Security tab, "Report a vulnerability"), or contact [@biffbuster](https://github.com/biffbuster) directly via GitHub. Do not file public issues for security-affecting reports.

A vulnerability report should include:

- The repo commit or release tag.
- The exact reproduction steps, or the smallest code snippet that demonstrates the issue.
- The expected vs observed behavior.
- The impact (e.g. credential leak, unauthorized chain action, denial of service).

First-response target: 72 hours.

## Scope

This repository ships two surfaces, both in scope.

| Surface | What is covered |
|---|---|
| Plugin marketplace (`packages/plugins/`) | SKILL.md guidance that could direct an agent to take a destructive action on the user's behalf. |
| MCP server (`packages/mcp/sxt-mcp/`) | The full Tool surface, input validation, mainnet gate, HTTP transport defenses. The security model is documented in `packages/mcp/sxt-mcp/SAFETY.md`. |

Out of scope:

- Vulnerabilities in upstream Space and Time infrastructure (`api.makeinfinite.dev`, `rpc.mainnet.sxt.network`, the on-chain QueryRouter or Verifier contracts). Report those to the SXT team directly.
- Vulnerabilities in third-party dependencies. File an upstream report and notify us so we can pin or patch.
- Issues in user-provided Solidity audited by `sxt.audit_contract`. The audit tool is the messenger.

## Supported versions

| Component | Supported version |
|---|---|
| `@biffbuster/sxt-mcp` | The current `main` branch. Once Tier 2 (npm publish) lands, the latest minor release on npm. |
| Plugins | Whatever is published to the marketplace at `biffbuster/sxt-tools`. |

Older commits are not supported. If a vulnerability requires backporting to a specific commit, mention that in the report.

## Security model in brief

The MCP server enforces several invariants in code:

1. **Mainnet double-gate.** Every chain-touching tool routes through `selectNetwork()` in `packages/mcp/sxt-mcp/src/lib/network.ts`. Mainnet requires both `mainnet: true` (per call argument) and `SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` (host environment). Either alone returns `MainnetGateError`.
2. **Strict input validation.** All Zod schemas use `.strict()`; unknown keys throw at parse time.
3. **Filesystem sandbox.** `sxt.audit_contract` resolves both `sourcePath` and `outputPath` against `SXT_MCP_AUDIT_ROOT` (default cwd) via `realpath`. Symlinks escaping the root are caught.
4. **Secret redaction in logs.** `lib/logger.ts` scans every emitted string for Ethereum private key shapes and JWT shapes before stderr write.
5. **HTTP transport defenses.** Loopback-only by default. Non-loopback bind requires `SXT_MCP_HTTP_BEARER`. Host header allowlist and Origin header allowlist run before any MCP handler.

Full details, including the threat model for each defense, live in `packages/mcp/sxt-mcp/SAFETY.md`.

## Disclosure timeline

Standard responsible disclosure:

1. Report received, triaged within 72 hours.
2. Fix developed and verified against the reporter's reproduction.
3. Fix merged. CVE assigned if applicable.
4. Public disclosure once the fix is shipped.

If you need a specific embargo window, mention it in the report.
