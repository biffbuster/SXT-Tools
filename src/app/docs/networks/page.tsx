export default function Networks() {
  return (
    <>
      <h1>Networks</h1>
      <p>
        The Networks module manages multi-chain configuration, RPC endpoints, and chain switching. It also tracks which chains are available for SxT data queries vs. smart contract deployment — these are different capabilities with different chain support.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">SxT Data vs. Contract Deployment</div>
        Space and Time indexes blockchain data for <strong>Ethereum, Bitcoin, Polygon, ZKsync, Sui, and Avalanche</strong>. DreamSpace supports smart contract deployment on any EVM chain. These are separate capabilities — you can deploy contracts on Base but SxT data queries for Base are not yet available.
      </div>

      <h2 id="overview">Overview</h2>
      <pre><code>{`import { networks } from '@dreamspace/sdk';

// List all supported networks
const supported = networks.list();
console.log(supported.deployment);  // EVM chains for contract deployment
console.log(supported.sxtIndexed);  // Chains with SxT data available

// Get network details
const ethereum = networks.get('ethereum');
console.log(ethereum.chainId);         // 1
console.log(ethereum.sxtSupport);      // true — indexed by SxT
console.log(ethereum.contractDeploy);  // true — can deploy contracts`}</code></pre>

      <h2 id="sxt-indexed">SxT Indexed Chains (Data Queries)</h2>
      <p>
        These chains have blockchain data indexed by Space and Time, queryable via SQL with Proof of SQL support:
      </p>
      <ul>
        <li><strong>Ethereum</strong> — Full transaction history, ERC-20/721/1155 events, DeFi protocols</li>
        <li><strong>Bitcoin</strong> — Block and transaction data</li>
        <li><strong>Polygon</strong> — Transactions, tokens, and events</li>
        <li><strong>ZKsync</strong> — Transaction and event indexing</li>
        <li><strong>Sui</strong> — Object and transaction data</li>
        <li><strong>Avalanche</strong> — Transaction and event data</li>
      </ul>

      <h2 id="deployment-chains">Deployment Chains (Smart Contracts)</h2>
      <p>
        DreamSpace supports contract deployment on any EVM-compatible chain:
      </p>
      <ul>
        <li><strong>Ethereum</strong> — Mainnet and Sepolia testnet</li>
        <li><strong>Base</strong> — Coinbase L2 (mainnet and Sepolia)</li>
        <li><strong>Polygon</strong> — PoS mainnet and Amoy testnet</li>
        <li><strong>Arbitrum</strong> — One mainnet and Sepolia</li>
        <li><strong>Optimism</strong> — Mainnet and Sepolia</li>
        <li><strong>Custom EVM chains</strong> — Any chain with an RPC endpoint</li>
      </ul>

      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">Base Data Queries Coming Soon</div>
        While DreamSpace supports Base for contract deployment and is our primary L2 target, SxT does not yet index Base blockchain data. Base SxT indexing and on-chain verifier contract deployment are planned. Until then, Base contract interactions use direct RPC calls.
      </div>

      <h2 id="configuration">Configuration</h2>
      <pre><code>{`import { DreamSpace } from '@dreamspace/sdk';

const ds = new DreamSpace({
  networks: {
    default: 'ethereum',       // Default for SxT queries
    deployTarget: 'base',      // Default for contract deployment
    custom: [{
      name: 'my-l2',
      chainId: 99999,
      rpcUrl: 'https://rpc.my-l2.network',
      explorer: 'https://scan.my-l2.network',
      nativeCurrency: { name: 'ML2', symbol: 'ML2', decimals: 18 },
      sxtSupport: false,       // No SxT indexing for custom chains
    }],
  },
});`}</code></pre>

      <h2 id="chain-switching">Chain Switching</h2>
      <pre><code>{`// Switch chains for contract operations
await networks.switchTo('base');

// Execute on a specific chain without switching global context
const blockNumber = await networks.on('ethereum', async (provider) => {
  return provider.getBlockNumber();
});

// SxT queries always target indexed chains regardless of active deploy chain
// This query works even when your active chain is Base:
const result = await query.sql('SELECT * FROM ETHEREUM.BLOCKS LIMIT 5');`}</code></pre>

      <h2 id="rpc-management">RPC Management</h2>
      <p>
        DreamSpace includes automatic RPC failover and latency-based routing for contract interactions.
      </p>
      <pre><code>{`networks.configure('ethereum', {
  rpcUrls: [
    'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
    'https://mainnet.infura.io/v3/YOUR_KEY',
    'https://rpc.ankr.com/eth',
  ],
  strategy: 'fastest',  // 'fastest' | 'round-robin' | 'failover'
});`}</code></pre>

      <h2 id="on-chain-contracts">SxT On-Chain Contract Addresses</h2>
      <pre><code>{`// ZKpay Query Relayer
networks.sxtContracts('ethereum').zkpayRelayer;
// Mainnet: 0x27d4d2af364c1ad2ebdb2a28d6cb7b99ede1d450
// Sepolia: 0xA735143283a6E686723403A820841E5774951a63

// Proof of SQL Verifier
networks.sxtContracts('ethereum').verifier;
// Mainnet: 0x84d6795ff1fCc224De328C86C318fABC396826B0
// Sepolia: 0x99b3c29dDC225F75f9248c863379b195Ef9D82C2

// Base and ZKsync verifier contracts: coming soon`}</code></pre>
    </>
  );
}
