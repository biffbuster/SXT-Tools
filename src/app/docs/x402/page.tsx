export default function X402() {
  return (
    <>
      <h1>x402 Payment Protocol</h1>
      <p>
        x402 is an <strong>open standard by Coinbase</strong> for internet-native payments using the HTTP 402 &ldquo;Payment Required&rdquo; status code. It has processed over 100M payments since May 2025. DreamSpace SDK integrates x402 to enable micropayment-gated APIs, agent-to-agent commerce, and pay-per-call billing — with optional SxT Proof of SQL verification for payment proofs.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">x402 is a Coinbase Protocol</div>
        x402 is built and maintained by Coinbase as an open standard. DreamSpace wraps the official <code>@x402/express</code>, <code>@x402/fetch</code>, and <code>@x402/next</code> packages to provide seamless integration with the DreamSpace SDK and SxT data layer. SxT does not natively support x402 — DreamSpace bridges the two.
      </div>

      <h2 id="how-it-works">How It Works</h2>
      <ul>
        <li><strong>Client requests a resource</strong> — standard HTTP GET/POST</li>
        <li><strong>Server responds with 402</strong> — includes a <code>PAYMENT-REQUIRED</code> header (base64 JSON) with amount, token, and recipient</li>
        <li><strong>Client creates a PaymentPayload</strong> — selects payment method and signs authorization</li>
        <li><strong>Client retries with <code>X-PAYMENT</code> header</strong> — containing the signed payment payload</li>
        <li><strong>Server verifies via Coinbase facilitator</strong> — calls <code>/verify</code> endpoint</li>
        <li><strong>Server settles via facilitator</strong> — calls <code>/settle</code> to submit payment on-chain</li>
        <li><strong>Server responds with 200</strong> — includes <code>PAYMENT-RESPONSE</code> header with settlement confirmation</li>
      </ul>

      <h2 id="packages">Official x402 Packages</h2>
      <pre><code>{`# Core protocol + framework integrations
npm install @x402/core @x402/evm @x402/fetch @x402/express @x402/next

# Additional packages
npm install @x402/axios @x402/hono @x402/paywall @x402/svm  # Solana support`}</code></pre>

      <h2 id="server-setup">Setting Up a Paid Endpoint</h2>
      <pre><code>{`import { paymentMiddleware } from '@x402/express';
// or: import { paymentMiddleware } from '@x402/next';

// DreamSpace wraps x402 middleware with SxT data access
app.use(paymentMiddleware({
  'GET /api/market-data': {
    price: '$0.001',
    network: 'base',
    config: {
      description: 'Verified blockchain market data via Space and Time',
    },
  },
  'POST /api/query': {
    price: '$0.01',
    network: 'base',
    config: {
      description: 'Custom SQL query with Proof of SQL verification',
    },
  },
}));`}</code></pre>

      <h2 id="client-usage">Client-Side Usage</h2>
      <pre><code>{`import { x402 } from '@dreamspace/sdk';

// DreamSpace wraps @x402/fetch with wallet integration
const client = x402.createClient({
  wallet: myWallet,
  maxAutoPayment: '0.01',  // Auto-pay up to this amount in USDC
  network: 'base',
});

// The client automatically handles 402 responses
const response = await client.fetch('https://api.example.com/market-data');

// Payment happened automatically via Coinbase facilitator
console.log(response.data);      // The API response
console.log(response.payment);   // { txHash, amount, token }`}</code></pre>

      <h2 id="supported-networks">Supported Networks</h2>
      <ul>
        <li><strong>Base Mainnet</strong> (chain ID: 8453) — Primary network, free tier available</li>
        <li><strong>Base Sepolia</strong> (chain ID: 84532) — Testnet, free tier</li>
        <li><strong>Ethereum Mainnet</strong> (chain ID: 1) — Via <code>@x402/evm</code></li>
        <li><strong>Solana Mainnet</strong> — Via <code>@x402/svm</code></li>
        <li><strong>Any EVM chain</strong> — Supported via the generic <code>@x402/evm</code> package</li>
      </ul>
      <p>
        Accepted token: <strong>USDC</strong> (and any EIP-3009 compliant token on EVM chains).
      </p>

      <h2 id="facilitator">Coinbase Facilitator</h2>
      <pre><code>{`// Mainnet facilitator (requires Coinbase Developer Platform API keys):
// https://api.cdp.coinbase.com/platform/v2/x402

// Testnet facilitator (no API keys needed):
// https://www.x402.org/facilitator

// Pricing: 1,000 free monthly transactions
// After that: $0.001 per transaction`}</code></pre>

      <h2 id="agent-to-agent">Agent-to-Agent Payments</h2>
      <p>
        x402 is particularly powerful for AI agent ecosystems. When combined with ERC-8004 agent identities and SxT data, agents can autonomously pay for verified data services.
      </p>
      <pre><code>{`// Agent A needs verified market data from Agent B's API
const agentClient = x402.createClient({
  wallet: agentWallet,
  maxAutoPayment: '0.05',
  budgetPeriod: '1h',
  budgetLimit: '1.00',       // Max USDC spend per hour
});

// Agent A calls Agent B's x402-gated endpoint
const data = await agentClient.fetch(
  'https://agent-b.api/verified-market-analysis',
  { method: 'POST', body: JSON.stringify({ query: 'ETH volume 24h' }) }
);

// Agent B:
// 1. Receives USDC via x402
// 2. Queries SxT for verified data
// 3. Returns data + Proof of SQL proof
// Agent A can independently verify the proof`}</code></pre>

      <h2 id="sxt-bridge">Bridging x402 with Space and Time</h2>
      <p>
        DreamSpace bridges x402 payments with SxT data verification. This is a DreamSpace-specific integration — SxT does not natively support x402. SxT uses its own <strong>ZKpay</strong> system (USDC/SXT tokens on-chain) for smart contract queries.
      </p>
      <pre><code>{`// DreamSpace bridges x402 HTTP payments with SxT ZKpay on-chain payments
// This lets you offer verified data APIs gated by x402 micropayments

import { x402, query } from '@dreamspace/sdk';

// Paid endpoint that returns SxT-verified data
app.get('/api/token-holders', x402.gate({ price: '$0.005' }), async (req, res) => {
  const result = await query.sql(\`
    SELECT WALLET_ADDRESS, BALANCE
    FROM ETHEREUM.TOKEN_ERC20_WALLET_BALANCES
    WHERE CONTRACT_ADDRESS = :token
    AND BALANCE > 0
  \`, { token: req.query.token, proof: true });

  res.json({
    data: result.rows,
    proof: result.proof,   // Buyer can verify this independently
  });
});`}</code></pre>

      <h2 id="limitations">Limitations &amp; Considerations</h2>
      <ul>
        <li>On-chain settlement has gas costs — for very small micropayments (&lt;$0.001), gas may exceed payment. The Coinbase facilitator batches settlements to reduce this.</li>
        <li>x402 is <strong>not native to SxT</strong> — DreamSpace bridges the two protocols. SxT uses ZKpay for its own on-chain payment system.</li>
        <li>The Coinbase facilitator is a centralized component — while payments settle on-chain, verification goes through Coinbase&apos;s servers.</li>
        <li>Mainnet facilitator access requires Coinbase Developer Platform API keys.</li>
        <li>Solana support uses <code>@x402/svm</code> with different payment flows than EVM chains.</li>
      </ul>
    </>
  );
}
