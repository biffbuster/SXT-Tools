import Link from "next/link";

export default function QuickStart() {
  return (
    <>
      <h1>Quick start</h1>
      <p className="docs-subtitle">
        Five commands from a fresh clone to a verified Ethereum-mainnet event. The bootstrap script handles prereq checks, balance probes, and orchestrates the eight-step pipeline.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">What you&apos;ll have at the end</div>
        A deployed Solidity contract on Base mainnet whose <code>MembershipProven</code> event log entry is a Proof of SQL receipt. The receipt is validated by the on-chain Verifier in ~150K gas inside the QueryRouter — no trust assumption in SXT, the API, or your wallet. (The same contracts work on Ethereum mainnet too; Base is the project default for cheap gas.)
      </div>

      <h2 id="prerequisites">Prerequisites</h2>
      <ul>
        <li>Node.js &gt;= 18</li>
        <li>Foundry — <code>curl -L https://foundry.paradigm.xyz | bash &amp;&amp; foundryup</code></li>
        <li>An Ethereum private key (or use the <code>--new-wallet</code> flag below to generate one)</li>
        <li>Wallet funding on three networks; the bootstrap script reports exact shortfalls</li>
      </ul>
      <p>Optional:</p>
      <ul>
        <li><code>slither</code> (<code>pip install slither-analyzer</code>) — enables Phase 1 of the audit skill</li>
        <li><code>ETHERSCAN_API_KEY</code> — enables source verification on deploy</li>
      </ul>

      <h2 id="install-deps">1. Clone and install dependencies</h2>
      <pre><code>{`$ git clone https://github.com/biffbuster/sxt-tools.git
$ cd sxt-tools/examples/scripts && npm install
$ cd ../contracts/sxt-onchain-query && forge soldeer install
$ cd ../../scripts`}</code></pre>

      <h2 id="bootstrap">2. Generate a wallet (or skip if you have one)</h2>
      <pre><code>{`$ node bootstrap.mjs --new-wallet
  Generated wallet address: 0x...
  PRIVATE_KEY written to /examples/scripts/.env
  Back up examples/scripts/.env now if you may need recovery.
  The private key will not be printed again.`}</code></pre>
      <p>
        The key is written directly to <code>examples/scripts/.env</code> and never logged. To use an existing key instead, edit the <code>.env</code> file (template at <code>.env.example</code>) and set <code>PRIVATE_KEY=0x...</code>.
      </p>

      <h2 id="fund">3. Fund the wallet on three networks</h2>
      <p>The bootstrap script will report exact shortfalls; for context, the floor amounts are:</p>
      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">Funding requirements</div>
        <ul style={{ marginTop: 8, marginBottom: 0 }}>
          <li><strong>SXT chain native</strong>: ≥ 1 SxT for publish-tx fees. Fund via the <code>SXTChainFunding</code> contract on Ethereum mainnet (<code>0xb1bc1d7eb1e6c65d0de909d8b4f27561ef568199</code>): <code>approve</code> SXT then call <code>fundAddress(yourAddress, amount)</code>. This funds your SxT-chain account regardless of which EVM chain you ultimately deploy to.</li>
          <li><strong>Base mainnet ETH</strong>: ~0.005 ETH for the deploy + approve + query gas. (Ethereum mainnet works too at ~10× higher gas.)</li>
          <li><strong>Base mainnet SXT (ERC-20)</strong>: ≥ 100 SXT per <code>query()</code> call. Token contract: <code>0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8</code>.</li>
        </ul>
      </div>

      <h2 id="status">4. Verify everything is green</h2>
      <pre><code>{`$ node bootstrap.mjs --status
▶ Prerequisites
  ✓ node 18.x.y
  ✓ forge installed
  ✓ npm dependencies installed
  ✓ soldeer dependencies installed
▶ SXT chain (publish prerequisites)
  ✓ native balance 1.234 SxT — sufficient for publish (~0.001 SxT per run)
▶ Base (deploy + query prerequisites)
  ✓ ETH balance 0.05 — sufficient for deploy + approve + query
  ✓ SXT (ERC-20 on Base) 200 — covers 2 query() call(s) at 100 SXT each
▶ Verdict
  GO — all prerequisites met. Pipeline can run end-to-end.`}</code></pre>

      <h2 id="run">5. Run the full pipeline</h2>
      <pre><code>{`$ node bootstrap.mjs --run`}</code></pre>
      <p>
        This executes <strong>publish → save proof plans → render → compile → deploy → approve → query</strong> in sequence and stops on the first failure. The final output is the staker address read from the verified callback event, the four transaction hashes, and the deployed contract address.
      </p>

      <h2 id="run-individually">Run any step individually</h2>
      <p>The same scripts are invokable directly if you want to step through:</p>
      <pre><code>{`$ SXT_RPC=wss://rpc.mainnet.sxt.network \\
    node publish-dataset-cli.mjs ../data/sxt_stakers.csv \\
      MY_AUDIT.STAKERS --schema ../data/sxt_stakers.schema.json
$ node save-proof-plans.mjs
$ node render-onchain-query.mjs       # writes src/OnchainQuery/OnchainQuery.sol
                                      # (StakersQuery.sol is hand-curated, untouched)
$ cd ../contracts/sxt-onchain-query && forge build && cd ../../scripts
$ node deploy-onchain-query.mjs       # deploys whichever contract was last rendered;
                                      # falls back to StakersQuery if no render has run
$ node query-onchain.mjs              # approve + query() + listen for callback`}</code></pre>

      <h2 id="own-csv">Use your own CSV</h2>
      <p>
        SXT auto-suffixes the namespace with the publishing wallet&apos;s address, so the published table reference, proof plan bytes, and rendered contract bytecode all differ per wallet. Same scripts, different inputs:
      </p>
      <pre><code>{`$ SXT_RPC=wss://rpc.mainnet.sxt.network \\
    node publish-dataset-cli.mjs ../data/your-data.csv \\
      YOUR_NAMESPACE.YOUR_TABLE --schema ../data/your-schema.json
$ node save-proof-plans.mjs
$ node render-onchain-query.mjs \\
    --plan ../data/proof-plans/point-lookup.json \\
    --schema ../data/your-schema.json \\
    --name MyQuery
# → writes src/MyQuery/MyQuery.sol with a QueryRow event
#   whose parameters match your SELECT projection
$ cd ../contracts/sxt-onchain-query && forge build && cd ../../scripts
$ node deploy-onchain-query.mjs
$ node query-onchain.mjs`}</code></pre>
      <p>
        The renderer maps SQL types (<code>VARCHAR</code>, <code>BIGINT</code>, <code>BOOLEAN</code>, <code>TIMESTAMP</code>, <code>INT</code>, <code>BINARY</code>, <code>TINYINT</code>, <code>SMALLINT</code>) to the appropriate <code>ProofOfSqlTable</code> reader and emits a <code>QueryRow</code> event with one parameter per projected column.
      </p>

      <h2 id="next">Next</h2>
      <ul>
        <li>Architecture and the loop diagram: <a href="https://github.com/biffbuster/sxt-tools/blob/main/HOW_IT_WORKS.md" target="_blank" rel="noopener noreferrer">HOW_IT_WORKS.md</a></li>
        <li>The five skills with trigger phrases and refusal rules: <a href="https://github.com/biffbuster/sxt-tools/tree/main/packages/plugins" target="_blank" rel="noopener noreferrer">packages/plugins/</a></li>
        <li>Background on Proof of SQL, QueryRouter, and the on-chain Verifier: <Link href="/docs/space-and-time">Space and Time primitives</Link></li>
      </ul>
    </>
  );
}
