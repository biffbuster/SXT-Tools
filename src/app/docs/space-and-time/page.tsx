export default function SpaceAndTime() {
  return (
    <>
      <h1>Space and Time</h1>
      <p>
        Space and Time (SxT) is the core data layer powering DreamSpace SDK. It is a decentralized data warehouse that indexes blockchain data and makes it queryable via standard SQL, backed by <strong>Proof of SQL</strong> — a novel ZK-SNARK proof system that guarantees query results are computed correctly against untampered data.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">How DreamSpace Uses Space and Time</div>
        DreamSpace SDK wraps the <code>sxt-nodejs-sdk</code> NPM package, abstracting away ED25519 key management, biscuit token authorization, and resource tracking. Every <code>query.sql()</code> call goes through SxT&apos;s decentralized data warehouse. DreamSpace adds TypeScript types, parameterized queries, and simplified authentication on top.
      </div>

      <h2 id="architecture">Architecture</h2>
      <p>
        SxT operates as an <strong>HTAP (Hybrid Transactional/Analytic Processing)</strong> system with two query engines:
      </p>
      <ul>
        <li><strong>OLTP engine</strong> — Low-latency transactional queries for real-time reads</li>
        <li><strong>OLAP engine</strong> — Big data analytics for complex aggregations</li>
        <li><strong>Indexer nodes</strong> — Collect and index data from major blockchains in near real-time</li>
        <li><strong>Validator nodes</strong> — Verify data updates via cryptographic commitments</li>
        <li><strong>Prover nodes</strong> — Generate ZK proofs using GPU acceleration (NVIDIA A100/T4)</li>
        <li><strong>SXT Chain</strong> — A permissionless L1 blockchain (Substrate-based) with a ZK rollup on ZKsync&apos;s Elastic Chain for smart contract execution</li>
      </ul>

      <h2 id="authentication">Authentication</h2>
      <p>
        SxT uses <strong>ED25519 key pairs</strong> for authentication and <strong>biscuit tokens</strong> for granular authorization. DreamSpace manages this automatically, but understanding the underlying system is important.
      </p>
      <pre><code>{`// Under the hood, DreamSpace handles this for you:
// 1. Generate ED25519 key pair
// 2. Request auth code from SxT
// 3. Sign auth code with private key
// 4. Exchange for access token (valid 25 min) + refresh token (valid 30 min)
// 5. Generate biscuit tokens with granular permissions

// DreamSpace simplifies this to:
import { DreamSpace } from '@dreamspace/sdk';

const ds = new DreamSpace({
  sxtApiKey: process.env.SXT_API_KEY,
});

await ds.init(); // Handles all auth automatically`}</code></pre>

      <h2 id="biscuit-tokens">Biscuit Token Authorization</h2>
      <p>
        Biscuit tokens are cryptographically verifiable, decentralized authorization tokens with embedded permission rules. Each token is scoped to specific tables and operations.
      </p>
      <pre><code>{`// Biscuit permissions in SxT:
// ddl_create  — Create tables/schemas
// ddl_drop    — Drop tables
// ddl_alter   — Modify table structure
// dml_insert  — Insert records
// dml_delete  — Delete records
// dml_update  — Update records
// dql_select  — Query records

// DreamSpace manages biscuit tokens automatically per-table
// For advanced use, you can create custom tokens:
import { auth } from '@dreamspace/sdk';

const token = await auth.createBiscuitToken({
  permissions: ['dql_select', 'dml_insert'],
  resources: ['MY_APP.USER_PROFILES'],
});`}</code></pre>

      <h2 id="proof-of-sql">Proof of SQL Deep Dive</h2>
      <p>
        Proof of SQL uses polynomial commitment schemes with a multilinear sum-check protocol. The process works as follows:
      </p>
      <ul>
        <li><strong>Data ingestion:</strong> Data enters SxT, the verifier computes a commitment digest using native polynomial commitment schemes (not Merkle trees)</li>
        <li><strong>Query parsing:</strong> SQL is parsed into an Abstract Syntax Tree (AST)</li>
        <li><strong>Execution + witness:</strong> Query executes against tamperproof tables, generating a witness of intermediate computation states</li>
        <li><strong>Proof generation:</strong> Witness is committed using homomorphic commitment schemes, polynomial constraints are constructed, and a sum-check protocol validates correctness</li>
        <li><strong>Verification:</strong> Takes approximately <strong>7ms</strong> — can be done locally or on-chain</li>
      </ul>
      <p>
        Supported commitment schemes: <strong>HyperKZG</strong> (default), <strong>Dory</strong>, <strong>Dynamic Dory</strong>.
      </p>

      <h2 id="performance">Real-World Performance</h2>
      <p>
        Benchmarks on a single NVIDIA A100 GPU with 10 million rows:
      </p>
      <ul>
        <li>Simple filtering: ~250–300ms</li>
        <li>Complex multi-condition filtering: ~350–400ms</li>
        <li>GROUP BY aggregation: ~400–500ms</li>
        <li>JOIN operations: ~500–700ms</li>
        <li>Proof verification: ~7ms per query</li>
        <li>On-chain verification: under 150k gas</li>
      </ul>

      <h2 id="supported-data">Indexed Blockchain Data</h2>
      <p>
        SxT currently indexes the following chains:
      </p>
      <ul>
        <li><strong>Ethereum</strong> — Full transaction history, ERC-20/721/1155 events, DeFi protocol data (Uniswap, Aave, etc.)</li>
        <li><strong>Bitcoin</strong> — Block and transaction data</li>
        <li><strong>Polygon</strong> — Transactions, tokens, and DeFi events</li>
        <li><strong>ZKsync</strong> — Transaction and event indexing</li>
        <li><strong>Sui</strong> — Object and transaction indexing</li>
        <li><strong>Avalanche</strong> — Transaction and event data</li>
      </ul>

      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">Coming Soon</div>
        Base, Arbitrum, Optimism, and BNB Chain indexing are planned but not yet available. DreamSpace will integrate these as soon as SxT enables support.
      </div>

      <h2 id="on-chain-contracts">On-Chain Contracts</h2>
      <p>
        SxT has deployed ZKpay relayer and verifier contracts for submitting queries and verifying proofs on-chain:
      </p>
      <pre><code>{`// ZKpay Query Relayer Contracts
// Ethereum Mainnet: 0x27d4d2af364c1ad2ebdb2a28d6cb7b99ede1d450
// Ethereum Sepolia: 0xA735143283a6E686723403A820841E5774951a63

// On-Chain Verifier Contracts
// Ethereum Mainnet: 0x84d6795ff1fCc224De328C86C318fABC396826B0
// Ethereum Sepolia: 0x99b3c29dDC225F75f9248c863379b195Ef9D82C2

// Smart contracts can request ZK-proven query results via ZKpay:
// 1. Client contract calls ZKpay relayer with SQL + payment (USDC or SXT)
// 2. SxT indexer picks up the on-chain event
// 3. Query executes, Proof of SQL generates ZK proof
// 4. Results + proof return on-chain
// 5. Verifier contract validates the proof
// 6. Client contract receives results via zkPayCallback`}</code></pre>

      <h2 id="for-agents">For AI Agents</h2>
      <p>
        Space and Time is powerful for AI agents that need verifiable data to make decisions. An agent can query market conditions, verify the data via Proof of SQL, and submit the proof to a smart contract before executing trades.
      </p>
      <pre><code>{`// Agent queries market data with ZK proof
const marketData = await query.sql(\`
  SELECT
    CONTRACT_ADDRESS,
    SUM(VALUE) as TOTAL_VOLUME
  FROM ETHEREUM.TOKEN_ERC20_TRANSFERS
  WHERE BLOCK_NUMBER > 19500000
  GROUP BY CONTRACT_ADDRESS
  LIMIT 10
\`, { proof: true });

// Agent submits proof to smart contract via ZKpay
// The contract verifies data authenticity before allowing execution
await contracts.call('AgentTradingVault', 'executeWithProof', {
  args: [marketData.rows[0].CONTRACT_ADDRESS, tradeAmount, marketData.proof],
});`}</code></pre>

      <h2 id="for-users">For Users</h2>
      <p>
        Users benefit through transparent, verifiable dashboards. Instead of trusting a backend server, users can independently verify that the data they see is correct via the on-chain verifier.
      </p>
      <pre><code>{`// User-facing portfolio with verified data
const portfolio = await query.sql(\`
  SELECT
    CONTRACT_ADDRESS,
    SUM(VALUE) as BALANCE
  FROM ETHEREUM.TOKEN_ERC20_WALLET_BALANCES
  WHERE WALLET_ADDRESS = :userAddress
  GROUP BY CONTRACT_ADDRESS
\`, {
  userAddress: '0xUser...',
  proof: true,
});

// Display with a "Verified by Space and Time" badge
// Users can check the proof against the on-chain verifier`}</code></pre>

      <h2 id="capabilities">What Space and Time Can Do</h2>
      <ul>
        <li>ANSI-compliant SQL on indexed blockchain data (OLTP + OLAP engines)</li>
        <li>ZK-proven query results for SELECT/WHERE/JOIN/GROUP BY/SUM/COUNT</li>
        <li>Custom table creation with granular biscuit token permissions</li>
        <li>Cross-table JOINs between blockchain and custom application data</li>
        <li>On-chain proof verification via deployed verifier contracts (Ethereum)</li>
        <li>ZKpay smart contract query relayer for trustless data feeds</li>
        <li>Kafka-based streaming for high-volume data ingestion into custom tables</li>
        <li>Protocol-specific indexed tables (Uniswap, Aave, hundreds more)</li>
        <li>Sub-second proof generation on GPU-accelerated prover nodes</li>
      </ul>

      <h2 id="limitations">What Space and Time Cannot Do (Current Limitations)</h2>
      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">Honest Limitations</div>
        DreamSpace is transparent about the current capabilities and limitations of Space and Time.
      </div>
      <ul>
        <li><strong>No real-time WebSocket streaming</strong> — SxT uses polling-based data access. Kafka streaming is for data ingestion (writing in), not query result streaming (pushing out). For real-time events, use direct RPC subscriptions.</li>
        <li><strong>No cross-chain JOINs</strong> — You cannot JOIN tables from different blockchains in a single query (e.g., ETHEREUM + POLYGON).</li>
        <li><strong>Proof of SQL is SELECT-only</strong> — INSERT, UPDATE, DELETE do not generate proofs. Only a subset of SELECT queries are provable (no subqueries, window functions, AVG, MIN, MAX, DISTINCT, UNION, ORDER BY, or division).</li>
        <li><strong>Limited chain indexing</strong> — Base, Arbitrum, Optimism, and BNB Chain are not yet indexed. Currently: Ethereum, Bitcoin, Polygon, ZKsync, Sui, Avalanche.</li>
        <li><strong>10,000 row limit</strong> per query result. Use pagination for larger datasets.</li>
        <li><strong>On-chain verifier contracts</strong> are only on Ethereum Mainnet and Sepolia. Base and ZKsync contract deployments are coming soon.</li>
        <li><strong>Custom table storage is centralized</strong> — blockchain-indexed tables are decentralized, but custom tables are stored on SxT infrastructure.</li>
        <li><strong>Node.js requirement</strong> — The SxT SDK requires Node.js &gt;= 19.8.0 with the <code>--experimental-wasm-modules</code> flag.</li>
        <li><strong>Auth token expiry</strong> — Access tokens expire after 25 minutes, refresh tokens after 30 minutes. DreamSpace handles auto-refresh.</li>
      </ul>
    </>
  );
}
