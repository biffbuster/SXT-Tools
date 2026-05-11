/**
 * sxt.deploy_contract — deploy a Solidity contract via ethers ContractFactory.
 *
 * Mirrors examples/scripts/deploy-onchain-query.mjs. Default chain is Sepolia
 * (testnet). Base or Ethereum mainnet require the double-gate (`mainnet: true`
 * arg + `SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND` env). Idempotent via
 * `.deploy-state.json` — refuses redeploy when the prior address still has
 * code, unless `forceRedeploy: true` AND we're on testnet.
 *
 * Phase 5 (v0.1.0). Risk surface:
 *   - Sepolia default: testnet ETH only (free faucets).
 *   - Mainnet (gated): real ETH gas (~$0.50 on Base, ~$30+ on Ethereum).
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { loadConfig } from "../lib/config.js";
import { MissingCredentialError, NetworkConfigError } from "../lib/errors.js";
import { selectNetwork } from "../lib/network.js";

export const deployContractSchema = z.object({
  artifactPath: z
    .string()
    .describe(
      "Path to a forge build artifact JSON (e.g. examples/contracts/sxt-onchain-query/" +
        "out/OnchainQuery.sol/OnchainQuery.json). Relative paths resolve against the MCP " +
        "server's CWD. The artifact must contain `bytecode.object` and `abi`.",
    ),
  contractName: z
    .string()
    .optional()
    .describe(
      "Optional override for the contract name written to .deploy-state.json. Defaults to " +
        "the artifact filename (without .json).",
    ),
  evmChain: z
    .enum(["sepolia", "base", "ethereum"])
    .default("sepolia")
    .describe(
      "Target chain. Default sepolia (testnet, chainId 11155111). 'base' or 'ethereum' require " +
        "mainnet: true AND SXT_MCP_ALLOW_MAINNET=I-UNDERSTAND in env.",
    ),
  mainnet: z
    .boolean()
    .default(false)
    .describe(
      "Mainnet confirmation flag. Must be true to deploy to base/ethereum, AND the env gate " +
        "must be set. Either alone returns MainnetGateError.",
    ),
  constructorArgs: z
    .array(z.unknown())
    .default([])
    .describe(
      "Optional constructor arguments, in order. Empty array (default) when the constructor " +
        "takes none. The renderer-generated OnchainQuery.sol contracts have no constructor args.",
    ),
  forceRedeploy: z
    .boolean()
    .default(false)
    .describe(
      "Bypass the .deploy-state.json idempotency guard. Refused on mainnet regardless of this " +
        "flag — mainnet redeploys must be done manually after verifying the prior address.",
    ),
  stateFilePath: z
    .string()
    .optional()
    .describe(
      "Override path for the .deploy-state.json idempotency file. Default: " +
        "<artifactDir>/../../.deploy-state.json (matches deploy-onchain-query.mjs).",
    ),
});

export type DeployContractArgs = z.infer<typeof deployContractSchema>;

// ethers-compatible ABI fragment (matches the JSON shape forge emits)
type AbiFragment = Record<string, unknown>;

interface ForgeArtifact {
  abi: AbiFragment[];
  bytecode: { object: string };
}

interface DeployState {
  chainId: number;
  network?: string;
  address: string;
  deployTxHash: string;
  deployBlock: number;
  deployer: string;
  deployedAt: string;
  contractName?: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function deriveStatePath(artifactPath: string): string {
  // artifactPath = .../out/Foo.sol/Foo.json → state at .../.deploy-state.json
  // i.e. two dirs up from the artifact json, mirroring deploy-onchain-query.mjs's
  // PROJECT_DIR/.deploy-state.json convention.
  return resolve(dirname(artifactPath), "..", "..", ".deploy-state.json");
}

function deriveContractName(artifactPath: string): string {
  const file = artifactPath.split("/").pop() ?? "Contract.json";
  return file.replace(/\.json$/, "");
}

export async function deployContractHandler(args: DeployContractArgs) {
  const config = loadConfig();
  if (!config.privateKey) {
    throw new MissingCredentialError("PRIVATE_KEY", "sign the deploy transaction");
  }

  // Network selection — enforces mainnet double-gate.
  const network = selectNetwork({
    mainnet: args.mainnet,
    evmChain: args.evmChain,
    action: `deploy_contract to ${args.evmChain}`,
  });

  // forceRedeploy on mainnet is always refused.
  if (args.forceRedeploy && network.network === "mainnet") {
    throw new Error(
      "forceRedeploy is refused on mainnet. If you need to redeploy at a different address, " +
        "manually delete the relevant entry from your .deploy-state.json after verifying the " +
        "prior address is dead.",
    );
  }

  const artifactPath = isAbsolute(args.artifactPath)
    ? args.artifactPath
    : resolve(process.cwd(), args.artifactPath);

  if (!(await fileExists(artifactPath))) {
    throw new Error(
      `Forge artifact not found at ${artifactPath}. Run \`forge build\` in the contract project, ` +
        "then pass the path to <project>/out/<Name>.sol/<Name>.json.",
    );
  }

  let artifact: ForgeArtifact;
  try {
    const raw = await readFile(artifactPath, "utf8");
    artifact = JSON.parse(raw) as ForgeArtifact;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse forge artifact at ${artifactPath}: ${msg}`);
  }

  if (!artifact.bytecode?.object || !artifact.abi) {
    throw new Error(
      `Artifact at ${artifactPath} is missing bytecode.object or abi. Confirm the file came ` +
        "from `forge build` and not a different tool.",
    );
  }
  if (artifact.bytecode.object === "0x" || artifact.bytecode.object === "") {
    throw new Error(
      `Artifact at ${artifactPath} has empty bytecode. The contract may be abstract or rely on ` +
        "an unimplemented base — fix the source and re-run forge build.",
    );
  }

  // Lazy load ethers.
  const { JsonRpcProvider, Wallet, ContractFactory, formatEther } = await import("ethers");

  const provider = new JsonRpcProvider(network.evmRpc);
  const wallet = new Wallet(config.privateKey, provider);

  // Verify chainId matches what the network selector expects.
  const networkInfo = await provider.getNetwork();
  const actualChainId = Number(networkInfo.chainId);
  if (actualChainId !== network.evmChainId) {
    throw new NetworkConfigError(
      `RPC at ${network.evmRpc} returned chainId ${actualChainId}, expected ${network.evmChainId}. ` +
        "Either fix the env override or pass the correct evmChain arg.",
    );
  }

  // Pre-flight balance.
  const ethBal = await provider.getBalance(wallet.address);
  const minBalance = 2n * 10n ** 15n; // 0.002 ETH
  if (ethBal < minBalance) {
    throw new Error(
      `Wallet ${wallet.address} on chainId ${actualChainId} has ${formatEther(ethBal)} ETH. ` +
        "Need at least 0.002 ETH for the deploy. Top up before retrying.",
    );
  }

  // Idempotency: read state file and check for live code at prior address.
  const stateFilePath = args.stateFilePath
    ? isAbsolute(args.stateFilePath)
      ? args.stateFilePath
      : resolve(process.cwd(), args.stateFilePath)
    : deriveStatePath(artifactPath);

  if (!args.forceRedeploy && (await fileExists(stateFilePath))) {
    try {
      const prev = JSON.parse(await readFile(stateFilePath, "utf8")) as DeployState;
      if (prev.chainId === actualChainId && prev.address) {
        const code = await provider.getCode(prev.address);
        if (code && code !== "0x") {
          return {
            alreadyDeployed: true,
            address: prev.address,
            chainId: prev.chainId,
            deployBlock: prev.deployBlock,
            deployTxHash: prev.deployTxHash,
            deployer: prev.deployer,
            deployedAt: prev.deployedAt,
            stateFilePath,
            network: network.network,
            notes: [
              `Prior deploy at ${prev.address} on chainId ${prev.chainId} still has code — skipping redeploy.`,
              `Pass forceRedeploy: true (testnet only) or delete ${stateFilePath} to redeploy.`,
            ],
          };
        }
      }
    } catch {
      // If the state file is malformed, fall through to deploy.
    }
  }

  // Deploy.
  // Cast through unknown — forge's ABI JSON matches ethers' JsonFragment shape but the
  // structural compatibility is too costly to express in our local types.
  const factory = new ContractFactory(
    artifact.abi as unknown as ConstructorParameters<typeof ContractFactory>[0],
    artifact.bytecode.object,
    wallet,
  );
  const contract = await factory.deploy(...args.constructorArgs);
  const deployTx = contract.deploymentTransaction();
  if (!deployTx) {
    throw new Error(
      "Deploy transaction missing — ContractFactory returned a contract without a deployment tx.",
    );
  }

  const receipt = await deployTx.wait();
  if (!receipt) {
    throw new Error(
      `Deploy tx ${deployTx.hash} broadcasted but receipt was null. Check the explorer at ` +
        `chainId ${actualChainId} before retrying.`,
    );
  }

  const address = await contract.getAddress();
  const contractName = args.contractName ?? deriveContractName(artifactPath);

  const state: DeployState = {
    chainId: actualChainId,
    network: networkInfo.name,
    address,
    deployTxHash: receipt.hash,
    deployBlock: receipt.blockNumber,
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    contractName,
  };

  await writeFile(stateFilePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  return {
    alreadyDeployed: false,
    address,
    chainId: actualChainId,
    network: network.network,
    networkName: networkInfo.name,
    contractName,
    deployTxHash: receipt.hash,
    deployBlock: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    deployer: wallet.address,
    bytecodeBytes: (artifact.bytecode.object.length - 2) / 2,
    stateFilePath,
    notes: [
      `Deployed ${contractName} to ${address} on chainId ${actualChainId}.`,
      `State written to ${stateFilePath} for idempotency.`,
      `Verify on the chain explorer before invoking the contract.`,
    ],
  };
}
