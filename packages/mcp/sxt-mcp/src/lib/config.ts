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

export interface HttpConfig {
  /** TCP port for the HTTP transport. Default 3333 (avoids docs site on 3000). */
  port: number;
  /** Bind host. Default 127.0.0.1 — refuses 0.0.0.0 unless explicitly set. */
  bindHost: string;
  /** Whether the user explicitly requested a non-loopback bind. */
  bindExplicit: boolean;
  /**
   * Allowed Origin header values for cross-origin POSTs. Empty array means
   * reject all cross-origin requests. Same-origin requests (no Origin header,
   * or Origin matching the Host) are always allowed.
   */
  allowedOrigins: string[];
  /**
   * Optional static bearer token. When set, all requests must include
   * `Authorization: Bearer <token>`. Comparison is constant-time. Required
   * if bindHost is non-loopback. OAuth is a future replacement; static
   * bearer is the v1 protection layer for read-only deployments.
   */
  bearer: string | undefined;
}

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
  /** HTTP-transport settings — ignored by the stdio entrypoint. */
  http: HttpConfig;
}

function loadHttpConfig(): HttpConfig {
  const portRaw = process.env.SXT_MCP_HTTP_PORT;
  const port = portRaw ? Number(portRaw) : 3333;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SXT_MCP_HTTP_PORT must be 1..65535, got: ${portRaw}`);
  }
  const bindHostRaw = process.env.SXT_MCP_BIND_HOST;
  const bindExplicit = typeof bindHostRaw === "string" && bindHostRaw.length > 0;
  const bindHost = bindExplicit ? bindHostRaw : "127.0.0.1";
  const allowedOrigins = (process.env.SXT_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const bearer = process.env.SXT_MCP_HTTP_BEARER || undefined;
  return { port, bindHost, bindExplicit, allowedOrigins, bearer };
}

export function loadConfig(): RuntimeConfig {
  return {
    privateKey: process.env.PRIVATE_KEY,
    apiKey: process.env.SXT_API_KEY ?? process.env.MAKEINFINITE_API_KEY,
    sxtRpc: process.env.SXT_RPC,
    ethRpc: process.env.ETH_RPC,
    allowMainnet: process.env.SXT_MCP_ALLOW_MAINNET === "I-UNDERSTAND",
    http: loadHttpConfig(),
  };
}
