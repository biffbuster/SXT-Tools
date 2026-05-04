# Pre-Deploy Audit — `StakersQuery.sol`

**Target**: `src/StakersQuery/StakersQuery.sol` (74 LOC, solc 0.8.30, evm prague, optimizer 4294967295 / via_ir)
**Toolchain**: foundry 1.5.1, soldeer-resolved deps (`sxt-proof-of-sql 0.123.10`, `@openzeppelin-contracts 5.2.0`, `forge-std 1.10.0`)
**Scope**: contract correctness against the SXT QueryRouter consumer pattern. Out-of-scope: the QueryRouter contract itself, the SXT executor service, the on-chain Verifier, and the proof plan content.

## Verdict

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Informational | 2 |

No blockers. The contract follows the SXT-published `IQueryRouter` consumer pattern. Two informational notes documented below should be acknowledged, not fixed.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| Compile | Pass | `forge build` clean against pinned dependencies; one `forge-lint` style hint (unaliased plain import) |
| Static analysis (slither) | Not run | `slither` not present in the build environment. To enable: `pip install slither-analyzer` then `slither src/StakersQuery/StakersQuery.sol --json -` |
| Reference cross-reference | Not run | No `KNOWN_EXPLOITS` table currently published under this account |
| Manual review | Run | See below |

## Manual review

### Callback authorization

```solidity
function queryCallback(bytes32 queryId, bytes calldata queryResult, bytes calldata) external {
    if (msg.sender != QUERY_ROUTER_EXECUTOR || !pendingQueries[queryId]) revert UnauthorizedCaller();
    delete pendingQueries[queryId];
    ...
}
```

Two-stage check: caller must be the SXT QueryRouter executor (`0xaCf075862425A0c839844369ac20e334B3710e47`, sourced from the pinned `ProofOfSQL.sol` re-export) and the `queryId` must have been dispatched by this contract. `pendingQueries[queryId]` is cleared before the result is processed, eliminating the replay surface even if the executor were ever compromised to deliver the same callback twice.

### Payment flow

```solidity
IERC20(SXT).safeTransferFrom(msg.sender, address(this), paymentAmount);
IERC20(SXT).safeIncreaseAllowance(QUERY_ROUTER, paymentAmount);
```

Uses OpenZeppelin's `SafeERC20.safeTransferFrom` and `safeIncreaseAllowance`. `safeIncreaseAllowance` over `safeApprove` is correct — it avoids the front-running window of the original `approve` race. SXT is a standard ERC-20, so the safe wrappers are belt-and-suspenders here, not load-bearing.

### Reentrancy

`requestQuery` returns synchronously and does not invoke any user-controlled hook. The callback is a separate transaction from the executor; it cannot be triggered from inside `query()`. State mutations in both `query()` (`pendingQueries[queryId] = true`) and `queryCallback()` (`delete pendingQueries[queryId]`) follow the checks-effects-interactions pattern.

### Centralization

No owner, no upgradeability proxy, no admin functions. Permissioning is delegated entirely to the SXT QueryRouter executor identity, which is anchored in the pinned library constant.

## Informational notes

### I-1: `query()` is permissionless by design

Anyone can call `query()` provided they have approved this contract to spend ≥100 SXT. This is intentional for the consumer pattern — it allows third parties to trigger and pay for membership proofs against the published table, not just the deployer. If sole-deployer control is required, add an `Ownable` modifier or per-address allowlist.

### I-2: `paymentAmount` and `gasLimit` are constants

`paymentAmount = 100 ether` (100 SXT) and `callback.gasLimit = 100_000` are compile-time constants. SXT pricing or callback complexity may change over time; for a long-lived contract, consider parameterizing both via constructor args or owner-set storage. For a single-purpose proof consumer, hardcoding matches the upstream SXT reference implementation.

## Notes on what's not covered

- Slither's full detector suite was not run. Reentrancy across contracts, arbitrary-send detection, and uninitialized-storage checks are not asserted by manual review alone. Recommend running slither before mainnet deploy if material value is at stake.
- The `QUERY_PLAN` constant is treated as opaque bytes by this contract. Its correctness against the published table is the responsibility of the upstream `commitments_v1_evmProofPlan` RPC method on the SXT chain, not this contract. The plan was generated against chain state hash `0x78a32a946af74daf005dcf66f952abd142b89abc87d06bf398da5c094b959b0d`; if the underlying table commitment changes, regenerate the plan via `examples/scripts/save-proof-plans.mjs` and re-render the contract via `examples/scripts/render-stakers-query.mjs` before re-deploying.
- The SXT `ProofOfSqlTable` library is trusted to decode result bytes correctly. Its source is pinned to `sxt-proof-of-sql v0.123.10` and audited upstream by the SXT team.

This is automated triage plus targeted manual review of the security-critical functions. It is not a substitute for a professional security audit on contracts handling material value in production.
