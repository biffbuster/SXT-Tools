// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
//
// CONFIGURED FOR BASE MAINNET (chainId 8453).
// To switch to Ethereum mainnet, swap VERIFIER_ADDRESS and SXT to the
// Ethereum-mainnet values commented below. QUERY_ROUTER and
// QUERY_ROUTER_EXECUTOR are the same on both networks.
//
// Verified against docs.spaceandtime.io/docs/zk-sql-via-smart-contracts.
// Re-check before any production deploy — addresses can change with redeploys.
//
// forge-lint: disable-start(unused-import)
import {ParamsBuilder} from "sxt-proof-of-sql-0.123.10/src/client/ParamsBuilder.post.sol";
import {ProofOfSqlTable} from "sxt-proof-of-sql-0.123.10/src/client/PoSQLTable.post.sol";
import {IQueryRouter} from "../interfaces/IQueryRouter.sol";
// forge-lint: disable-end(unused-import)

// Cross-chain identical (verified on both Ethereum and Base mainnet).
address constant QUERY_ROUTER = 0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB;
address constant QUERY_ROUTER_EXECUTOR = 0xaCf075862425A0c839844369ac20e334B3710e47;

// Base mainnet:
address constant VERIFIER_ADDRESS = 0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518;
address constant SXT = 0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8;
// Ethereum mainnet (commented for reference):
// address constant VERIFIER_ADDRESS = 0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9;
// address constant SXT = 0xE6Bfd33F52d82Ccb5b37E16D3dD81f9FFDAbB195;

// Query version: keccak256("latest"). Tells QueryRouter which Verifier to route
// the proof receipt through. Per docs.spaceandtime.io/docs/zk-sql-via-smart-contracts —
// the executor will not fulfill the query if this hash isn't a registered version.
bytes32 constant VERSION = 0x5d7c83ff6d08efb2f110018d8b6814a4719a93273a3ea09ced5cfe0d5db1d001;
