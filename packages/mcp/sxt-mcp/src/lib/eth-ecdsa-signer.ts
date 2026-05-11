/**
 * EthEcdsaSigner — TypeScript port of examples/scripts/ethecdsa_signer.mjs.
 *
 * Wraps an ethers Wallet so it can sign Substrate extrinsics for an EVM-derived
 * SxT account. The signer's SxT address is the wallet's Ethereum address with
 * 12 leading zero bytes prepended (the SxT bytes32 form).
 *
 * Pattern lifted verbatim from chain.spaceandtime.io's "Programmatic Table
 * Creation" tutorial — do not deviate.
 */

import type { ApiPromise } from "@polkadot/api";
import { hexToU8a, u8aConcat, u8aToHex } from "@polkadot/util";
import { blake2AsU8a } from "@polkadot/util-crypto";
import type { Wallet } from "ethers";

export interface SignedPayload {
  id: string;
  signature: { EthEcdsa: Uint8Array };
}

export class EthEcdsaSigner {
  public readonly address: string;
  private readonly wallet: Wallet;
  private readonly registry: ApiPromise["registry"];

  constructor(wallet: Wallet, api: ApiPromise) {
    this.wallet = wallet;
    this.address = u8aToHex(u8aConcat(new Uint8Array(12), hexToU8a(wallet.address)));
    this.registry = api.registry;
  }

  async signPayload(payload: Record<string, unknown>): Promise<SignedPayload> {
    const payloadObj = this.registry.createType("ExtrinsicPayload", payload);
    let payloadBytes = payloadObj.toU8a({ method: true });
    if (payloadBytes.length > 256) payloadBytes = blake2AsU8a(payloadBytes);
    const signature = hexToU8a(this.wallet.signMessageSync(payloadBytes));
    return { id: this.wallet.address, signature: { EthEcdsa: signature } };
  }
}
