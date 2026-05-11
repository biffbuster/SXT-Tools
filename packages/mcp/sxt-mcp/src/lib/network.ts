/**
 * Network selection for SXT chain + EVM chains.
 *
 * Defaults are TESTNET-first for the MCP server, even though the canonical
 * sxt-tools scripts default to mainnet. Reason: the MCP server is invoked
 * by agents in environments where users have not explicitly chosen a network,
 * so the safer default is testnet. Mainnet is opt-in via either:
 *   - tool argument `mainnet: true` AND env `SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND`
 *   - or env `SXT_RPC` / `ETH_RPC` set to mainnet endpoints (advanced users)
 *
 * RPC URLs and contract addresses below match the existing sxt-tools scripts
 * and the canonical spaceandtimefdn/sxt-chain-examples — this is the
 * authoritative source-of-truth, do not invent variants.
 */

import { MainnetGateError, NetworkConfigError } from "./errors.js";

export type NetworkChoice = "testnet" | "mainnet";

export interface NetworkSelection {
  network: NetworkChoice;
  sxtRpc: string;
  sxtRpcHttp: string;
  evmRpc: string;
  evmChainId: number;
  queryRouter: string;
  verifier: string;
  sxtToken: string;
}

const TESTNET: NetworkSelection = {
  network: "testnet",
  sxtRpc: "wss://rpc.testnet.sxt.network",
  sxtRpcHttp: "https://rpc.testnet.sxt.network/",
  // Sepolia for EVM testnet — matches what the SXT examples target on testnet.
  evmRpc: "https://ethereum-sepolia.publicnode.com",
  evmChainId: 11155111,
  // Testnet QueryRouter address is documented separately by SXT — placeholder
  // until the v0.1 implementation is reviewed against testnet.
  queryRouter: "0x0000000000000000000000000000000000000000",
  verifier: "0x0000000000000000000000000000000000000000",
  sxtToken: "0x0000000000000000000000000000000000000000",
};

const MAINNET_BASE: NetworkSelection = {
  network: "mainnet",
  sxtRpc: "wss://rpc.mainnet.sxt.network",
  sxtRpcHttp: "https://rpc.mainnet.sxt.network/",
  evmRpc: "https://base.publicnode.com",
  evmChainId: 8453,
  // Same QueryRouter address on Base + Ethereum mainnet (per CLAUDE.md).
  queryRouter: "0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB",
  verifier: "0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518",
  sxtToken: "0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8",
};

const MAINNET_ETHEREUM: NetworkSelection = {
  network: "mainnet",
  sxtRpc: "wss://rpc.mainnet.sxt.network",
  sxtRpcHttp: "https://rpc.mainnet.sxt.network/",
  evmRpc: "https://ethereum.publicnode.com",
  evmChainId: 1,
  queryRouter: "0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB",
  verifier: "0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9",
  sxtToken: "0xE6Bfd33F52d82Ccb5b37E16D3dD81f9FFDAbB195",
};

export interface SelectNetworkArgs {
  mainnet?: boolean;
  evmChain?: "base" | "ethereum" | "sepolia";
  action: string;
}

export function selectNetwork(args: SelectNetworkArgs): NetworkSelection {
  if (args.mainnet === true) {
    if (process.env.SXT_MCP_ALLOW_MAINNET !== "I-UNDERSTAND") {
      throw new MainnetGateError(args.action);
    }
    if (args.evmChain === "ethereum") return MAINNET_ETHEREUM;
    if (args.evmChain === "base" || args.evmChain === undefined) return MAINNET_BASE;
    throw new NetworkConfigError(
      `evmChain "${args.evmChain}" is not a mainnet option (use "base" or "ethereum")`,
    );
  }

  if (args.evmChain === "base" || args.evmChain === "ethereum") {
    throw new NetworkConfigError(
      `evmChain "${args.evmChain}" is mainnet-only — set mainnet: true to use it (and see the gate rules)`,
    );
  }

  return TESTNET;
}
