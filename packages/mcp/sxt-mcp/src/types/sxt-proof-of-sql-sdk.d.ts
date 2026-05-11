/**
 * Ambient type declaration for sxt-proof-of-sql-sdk (v0.54.0).
 *
 * The published package is plain JS with no types. This declaration mirrors
 * the constructor + queryAndVerify shape we depend on. The queryAndVerify
 * return type is `unknown` deliberately — the SDK's verified output shape
 * is dynamic per query and not part of its public contract.
 */

declare module "sxt-proof-of-sql-sdk" {
  export class SxTClient {
    constructor(
      zkQueryRootURL: string,
      authRootURL: string,
      substrateNodeURL: string,
      sxtApiKey: string,
    );
    queryAndVerify(queryString: string, blockHash?: string | null): Promise<unknown>;
  }

  export function verify_prover_response_hyper_kzg(proverResponseJson: unknown): unknown;
}
