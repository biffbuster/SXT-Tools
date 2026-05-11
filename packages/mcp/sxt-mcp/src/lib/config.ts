/**
 * Env-var loader. Reads the same names the existing sxt-tools/examples/scripts
 * use so users don't have to relearn anything. Optional vars carry through to
 * the network selector and tool handlers.
 *
 * SAFETY: this loader does NOT throw on missing required vars — tool handlers
 * throw at execution time. That keeps the MCP server able to start and list
 * its tools even if credentials aren't set yet. Credentials are validated only
 * when a tool that actually needs them is called.
 */

export interface RuntimeConfig {
  /** Ethereum private key — used by both SXT EthEcdsa signer and EVM tools. */
  privateKey: string | undefined;
  /** Studio API key — for /v1/zkquery JWT exchange. */
  apiKey: string | undefined;
  /** Override the SXT chain WS RPC. Default behaviour: lib/network.ts picks per-network. */
  sxtRpc: string | undefined;
  /** Override the EVM JSON-RPC endpoint. Default behaviour: lib/network.ts. */
  ethRpc: string | undefined;
  /** Mainnet permission flag. Required value: "I-UNDERSTAND". */
  allowMainnet: boolean;
  /** When true, log tool args + outcomes to stderr for local debugging. */
  debug: boolean;
}

export function loadConfig(): RuntimeConfig {
  return {
    privateKey: process.env.PRIVATE_KEY,
    apiKey: process.env.SXT_API_KEY ?? process.env.MAKEINFINITE_API_KEY,
    sxtRpc: process.env.SXT_RPC,
    ethRpc: process.env.ETH_RPC,
    allowMainnet: process.env.SXT_MCP_ALLOW_MAINNET === "I-UNDERSTAND",
    debug: process.env.SXT_MCP_DEBUG === "1" || process.env.SXT_MCP_DEBUG === "true",
  };
}
