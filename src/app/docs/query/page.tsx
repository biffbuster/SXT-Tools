export default function Query() {
  return (
    <>
      <h1>Query</h1>
      <p>
        The Query module wraps the <strong>Space and Time (SxT) SQL API</strong> into a developer-friendly interface. Under the hood, it uses <code>sxt-nodejs-sdk</code> with ED25519 authentication and biscuit token authorization. Every SELECT query can optionally include a <strong>Proof of SQL</strong> — a ZK-SNARK that guarantees the data has not been tampered with and the computation was correct.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">What DreamSpace Adds</div>
        The raw SxT SDK requires manual ED25519 key management, biscuit token generation, and resource array tracking. DreamSpace wraps all of this into simple <code>query.sql()</code> calls with automatic auth handling, parameterized queries, and TypeScript-first result types.
      </div>

      <h2 id="overview">Overview</h2>
      <pre><code>{`import { query } from '@dreamspace/sdk';

// DreamSpace wraps sxt-nodejs-sdk under the hood
// Authentication, biscuit tokens, and resource tracking are automatic
const result = await query.sql(\`
  SELECT BLOCK_NUMBER, FROM_ADDRESS, VALUE
  FROM ETHEREUM.TRANSACTIONS
  WHERE VALUE > 1000000000000000000
  ORDER BY BLOCK_NUMBER DESC
  LIMIT 25
\`);

console.log(result.rows);   // Array of matching transactions
console.log(result.proof);  // Proof of SQL ZK proof (if requested)`}</code></pre>

      <h2 id="proof-of-sql">Proof of SQL</h2>
      <p>
        Space and Time&apos;s Proof of SQL is a ZK-SNARK system that cryptographically proves two things simultaneously: (1) the underlying table data has not been tampered with, and (2) the SQL query was executed correctly. It uses polynomial commitment schemes (HyperKZG, Dory, or Dynamic Dory) with a multilinear sum-check protocol.
      </p>
      <pre><code>{`// Request a verified query with ZK proof
const verified = await query.sql(\`
  SELECT SUM(VALUE) as TOTAL_VOLUME
  FROM ETHEREUM.TRANSACTIONS
  WHERE BLOCK_NUMBER > 19000000
\`, { proof: true });

// Proof verification takes ~7ms
console.log(verified.proof);

// Submit proof to SxT's on-chain verifier contract
// Deployed on Ethereum Mainnet: 0x84d6795ff1fCc224De328C86C318fABC396826B0
// Deployed on Ethereum Sepolia: 0x99b3c29dDC225F75f9248c863379b195Ef9D82C2
const onChainVerified = await query.verifyProofOnChain(verified.proof, {
  verifierContract: '0x84d6795ff1fCc224De328C86C318fABC396826B0',
  chain: 'ethereum',
});`}</code></pre>

      <h2 id="supported-operations">Supported Proof of SQL Operations</h2>
      <p>
        Not all SQL is provable. Proof of SQL currently supports a specific subset:
      </p>
      <ul>
        <li><strong>Queries:</strong> <code>SELECT ... WHERE</code>, <code>GROUP BY</code>, <code>JOIN</code></li>
        <li><strong>Comparison:</strong> <code>=</code>, <code>&gt;=</code>, <code>&lt;=</code>, <code>&gt;</code>, <code>&lt;</code></li>
        <li><strong>Logical:</strong> <code>AND</code>, <code>OR</code>, <code>NOT</code></li>
        <li><strong>Arithmetic:</strong> <code>+</code>, <code>-</code>, <code>*</code></li>
        <li><strong>Aggregation:</strong> <code>SUM</code>, <code>COUNT</code></li>
        <li><strong>Types:</strong> <code>BOOLEAN</code>, <code>BIGINT</code>, <code>VARCHAR</code>, <code>DECIMAL75</code>, <code>TIMESTAMP</code></li>
      </ul>

      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">Not Yet Provable</div>
        The following are NOT supported in Proof of SQL: subqueries, window functions (ROW_NUMBER, RANK), HAVING, ORDER BY, DISTINCT, UNION, division (/), AVG, MIN, MAX. You can still run these queries on the SxT platform — they just won&apos;t have ZK proofs attached.
      </div>

      <h2 id="supported-tables">Indexed Blockchain Data</h2>
      <p>
        Space and Time indexes data from major blockchains. Table names use <strong>UPPERCASE</strong> schema notation:
      </p>
      <ul>
        <li><code>ETHEREUM.TRANSACTIONS</code> — All Ethereum mainnet transactions</li>
        <li><code>ETHEREUM.BLOCKS</code> — Block headers and metadata</li>
        <li><code>ETHEREUM.TOKEN_ERC20_TRANSFERS</code> — ERC-20 transfer events</li>
        <li><code>ETHEREUM.TOKEN_ERC20_WALLET_BALANCES</code> — Aggregate ERC-20 balances</li>
        <li><code>ETHEREUM.NFT_ERC721_TRANSFER</code> — ERC-721 transfer events</li>
        <li><code>ETHEREUM.NFT_ERC721_OWNERS</code> — NFT ownership data</li>
        <li><code>ETHEREUM.NFT_ERC1155_TRANSFER</code> — ERC-1155 transfer events</li>
        <li><code>ETHEREUM.CONTRACTS</code> — Deployed contract metadata</li>
        <li><code>POLYGON.TRANSACTIONS</code> — Polygon PoS transactions</li>
        <li><code>BITCOIN.TRANSACTIONS</code> — Bitcoin transaction data</li>
        <li><code>SUI.TRANSACTIONS</code> — Sui network transactions</li>
        <li>Protocol-specific tables for Uniswap, Aave, and hundreds of DeFi protocols</li>
      </ul>

      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">Chain Support Status</div>
        Currently indexed: Ethereum, Bitcoin, Polygon, ZKsync, Sui, Avalanche. <strong>Coming soon:</strong> Base, Arbitrum, Optimism, BNB Chain. DreamSpace will add Base table support as soon as SxT enables indexing.
      </div>

      <h2 id="parameterized-queries">Parameterized Queries</h2>
      <pre><code>{`// DreamSpace adds parameterized queries on top of SxT's raw SQL API
const holders = await query.sql(
  \`SELECT OWNER, BALANCE FROM ETHEREUM.TOKEN_ERC20_WALLET_BALANCES
   WHERE CONTRACT_ADDRESS = :token
   AND BALANCE > :minBalance\`,
  {
    token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    minBalance: '1000000',
  }
);`}</code></pre>

      <h2 id="custom-tables">Custom Tables</h2>
      <p>
        You can create custom tables in SxT for your application&apos;s data. DreamSpace handles the DDL calls and biscuit token management automatically.
      </p>
      <pre><code>{`// Create a custom table (DreamSpace manages biscuit tokens)
await query.createTable('MY_APP.USER_PROFILES', {
  columns: {
    ADDRESS: 'VARCHAR',
    USERNAME: 'VARCHAR',
    CREATED_AT: 'TIMESTAMP',
    REPUTATION_SCORE: 'BIGINT',
  },
  primaryKey: 'ADDRESS',
  access: 'owner',  // 'owner' | 'public' | 'user-verified'
});

// Insert data
await query.insert('MY_APP.USER_PROFILES', {
  ADDRESS: '0xUser...',
  USERNAME: 'alice',
  CREATED_AT: new Date().toISOString(),
  REPUTATION_SCORE: 100,
});

// JOIN custom data with blockchain data
const enriched = await query.sql(\`
  SELECT
    t.FROM_ADDRESS,
    p.USERNAME,
    p.REPUTATION_SCORE,
    t.VALUE
  FROM ETHEREUM.TRANSACTIONS t
  JOIN MY_APP.USER_PROFILES p ON t.FROM_ADDRESS = p.ADDRESS
  WHERE t.BLOCK_NUMBER > 19000000
\`);`}</code></pre>

      <h2 id="raw-sxt-access">Raw SxT SDK Access</h2>
      <p>
        If you need direct access to the underlying <code>sxt-nodejs-sdk</code>, DreamSpace exposes it:
      </p>
      <pre><code>{`import { sxt } from '@dreamspace/sdk';

// Direct access to SxT SQL API classes
const result = await sxt.SQL().DQL(
  'SELECT * FROM ETHEREUM.BLOCKS LIMIT 10',
  biscuitArray,
  resourceArray
);

// Direct access to Discovery API
const schemas = await sxt.DiscoveryAPI().ListSchemas();
const tables = await sxt.DiscoveryAPI().ListTables('ETHEREUM');`}</code></pre>

      <h2 id="limitations">Limitations</h2>
      <ul>
        <li>Proof of SQL only covers SELECT queries — INSERT/UPDATE/DELETE are not provable</li>
        <li>Cross-chain JOINs are not supported (cannot JOIN ETHEREUM and POLYGON tables)</li>
        <li>Maximum query result size is 10,000 rows per request</li>
        <li>Proof generation adds 250ms–2s latency depending on query complexity and table size</li>
        <li>SxT requires Node.js &gt;= 19.8.0 with <code>--experimental-wasm-modules</code> flag</li>
        <li>On-chain verifier contracts are currently on Ethereum Mainnet and Sepolia only (Base coming soon)</li>
        <li>No real-time WebSocket subscriptions — SxT uses polling-based data access</li>
      </ul>
    </>
  );
}
