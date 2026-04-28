export default function OnchainYieldAgent() {
  return (
    <>
      <h1>Onchain Yield Agent</h1>
      <p>
        An autonomous AI agent that monitors DeFi yield opportunities using verified blockchain data from Space and Time, executes rebalancing strategies through smart contracts, and sells its signals via x402 micropayments.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">Modules Used</div>
        <span className="docs-example-tag">Auth &amp; Identity</span>
        <span className="docs-example-tag">ERC-8004</span>
        <span className="docs-example-tag">Query</span>
        <span className="docs-example-tag">Contracts</span>
        <span className="docs-example-tag">Wallet</span>
        <span className="docs-example-tag">x402</span>
      </div>

      <h2 id="what-youll-build">What You&apos;ll Build</h2>
      <p>
        A long-running agent process that polls DeFi protocol data from SxT (Uniswap, Aave), identifies yield opportunities with cryptographic proof, submits verified data to a smart contract vault for automated rebalancing, and exposes an x402-gated API for users who want access to the agent&apos;s signals.
      </p>

      <h2 id="step-1">Step 1 — Create Agent Identity</h2>
      <pre><code>{`import { init, identity, wallet } from '@dreamspace/sdk';

await init({
  sxtApiKey: process.env.SXT_API_KEY,
  network: 'ethereum',
});

// Create a dedicated wallet for the agent
const agentWallet = await wallet.create({
  type: 'hd',
  name: 'yield-agent-wallet',
});

// Create a DreamSpace identity for the agent
const agentIdentity = await identity.create({
  type: 'agent',
  name: 'DeFi Yield Agent',
  wallet: agentWallet.address,
});`}</code></pre>

      <h2 id="step-2">Step 2 — Register On-Chain via ERC-8004</h2>
      <p>
        Register the agent in the ERC-8004 Identity Registry so other agents and users can discover and verify it.
      </p>
      <pre><code>{`import { erc8004 } from '@dreamspace/sdk';

// Register agent on-chain (mints an ERC-721 token)
const registration = await erc8004.register({
  agentURI: 'https://yield-agent.api/.well-known/agent.json',
  metadata: [
    { key: 'name', value: 'DeFi Yield Agent' },
    { key: 'version', value: '1.0.0' },
    { key: 'capabilities', value: 'query,rebalance,signals' },
  ],
});

// Set the agent's wallet address
await erc8004.setAgentWallet(registration.agentId, agentWallet.address);

console.log('Agent ID:', registration.agentId);`}</code></pre>

      <h2 id="step-3">Step 3 — Query DeFi Data with ZK Proofs</h2>
      <p>
        Poll SxT for DeFi protocol data. The agent queries Uniswap pool stats and Aave lending rates, each backed by a ZK proof.
      </p>
      <pre><code>{`import { query } from '@dreamspace/sdk';

async function getYieldOpportunities() {
  // Query Uniswap V3 pool data from SxT-indexed tables
  const uniswapPools = await query.sql(\`
    SELECT POOL_ADDRESS, TOKEN0, TOKEN1, FEE_TIER,
           LIQUIDITY, SQRT_PRICE, TICK
    FROM ETHEREUM.UNISWAP_V3_POOL_STATS
    WHERE LIQUIDITY > 1000000
    ORDER BY LIQUIDITY DESC
    LIMIT 50
  \`, { proof: true });

  // Query Aave lending rates
  const aaveRates = await query.sql(\`
    SELECT RESERVE_ADDRESS, SYMBOL,
           VARIABLE_BORROW_RATE, LIQUIDITY_RATE
    FROM ETHEREUM.AAVE_V3_RESERVE_DATA
    WHERE LIQUIDITY_RATE > 0
    ORDER BY LIQUIDITY_RATE DESC
  \`, { proof: true });

  return {
    uniswap: uniswapPools,
    aave: aaveRates,
  };
}`}</code></pre>

      <h2 id="step-4">Step 4 — Submit Proofs to Smart Contract Vault</h2>
      <p>
        The agent submits verified data and its ZK proof to a smart contract vault, which validates the proof before executing any rebalancing trades.
      </p>
      <pre><code>{`import { contracts } from '@dreamspace/sdk';

async function executeRebalance(yieldData) {
  // Submit verified data + proof to the vault contract
  const tx = await contracts.call('YieldVault', 'rebalance', {
    args: [
      yieldData.uniswap.proof,
      yieldData.aave.proof,
      targetAllocations,
    ],
    wallet: agentWallet,
    network: 'ethereum',
  });

  console.log('Rebalance tx:', tx.hash);
}

// Run the agent loop — poll every 5 minutes
setInterval(async () => {
  const opportunities = await getYieldOpportunities();
  const bestStrategy = analyzeYield(opportunities);

  if (bestStrategy.expectedApy > currentApy * 1.05) {
    await executeRebalance(opportunities);
  }
}, 5 * 60 * 1000);`}</code></pre>

      <h2 id="step-5">Step 5 — Monetize Signals via x402</h2>
      <p>
        Expose the agent&apos;s yield analysis as an x402-gated API. Users pay per-call in USDC to access the agent&apos;s signals.
      </p>
      <pre><code>{`import { x402 } from '@dreamspace/sdk';
import express from 'express';
import { paymentMiddleware } from '@x402/express';

const app = express();

app.use(paymentMiddleware({
  'GET /api/signals': {
    price: '$0.01',
    network: 'base',
    config: {
      description: 'Current yield opportunities with ZK proofs',
    },
  },
}));

app.get('/api/signals', async (req, res) => {
  const opportunities = await getYieldOpportunities();
  res.json({
    signals: analyzeYield(opportunities),
    proofs: {
      uniswap: opportunities.uniswap.proofHash,
      aave: opportunities.aave.proofHash,
    },
  });
});`}</code></pre>

      <h2 id="step-6">Step 6 — Build Reputation</h2>
      <pre><code>{`// Users who benefit from the agent's signals can leave feedback
await erc8004.giveFeedback({
  agentId: registration.agentId,
  value: 92,
  tag1: 'accuracy',
  tag2: 'defi-yield',
  endpoint: '/api/signals',
});

// Other agents/users check reputation before trusting signals
const rep = await erc8004.getSummary(registration.agentId);
console.log('Reputation score:', rep.summaryValue);`}</code></pre>

      <h2 id="limitations">Limitations &amp; Honest Notes</h2>
      <ul>
        <li><strong>SxT is polling-based</strong> — There is no real-time WebSocket feed. The agent polls SxT at intervals, so data lags a few blocks behind chain head.</li>
        <li><strong>Agent delegation is custom</strong> — ERC-8004 provides identity and reputation registries, but execution policies (what the agent can do with user funds) must be implemented in your own smart contracts.</li>
        <li><strong>Cross-chain JOINs not supported</strong> — You cannot JOIN Ethereum and Polygon tables in a single SxT query. Query each chain separately and merge in application code.</li>
        <li><strong>Vault contract not included</strong> — The <code>YieldVault</code> contract in this example is custom. You&apos;ll need to write and audit your own vault logic.</li>
        <li><strong>ERC-8004 is early-adoption</strong> — The standard is live on Ethereum mainnet but ecosystem tooling is still maturing.</li>
      </ul>
    </>
  );
}
