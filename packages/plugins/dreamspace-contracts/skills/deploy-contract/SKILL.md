---
name: deploy-contract
description: Deploy a Solidity smart contract to an EVM chain using foundry's `forge create`. Use when the user wants to deploy a contract from source, asks "deploy this to Sepolia / Base / mainnet", mentions deployment scripts, or asks for help with constructor args, gas estimation, or post-deploy block-explorer verification. Refuses to deploy to mainnet without explicit confirmation. Pairs with the `pre-deploy-audit` skill — recommends running an audit before mainnet deployments.
---

# Deploy Contract

## What this skill does

Deploys a Solidity smart contract to a target EVM chain using foundry's `forge create`. Wraps the deployment in best-practice defaults: explicit network selection, gas estimation, environment-variable handling for the deployer key, and optional Etherscan verification post-deploy.

This skill is the bridge between authoring a contract and auditing it. After deploy, the user can register the deployed contract with SxT for indexing (via chain.spaceandtime.io) and downstream skills like `pre-deploy-audit` can query its events with proof.

## When to invoke

- The user asks to deploy a Solidity file (`.sol`).
- The user mentions a target chain — Sepolia, Base, Ethereum mainnet, etc.
- The user asks for help with `forge create` flags, constructor encoding, or post-deploy verification.
- The user wants to chain audit → deploy in a single workflow.

## Prerequisites

Required:

- **Foundry installed** — `curl -L https://foundry.paradigm.xyz | bash && foundryup`. Confirms `forge --version` runs.
- **Solidity source** at a path the user provides. The contract must compile against the user's installed solc version.
- **Deployer private key** in an environment variable. Never accept a key pasted into chat. Common names: `DEPLOYER_KEY`, `PRIVATE_KEY`, `ETH_PRIVATE_KEY`. Ask the user which one is set.
- **RPC URL** for the target chain. Pull from env (`$SEPOLIA_RPC`, `$BASE_RPC`, etc.) or ask the user. Never hardcode.

Optional:

- **Etherscan API key** in `ETHERSCAN_API_KEY` for post-deploy verification.
- **Constructor arguments** if the contract has a non-empty constructor.

If any required prerequisite is missing, list what's missing and stop. Do not silently skip safety steps.

## Concrete execution recipe

Use the Bash tool to run these steps in order.

### Step 1 — Confirm the deployment target

Always confirm the chain and address book before any deploy. Treat mainnet differently from testnets.

| Target | RPC env var | Confirmation required |
|---|---|---|
| Sepolia | `SEPOLIA_RPC` | No — testnet, low risk |
| Base Sepolia | `BASE_SEPOLIA_RPC` | No — testnet, low risk |
| Base mainnet | `BASE_RPC` | **Yes** — explicit user confirmation |
| Ethereum mainnet | `MAINNET_RPC` | **Yes** — explicit user confirmation, also recommend running `pre-deploy-audit` first |

Refuse to deploy to a mainnet target unless the user has either:

1. Explicitly confirmed in chat (e.g., "yes, deploy to mainnet").
2. Confirmed an audit has been run (preferably via the `pre-deploy-audit` skill in this plugin).

### Step 2 — Compile and estimate gas

```bash
# Compile to surface any errors early
forge build --contracts ./examples/contracts/SampleToken.sol

# Estimate gas for the deployment (without sending)
forge create ./examples/contracts/SampleToken.sol:SampleToken \
  --rpc-url $SEPOLIA_RPC \
  --constructor-args 1000000000000000000000000 \
  --private-key $DEPLOYER_KEY \
  --gas-estimate
```

If gas estimate fails, surface the error to the user and stop. Common causes: missing constructor args, RPC URL wrong, deployer wallet unfunded.

### Step 3 — Deploy

```bash
forge create ./examples/contracts/SampleToken.sol:SampleToken \
  --rpc-url $SEPOLIA_RPC \
  --constructor-args 1000000000000000000000000 \
  --private-key $DEPLOYER_KEY
```

Capture the output. The relevant lines are:

- `Deployer:` — the address that signed the deploy
- `Deployed to:` — the contract address
- `Transaction hash:` — the deployment tx for the user to verify

### Step 4 — Verify on the block explorer (optional but recommended)

If `ETHERSCAN_API_KEY` is set:

```bash
forge verify-contract \
  --chain sepolia \
  --num-of-optimizations 200 \
  --constructor-args $(cast abi-encode "constructor(uint256)" 1000000000000000000000000) \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  <DEPLOYED_ADDRESS> \
  ./examples/contracts/SampleToken.sol:SampleToken
```

Report the verification result.

### Step 5 — Suggest next steps

After a successful deploy, recommend two follow-ups to the user:

1. **Register the contract for SxT indexing** at https://chain.spaceandtime.io → "Index Smart Contracts" tutorial. Once registered, the contract's events become queryable as a proven SQL table that `pre-deploy-audit` Phase 3 can use.
2. **Run a post-deploy audit** by invoking `dreamspace-contracts:pre-deploy-audit` against the deployed address.

## Constructor argument encoding

`forge create` takes constructor args positionally with `--constructor-args`. Each arg follows Solidity ABI rules:

- Integers: bare numbers (`1000000000000000000000000`)
- Strings: quote-wrapped (`"DreamToken"`)
- Addresses: `0x...` literal
- Arrays: `"[1,2,3]"` (quoted, comma-separated)
- Booleans: `true` or `false`

When unsure, use `cast abi-encode` to validate the encoding matches the constructor signature before deploy.

## When to refuse

Refuse to deploy and tell the user why if:

- The deployer key would need to be pasted into chat. Insist on env vars.
- The RPC URL would need to be hardcoded. Insist on env vars.
- The target is mainnet and no audit has been confirmed.
- `forge build` reports compilation errors. Fix the contract first.
- The contract uses constructor logic that mints to `msg.sender` and the user is deploying with a fresh wallet for production. Flag the centralization risk.

## What this skill is not

- **Not a build system.** It runs `forge create`; it does not handle complex deploy scripts (use `forge script` directly for that).
- **Not a key manager.** It reads keys from env vars and does not generate, store, or rotate them.
- **Not an upgrade orchestrator.** Proxy patterns (UUPS, Transparent) require additional steps this skill does not cover. Recommend OpenZeppelin's hardhat-upgrades for those flows.

## Pairs with

- `dreamspace-contracts:pre-deploy-audit` — run before mainnet deploy.
- `dreamspace-data:dataset-publish` — publish reference data the audit can cross-reference against.
- `dreamspace-query:proof-of-sql-foundations` — required reading if the deployed contract will consume Proof of SQL receipts via QueryRouter.

## References

- Foundry book — `forge create`: https://book.getfoundry.sh/reference/forge/forge-create
- OpenZeppelin contract templates: https://docs.openzeppelin.com/contracts/
- SxT smart contract indexing tutorial: https://chain.spaceandtime.io
- QueryRouter and Onchain Verifier addresses: see `dreamspace-query:proof-of-sql-foundations`.
