export default function QuickStart() {
  return (
    <>
      <h1>Quick Start</h1>
      <p>Get a DreamSpace project up and running in under 5 minutes.</p>

      <h2 id="prerequisites">Prerequisites</h2>
      <ul>
        <li>Node.js &gt;= 19.8.0 (required by the SxT SDK for WASM module support)</li>
        <li>A Space and Time API key (free tier available at <strong>app.spaceandtime.io</strong>)</li>
        <li>A wallet private key or mnemonic for contract deployment (testnet recommended)</li>
      </ul>

      <h2 id="installation">Installation</h2>
      <pre><code>{`$ npm install @dreamspace/sdk`}</code></pre>
      <p>Or with yarn:</p>
      <pre><code>{`$ yarn add @dreamspace/sdk`}</code></pre>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">SxT WASM Requirement</div>
        The underlying <code>sxt-nodejs-sdk</code> uses WebAssembly modules. You may need to add <code>--experimental-wasm-modules</code> to your Node.js scripts. DreamSpace handles this automatically in its CLI tools.
      </div>

      <h2 id="initialize">Initialize a Project</h2>
      <pre><code>{`import { DreamSpace } from '@dreamspace/sdk';

const ds = new DreamSpace({
  sxtApiKey: process.env.SXT_API_KEY,    // Space and Time API key
  network: 'ethereum',                    // Default chain for SxT queries
  deployTarget: 'base',                   // Default chain for contract deployment
  walletKey: process.env.PRIVATE_KEY,     // For contract deployment (optional)
});

await ds.init();
// Under the hood, this:
// 1. Generates ED25519 key pair for SxT authentication
// 2. Obtains access token (25 min) and refresh token (30 min)
// 3. Sets up auto-refresh for token expiry
// 4. Configures biscuit tokens for table access
// 5. Connects wallet provider for contract deployment

console.log('Connected to SxT, deploy target:', ds.deployTarget);`}</code></pre>

      <h2 id="first-query">Your First Query</h2>
      <pre><code>{`// Query Ethereum transactions indexed by Space and Time
// Table names use UPPERCASE schema notation
const result = await ds.query.sql(\`
  SELECT BLOCK_NUMBER, FROM_ADDRESS, TO_ADDRESS, VALUE
  FROM ETHEREUM.TRANSACTIONS
  WHERE BLOCK_NUMBER > 19000000
  AND VALUE > 1000000000000000000
  LIMIT 10
\`);

console.log(result.rows);
// Each result can include a Proof of SQL ZK proof:
// result.proof — cryptographic proof of correctness`}</code></pre>

      <h2 id="verified-query">Your First Verified Query</h2>
      <pre><code>{`// Add { proof: true } to get a ZK-SNARK proof
const verified = await ds.query.sql(\`
  SELECT COUNT(*) as TX_COUNT
  FROM ETHEREUM.TRANSACTIONS
  WHERE BLOCK_NUMBER > 19500000
\`, { proof: true });

console.log(verified.rows);    // [{ TX_COUNT: 1234567 }]
console.log(verified.proof);   // ZK proof (~7ms to verify)

// This proof can be verified on-chain via SxT's verifier contract
// Ethereum Mainnet: 0x84d6795ff1fCc224De328C86C318fABC396826B0`}</code></pre>

      <h2 id="deploy-contract">Deploy a Contract</h2>
      <pre><code>{`import { contracts } from '@dreamspace/sdk';

// Deploy to Base (or any EVM chain) using OpenZeppelin templates
const nft = await contracts.deploy('ERC721', {
  name: 'DreamNFT',
  symbol: 'DNFT',
  baseURI: 'ipfs://QmYour.../metadata/',
  network: 'base',
});

console.log('Deployed to:', nft.address);`}</code></pre>

      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">SxT Data vs. Contract Deployment</div>
        SxT currently indexes Ethereum, Bitcoin, Polygon, ZKsync, Sui, and Avalanche. Base indexing is coming soon. You can deploy contracts to Base today, but SxT-verified queries for Base data are not yet available.
      </div>

      <h2 id="ship-it">Ship to DreamSpace</h2>
      <pre><code>{`$ npx dreamspace deploy

✓ Building optimized production bundle...
✓ Uploading assets to IPFS...
✓ Deploying to DreamSpace CDN...
✓ Live at: https://your-app.dream.space`}</code></pre>

      <h2 id="next-steps">Next Steps</h2>
      <ul>
        <li>Read the <strong>Query</strong> docs to understand Proof of SQL capabilities and limitations</li>
        <li>Explore <strong>Space and Time</strong> for a deep dive into indexed chains and on-chain verification</li>
        <li>Learn about <strong>x402</strong> (Coinbase) for micropayment-gated APIs</li>
        <li>Set up <strong>ERC-8004</strong> for on-chain agent identity and reputation</li>
        <li>Check <strong>Networks</strong> to understand which chains support what features</li>
      </ul>
    </>
  );
}
