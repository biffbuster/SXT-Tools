import Link from "next/link";

export default function SpaceAndTime() {
  return (
    <>
      <h1>Space and Time primitives</h1>
      <p className="docs-subtitle">
        Background on the SXT pieces the SXT Tools skills touch. Read this once to understand what the skills are wrapping; then use the skills to drive the workflow without re-deriving these rules per session.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">Where this fits</div>
        SXT is a Substrate-based L1 chain plus an EVM-side execution layer (QueryRouter + Verifier contracts on Ethereum and Base). The SXT Tools skills carry the chain rules; this page documents what those rules are.
      </div>

      <h2 id="proof-of-sql">Proof of SQL — what&apos;s provable</h2>
      <p>
        Proof of SQL is a HyperKZG-based ZK proof system. Every <code>SELECT</code> against a committed SXT table can carry a proof that the result was computed correctly against the on-chain commitment. The proof verifies in roughly 7 ms locally or ~150K gas on the EVM via the Onchain Verifier.
      </p>
      <h3 id="proven-surface">The proven surface (allowed)</h3>
      <ul>
        <li><strong>Statements</strong>: <code>SELECT … WHERE</code>, <code>GROUP BY</code>, <code>JOIN</code> (single chain only)</li>
        <li><strong>Comparison</strong>: <code>=</code>, <code>&gt;=</code>, <code>&lt;=</code>, <code>&gt;</code>, <code>&lt;</code></li>
        <li><strong>Logical</strong>: <code>AND</code>, <code>OR</code>, <code>NOT</code></li>
        <li><strong>Arithmetic</strong>: <code>+</code>, <code>-</code>, <code>*</code></li>
        <li><strong>Aggregates</strong>: <code>SUM</code>, <code>COUNT</code></li>
        <li><strong>Column types</strong>: <code>BOOLEAN</code>, <code>BIGINT</code>, <code>VARCHAR</code>, <code>DECIMAL75</code>, <code>TIMESTAMP</code> (plus the smaller signed integer variants <code>TINYINT</code>, <code>SMALLINT</code>, <code>INT</code>, and <code>BINARY</code>)</li>
      </ul>
      <h3 id="not-provable">Outside the proven surface (will be refused in proven mode)</h3>
      <ul>
        <li><code>ORDER BY</code>, <code>LIMIT</code>, <code>DISTINCT</code></li>
        <li><code>HAVING</code>, subqueries, CTEs, window functions (<code>ROW_NUMBER</code>, <code>RANK</code>)</li>
        <li><code>UNION</code>, <code>EXCEPT</code>, <code>INTERSECT</code></li>
        <li>Division (<code>/</code>), <code>AVG</code>, <code>MIN</code>, <code>MAX</code></li>
        <li><code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code> — Proof of SQL is SELECT-only</li>
        <li>Cross-chain JOINs</li>
      </ul>
      <p>
        The <code>dreamspace-query:proof-of-sql-foundations</code> skill enforces this surface and offers rewrites for common requests outside it (e.g. <code>ORDER BY x DESC LIMIT 10</code> → bound the set with <code>WHERE</code>, sort client-side; <code>AVG(x)</code> → return <code>SUM(x)</code> + <code>COUNT(*)</code>, divide client-side).
      </p>

      <h2 id="publish-path">Publish path — Substrate extrinsics</h2>
      <p>
        Publishing a CSV onto SXT chain is a sequence of two extrinsic calls signed with an Ethereum private key via the <code>EthEcdsaSigner</code> wrapper around the standard Substrate API.
      </p>
      <pre><code>{`// Step 1: batched DDL
api.tx.utility.batchAll([
  api.tx.tables.createNamespace(namespace, 0,
    \`CREATE SCHEMA IF NOT EXISTS \${namespace}\`,
    'Community',
    { UserCreated: 'agent' }),
  api.tx.tables.createTables([{
    ident: { namespace, name: table },
    createStatement: \`CREATE TABLE \${namespace}.\${table} (
      STAKER VARCHAR NOT NULL,
      PRIMARY KEY (STAKER)
    )\`,
    tableType: 'Community',
    commitment: { Empty: { hyperKzg: true } },
    source: { UserCreated: 'agent' },
  }]),
])

// Step 2: insert via the indexing pallet (NOT api.tx.tables)
api.tx.indexing.submitData(
  { namespace, name: table },
  batchId,
  ipcHex,            // Apache Arrow IPC bytes
)`}</code></pre>

      <h3 id="chain-rules">Chain rules the publish path must follow</h3>
      <ul>
        <li><strong>Namespace must end with the wallet address</strong> (uppercase hex, no <code>0x</code>). The publish CLI auto-suffixes; effective form: <code>&lt;PREFIX&gt;_&lt;UPPERCASE_HEX_ADDRESS&gt;</code>.</li>
        <li><strong>Every column <code>NOT NULL</code></strong>. Proof of SQL needs deterministic, branchless data.</li>
        <li><strong>Insert lives on <code>api.tx.indexing.submitData</code></strong> — not <code>api.tx.tables.*</code>. Older internal samples got this wrong.</li>
        <li><strong>Arrow vectors must be explicitly typed</strong>. <code>tableFromJSON</code> infers types and produces an IPC stream the runtime rejects with <code>indexing.ArrowExpectedRecordBatchMessage</code>. Build with <code>vectorFromArray(values, new Utf8())</code>.</li>
        <li><strong>Mainnet <code>tableType</code> enum</strong> is <code>Community | PublicPermissionless | CoreBlockchain | SCI | Testing</code>. The names <code>OwnerPermissioned</code> / <code>UserVerified</code> appear in older marketing material but are not on the current runtime.</li>
        <li><strong>Re-running is safe</strong>. The publish script catches <code>tables.VersionAlreadyExists</code> and proceeds to insert.</li>
      </ul>

      <h2 id="query-path">Query path — off-chain vs onchain</h2>
      <p>
        Two paths, depending on who consumes the result.
      </p>

      <h3 id="off-chain">Off-chain: REST API (for SXT-managed tables)</h3>
      <p>
        For SXT-managed core tables (<code>ETHEREUM.BLOCKS</code> etc.), POST SQL to the prover at <code>https://api.makeinfinite.dev/v1/prove</code>. Auth is a JWT obtained by exchanging a Studio API key at <code>https://proxy.api.makeinfinite.dev/auth/apikey</code>. The <code>sxt-proof-of-sql-sdk</code> npm package wraps both calls.
      </p>
      <p>
        Studio API keys come from <code>app.spaceandtime.ai</code> → My Account → API Authentication. They are different from <code>chain.spaceandtime.io</code> credentials; the two account systems are unrelated.
      </p>

      <h3 id="onchain">Onchain: EVM proof plan + QueryRouter (for user-published tables)</h3>
      <p>
        For tables published via direct extrinsic (the path the <code>dataset-publish</code> skill takes), the canonical query path is onchain via QueryRouter.
      </p>
      <pre><code>{`// 1. Build the EVM proof plan from the chain RPC (no auth)
curl -X POST https://rpc.mainnet.sxt.network -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0", "id": 1, "method": "commitments_v1_evmProofPlan",
  "params": { "query": "SELECT STAKER FROM MY_AUDIT_<addr>.STAKERS WHERE STAKER = '\\''0x...'\\''" }
}'
// → { "result": { "proofPlan": "0x...", "at": "0x<chainStateHash>" } }

// 2. Drop the proofPlan into a Solidity contract
bytes public constant QUERY_PLAN = hex"...";

// 3. Submit via QueryRouter
IQueryRouter.Query memory q = IQueryRouter.Query({
  innerQuery: QUERY_PLAN,
  parameters: ParamsBuilder.serializeParamArray(new bytes[](0)),
  version: VERSION,
  metadata: "",
});
IQueryRouter(QUERY_ROUTER).requestQuery(q, callback, payment);

// 4. The SXT executor proves the SQL, the OnchainVerifier validates the
//    proof inside QueryRouter (~150K gas), and the result reaches your
//    callback as verified bytes.`}</code></pre>

      <h2 id="addresses">Onchain addresses</h2>
      <p>Verified against <code>docs.spaceandtime.io</code>. Re-verify before any production deploy — addresses can change on a redeploy.</p>
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Network</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>QueryRouter</strong></td>
            <td>Ethereum + Base mainnet</td>
            <td><code>0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB</code></td>
          </tr>
          <tr>
            <td><strong>Onchain Verifier</strong></td>
            <td>Ethereum mainnet</td>
            <td><code>0x55780Ba21EdFBbFEb7033a0F2FC5Cf55Cd62ACf9</code></td>
          </tr>
          <tr>
            <td><strong>Onchain Verifier</strong></td>
            <td>Base mainnet</td>
            <td><code>0x13b7463a07Aac6Bd483E4329a7F6768Da1A65518</code></td>
          </tr>
          <tr>
            <td><strong>SXT (ERC-20)</strong></td>
            <td>Base mainnet (project default)</td>
            <td><code>0xA2c22252cDc8b7cDdEe1B0b2E242818509fCf7b8</code></td>
          </tr>
          <tr>
            <td><strong>SXT (ERC-20)</strong></td>
            <td>Ethereum mainnet</td>
            <td><code>0xE6Bfd33F52d82Ccb5b37E16D3dD81f9FFDAbB195</code></td>
          </tr>
          <tr>
            <td><strong>SXTChainFunding</strong></td>
            <td>Ethereum mainnet</td>
            <td><code>0xb1bc1d7eb1e6c65d0de909d8b4f27561ef568199</code></td>
          </tr>
        </tbody>
      </table>

      <h2 id="costs">Costs and limits</h2>
      <ul>
        <li><strong>Publish</strong>: ~0.001 SxT chain native for the create-batch + insert. Funded via the SXTChainFunding contract on Ethereum mainnet.</li>
        <li><strong>EVM proof plan</strong>: free (a JSON-RPC call to the chain).</li>
        <li><strong>Onchain query()</strong>: 100 SXT (ERC-20) per <code>requestQuery</code> call to QueryRouter, plus EVM gas for the deploy + approve + query transactions (~$1–5 on Base, ~$30–80 on Ethereum mainnet).</li>
        <li><strong>Row cap</strong>: 10,000 rows per proven query result.</li>
        <li><strong>Proof verification</strong>: ~7 ms locally, ~150K gas on the EVM Verifier.</li>
        <li><strong>Callback timeout</strong>: 1 hour by contract convention; payment refunds if the executor never fulfills.</li>
      </ul>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>Repo&apos;s end-to-end demo: <Link href="/docs/quick-start">Quick start</Link>.</li>
        <li>Skill catalog with refusal rules and trigger phrases: <Link href="/docs/spaceandtime-ai/skills">Skills catalog</Link>.</li>
        <li>Architecture diagram + the loop the skills compose into: <Link href="/docs/spaceandtime-ai/overview">What this repo ships</Link>.</li>
        <li>Authoritative SXT reference contracts: <a href="https://github.com/spaceandtimefdn/sxt-chain-examples" target="_blank" rel="noopener noreferrer">spaceandtimefdn/sxt-chain-examples</a>.</li>
      </ul>
    </>
  );
}
