export default function ZKSearchEngine() {
  return (
    <>
      <h1>ZK Search Engine</h1>
      <p>
        A blockchain data search interface backed by SxT Proof of SQL. Every search result is cryptographically provable — users can verify on-chain that the data they received is authentic and the computation was correct.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">Modules Used</div>
        <span className="docs-example-tag">Query</span>
        <span className="docs-example-tag">Auth</span>
        <span className="docs-example-tag">Components</span>
        <span className="docs-example-tag">Deployment</span>
      </div>

      <h2 id="what-youll-build">What You&apos;ll Build</h2>
      <p>
        A Next.js app with a search bar that queries SxT-indexed blockchain data. Users type a wallet address or token name, the app runs a parameterized SQL query against Space and Time, and returns results with a ZK proof that the data is untampered.
      </p>
      <ul>
        <li>Search across Ethereum, Polygon, and other SxT-indexed chains</li>
        <li>Parameterized SQL prevents injection and enables Proof of SQL</li>
        <li>Each result includes a verifiable ZK-SNARK proof</li>
        <li>On-chain verification via the SxT verifier contract</li>
      </ul>

      <h2 id="step-1">Step 1 — Initialize the SDK</h2>
      <pre><code>{`import { init, auth, query } from '@dreamspace/sdk';

// Initialize DreamSpace with your SxT credentials
await init({
  sxtApiKey: process.env.SXT_API_KEY,
  network: 'ethereum',
});

// Authenticate via SIWE (Sign-In with Ethereum)
const session = await auth.siwe({
  wallet: userWallet,
  statement: 'Sign in to ZK Search',
});`}</code></pre>

      <h2 id="step-2">Step 2 — Build the Search Query</h2>
      <p>
        Use parameterized queries to safely incorporate user input. Only <code>SELECT</code> queries support Proof of SQL — <code>INSERT</code>, <code>UPDATE</code>, and <code>DELETE</code> are not provable.
      </p>
      <pre><code>{`// Parameterized query — safe from injection, compatible with Proof of SQL
async function searchTokenHolders(tokenAddress: string) {
  const result = await query.sql(\`
    SELECT WALLET_ADDRESS, BALANCE, BLOCK_NUMBER
    FROM ETHEREUM.TOKEN_ERC20_WALLET_BALANCES
    WHERE CONTRACT_ADDRESS = :token
    AND BALANCE > 0
    ORDER BY BALANCE DESC
    LIMIT 100
  \`, {
    token: tokenAddress,
    proof: true,  // Request ZK proof with results
  });

  return {
    rows: result.rows,
    proof: result.proof,       // ZK-SNARK proof
    proofHash: result.proofHash,
  };
}`}</code></pre>

      <h2 id="step-3">Step 3 — Build the Search UI</h2>
      <p>
        Use DreamSpace&apos;s pre-built React components for wallet connection and pair them with a custom search form.
      </p>
      <pre><code>{`import { WalletConnect } from '@dreamspace/sdk/components';

export default function SearchPage() {
  const [results, setResults] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = async () => {
    const data = await searchTokenHolders(searchQuery);
    setResults(data);
  };

  return (
    <div>
      <WalletConnect />
      <input
        type="text"
        placeholder="Enter token contract address..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <button onClick={handleSearch}>Search with ZK Proof</button>

      {results && (
        <div>
          <p>Found {results.rows.length} holders</p>
          <p>Proof hash: {results.proofHash}</p>
          {/* Render results table */}
        </div>
      )}
    </div>
  );
}`}</code></pre>

      <h2 id="step-4">Step 4 — Verify Proofs On-Chain</h2>
      <p>
        The ZK proof returned by SxT can be verified against the on-chain verifier contract deployed on Ethereum. This lets users or smart contracts independently confirm the data is authentic.
      </p>
      <pre><code>{`import { contracts } from '@dreamspace/sdk';

// Verify the proof on-chain via the SxT verifier contract
const isValid = await contracts.call('SxTVerifier', 'verifyProof', {
  args: [results.proof, results.proofHash],
  network: 'ethereum',
});

console.log('Proof valid:', isValid); // true`}</code></pre>

      <h2 id="step-5">Step 5 — Deploy</h2>
      <pre><code>{`import { deployment } from '@dreamspace/sdk';

await deployment.deploy({
  name: 'zk-search-engine',
  framework: 'nextjs',
  env: {
    SXT_API_KEY: process.env.SXT_API_KEY,
  },
});

// Deployed to: https://zk-search-engine.dreamspace.app`}</code></pre>

      <h2 id="limitations">Limitations &amp; Honest Notes</h2>
      <ul>
        <li><strong>Only SELECT queries are provable</strong> — Proof of SQL applies to reads only. Write operations (INSERT, UPDATE, DELETE) do not produce proofs.</li>
        <li><strong>SxT-indexed chains only</strong> — Limited to chains SxT indexes: Ethereum, Bitcoin, Polygon, ZKsync, Sui, and Avalanche. Other chains are not available for querying.</li>
        <li><strong>10,000 row limit</strong> — SxT enforces a maximum of 10k rows per query result when proofs are enabled.</li>
        <li><strong>No real-time streaming</strong> — SxT is polling-based. Data freshness depends on SxT&apos;s indexing lag (typically a few blocks behind head).</li>
        <li><strong>On-chain verification costs gas</strong> — Each proof verification is an on-chain transaction. Batch verifications where possible.</li>
      </ul>
    </>
  );
}
