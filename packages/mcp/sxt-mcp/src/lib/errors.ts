/**
 * Structured errors returned to MCP clients. Each error carries enough context
 * for an agent to give the user a clear next step — never a stack trace, never
 * an unrelated upstream message.
 */

export class NotImplementedError extends Error {
  constructor(toolName: string, referenceScript: string) {
    super(
      `Tool "${toolName}" is not implemented in v0.0.1. ` +
        `This MCP server is in scaffold phase — every tool surface is registered but no handler ` +
        `executes against SXT or any chain yet. ` +
        `Reference implementation lives at examples/scripts/${referenceScript} in the sxt-tools repo. ` +
        `See SAFETY.md in this package for the phased rollout plan and the testnet-first protocol.`,
    );
    this.name = "NotImplementedError";
  }
}

export class MainnetGateError extends Error {
  constructor(action: string) {
    super(
      `${action} would touch SXT mainnet or Base mainnet. The MCP server refuses mainnet ` +
        `execution unless the caller passes \`mainnet: true\` AND the env var SXT_MCP_ALLOW_MAINNET ` +
        `is set to "I-UNDERSTAND". This double-gate is intentional: it exists so an agent cannot ` +
        `accidentally spend the user's SXT or ETH while exploring tools. See SAFETY.md.`,
    );
    this.name = "MainnetGateError";
  }
}

export class MissingCredentialError extends Error {
  constructor(envVar: string, purpose: string) {
    super(
      `Missing credential: env var ${envVar} is required to ${purpose}. ` +
        `Set it in the MCP host config (Claude Desktop / Cursor "env" block) or in a local .env. ` +
        `Never commit ${envVar}. See SAFETY.md → Authentication.`,
    );
    this.name = "MissingCredentialError";
  }
}

export class NetworkConfigError extends Error {
  constructor(detail: string) {
    super(`Network configuration error: ${detail}. See SAFETY.md → Network selection.`);
    this.name = "NetworkConfigError";
  }
}
