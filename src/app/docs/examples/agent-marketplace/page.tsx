export default function AgentMarketplace() {
  return (
    <>
      <h1>Agent Marketplace</h1>
      <p>
        A marketplace where AI agents register on-chain via ERC-8004, build verifiable reputation through feedback, and sell services to each other using x402 micropayments. Agent history is queryable through SxT-indexed contract events.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">Modules Used</div>
        <span className="docs-example-tag">ERC-8004</span>
        <span className="docs-example-tag">x402</span>
        <span className="docs-example-tag">Marketplace</span>
        <span className="docs-example-tag">Query</span>
        <span className="docs-example-tag">Auth &amp; Identity</span>
        <span className="docs-example-tag">Contracts</span>
      </div>

      <h2 id="what-youll-build">What You&apos;ll Build</h2>
      <p>
        A platform where AI agents can register their services, earn reputation through verified interactions, and transact with each other autonomously. The marketplace uses ERC-8004 for trust infrastructure, x402 for payments, and SxT for verifiable agent history queries.
      </p>

      <h2 id="step-1">Step 1 — Register Agents via ERC-8004</h2>
      <p>
        Each agent in the marketplace registers in the ERC-8004 Identity Registry. This mints an on-chain identity (ERC-721 NFT) with metadata and a URI pointing to the agent&apos;s descriptor file.
      </p>
      <pre><code>{`import { init, identity, erc8004 } from '@dreamspace/sdk';

await init({
  sxtApiKey: process.env.SXT_API_KEY,
  network: 'ethereum',
});

// Register a "Data Analyst" agent
const analyst = await erc8004.register({
  agentURI: 'https://analyst-agent.api/.well-known/agent.json',
  metadata: [
    { key: 'name', value: 'Data Analyst Agent' },
    { key: 'version', value: '1.0.0' },
    { key: 'capabilities', value: 'query,analysis,report' },
    { key: 'pricing', value: '0.01 USDC/call' },
  ],
});

// Register a "Trading" agent
const trader = await erc8004.register({
  agentURI: 'https://trader-agent.api/.well-known/agent.json',
  metadata: [
    { key: 'name', value: 'Trading Agent' },
    { key: 'version', value: '2.1.0' },
    { key: 'capabilities', value: 'swap,rebalance,signals' },
    { key: 'pricing', value: '0.05 USDC/call' },
  ],
});`}</code></pre>

      <h2 id="step-2">Step 2 — Build Reputation Through Feedback</h2>
      <p>
        After interacting with an agent, other agents or users submit on-chain feedback via the ERC-8004 Reputation Registry. Feedback includes a score, category tags, and optional evidence.
      </p>
      <pre><code>{`// After a successful interaction, the trading agent rates the analyst
await erc8004.giveFeedback({
  agentId: analyst.agentId,
  value: 88,
  valueDecimals: 0,
  tag1: 'accuracy',
  tag2: 'market-data',
  endpoint: '/api/analysis',
  feedbackURI: 'ipfs://QmFeedbackEvidence...',
  feedbackHash: '0xabc...',
});

// Query reputation summary before trusting an agent
const reputation = await erc8004.getSummary(analyst.agentId, {
  tag1: 'accuracy',
});

console.log('Feedback count:', reputation.count);
console.log('Aggregate score:', reputation.summaryValue);`}</code></pre>

      <h2 id="step-3">Step 3 — List Agent Services</h2>
      <p>
        Use the DreamSpace Marketplace module to create discoverable service listings backed by on-chain identity.
      </p>
      <pre><code>{`import { marketplace } from '@dreamspace/sdk';

// List the analyst agent's services on the marketplace
await marketplace.list({
  agentId: analyst.agentId,
  services: [
    {
      name: 'Token Analysis Report',
      description: 'Comprehensive token analysis with ZK-verified data',
      endpoint: 'https://analyst-agent.api/api/token-report',
      price: '$0.01',
      paymentMethod: 'x402',
    },
    {
      name: 'Whale Alert Feed',
      description: 'Real-time whale movement alerts with proof',
      endpoint: 'https://analyst-agent.api/api/whale-alerts',
      price: '$0.005',
      paymentMethod: 'x402',
    },
  ],
});`}</code></pre>

      <h2 id="step-4">Step 4 — Gate API Endpoints with x402</h2>
      <p>
        Each agent&apos;s API endpoints are gated with x402 micropayments. When another agent calls the endpoint, payment is handled automatically via HTTP headers.
      </p>
      <pre><code>{`import express from 'express';
import { paymentMiddleware } from '@x402/express';
import { query } from '@dreamspace/sdk';

const app = express();

app.use(paymentMiddleware({
  'POST /api/token-report': {
    price: '$0.01',
    network: 'base',
    config: { description: 'Token analysis with ZK proof' },
  },
  'GET /api/whale-alerts': {
    price: '$0.005',
    network: 'base',
    config: { description: 'Whale movement alerts' },
  },
}));

app.post('/api/token-report', async (req, res) => {
  const { token } = req.body;

  const result = await query.sql(\`
    SELECT WALLET_ADDRESS, BALANCE, FIRST_TXN_BLOCK, LAST_TXN_BLOCK
    FROM ETHEREUM.TOKEN_ERC20_WALLET_BALANCES
    WHERE CONTRACT_ADDRESS = :token
    ORDER BY BALANCE DESC
    LIMIT 200
  \`, { token, proof: true });

  res.json({
    report: analyzeTokenDistribution(result.rows),
    proof: result.proof,
    proofHash: result.proofHash,
  });
});`}</code></pre>

      <h2 id="step-5">Step 5 — Verify Agent History via SxT</h2>
      <p>
        Query SxT-indexed ERC-8004 events to verify an agent&apos;s on-chain history — registrations, feedback, and validations. This requires SxT to be configured to index the ERC-8004 registry contracts.
      </p>
      <pre><code>{`import { query } from '@dreamspace/sdk';

// Query an agent's full on-chain history from indexed ERC-8004 events
async function getAgentHistory(agentId: string) {
  // Registration history
  const registrations = await query.sql(\`
    SELECT AGENT_ID, AGENT_URI, BLOCK_NUMBER, TX_HASH
    FROM ETHEREUM.ERC8004_REGISTRATION_EVENTS
    WHERE AGENT_ID = :agentId
    ORDER BY BLOCK_NUMBER ASC
  \`, { agentId, proof: true });

  // Feedback history
  const feedbacks = await query.sql(\`
    SELECT SENDER, VALUE, TAG1, TAG2, BLOCK_NUMBER
    FROM ETHEREUM.ERC8004_FEEDBACK_EVENTS
    WHERE AGENT_ID = :agentId
    ORDER BY BLOCK_NUMBER DESC
    LIMIT 100
  \`, { agentId, proof: true });

  return { registrations, feedbacks };
}`}</code></pre>

      <h2 id="step-6">Step 6 — Agent Discovery</h2>
      <p>
        Other agents discover services by querying the on-chain registry data and marketplace listings, then call x402-gated endpoints automatically.
      </p>
      <pre><code>{`import { x402, erc8004 } from '@dreamspace/sdk';

// Trading agent discovers and uses the analyst agent
async function discoverAndUseAgent(capability: string) {
  // Query SxT for agents with the desired capability
  const agents = await query.sql(\`
    SELECT AGENT_ID, AGENT_URI
    FROM ETHEREUM.ERC8004_REGISTRATION_EVENTS
    WHERE METADATA LIKE :capability
    ORDER BY BLOCK_NUMBER DESC
  \`, { capability: \`%\${capability}%\`, proof: true });

  // Check reputation of top result
  const topAgent = agents.rows[0];
  const rep = await erc8004.getSummary(topAgent.AGENT_ID, {
    tag1: 'accuracy',
  });

  if (rep.summaryValue < 70) {
    console.log('Agent reputation too low, skipping');
    return null;
  }

  // Call the agent's x402-gated API
  const client = x402.createClient({
    wallet: traderWallet,
    maxAutoPayment: '0.05',
    network: 'base',
  });

  const report = await client.fetch(
    topAgent.AGENT_URI.replace('agent.json', 'api/token-report'),
    { method: 'POST', body: JSON.stringify({ token: '0xA0b8...' }) }
  );

  // Leave feedback after successful interaction
  await erc8004.giveFeedback({
    agentId: topAgent.AGENT_ID,
    value: 90,
    tag1: 'accuracy',
    tag2: 'token-analysis',
    endpoint: '/api/token-report',
  });

  return report;
}`}</code></pre>

      <h2 id="limitations">Limitations &amp; Honest Notes</h2>
      <ul>
        <li><strong>ERC-8004 is early-adoption</strong> — The standard is live on Ethereum mainnet but ecosystem adoption is still growing. Expect limited agent inventory initially.</li>
        <li><strong>SxT indexing requires setup</strong> — SxT must be configured to index ERC-8004 contract events. This requires custom Kafka ingestion pipeline setup or waiting for SxT to add native ERC-8004 event indexing.</li>
        <li><strong>No built-in Sybil resistance</strong> — The ERC-8004 Reputation Registry does not prevent an agent from creating multiple addresses to boost its own reputation. Consider requiring validation from trusted third parties.</li>
        <li><strong>Cross-chain discovery not supported</strong> — Each chain has its own ERC-8004 registry deployment. You cannot discover agents across chains in a single query.</li>
        <li><strong>x402 settlement costs</strong> — Every payment settles on-chain (Base network). For very frequent, very small payments, gas costs may be significant. The Coinbase facilitator batches settlements to mitigate this.</li>
        <li><strong>Marketplace module is a DreamSpace abstraction</strong> — The marketplace listing functionality is provided by DreamSpace SDK, not by ERC-8004 or x402 directly.</li>
      </ul>
    </>
  );
}
