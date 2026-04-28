export default function VerifiedDataAPI() {
  return (
    <>
      <h1>Verified Data API</h1>
      <p>
        A monetized API that serves ZK-verified blockchain data, gated by x402 micropayments. Buyers pay per-call via Coinbase&apos;s x402 protocol and receive cryptographic proof that the data is authentic — bridging x402 payments with SxT Proof of SQL verification.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">Modules Used</div>
        <span className="docs-example-tag">x402</span>
        <span className="docs-example-tag">Query</span>
        <span className="docs-example-tag">Auth</span>
        <span className="docs-example-tag">Deployment</span>
      </div>

      <h2 id="what-youll-build">What You&apos;ll Build</h2>
      <p>
        A Next.js API server with multiple paid endpoints. Each endpoint queries SxT for blockchain data with Proof of SQL enabled, so every response includes a ZK proof. Access is gated by x402 — callers automatically pay in USDC per request.
      </p>
      <ul>
        <li>Multiple paid endpoints with different price tiers</li>
        <li>Every response includes a verifiable ZK-SNARK proof</li>
        <li>x402 handles payment negotiation automatically via HTTP headers</li>
        <li>Deploy to DreamSpace hosting with one command</li>
      </ul>

      <h2 id="step-1">Step 1 — Set Up the Server</h2>
      <pre><code>{`import { init, auth, query } from '@dreamspace/sdk';
import express from 'express';
import { paymentMiddleware } from '@x402/express';

const app = express();

await init({
  sxtApiKey: process.env.SXT_API_KEY,
  network: 'ethereum',
});

// Authenticate with SxT on server startup
await auth.apiKey({ key: process.env.SXT_API_KEY });`}</code></pre>

      <h2 id="step-2">Step 2 — Add x402 Payment Middleware</h2>
      <p>
        Configure x402 to gate specific endpoints with different prices. The middleware handles 402 responses, payment verification, and settlement automatically through the Coinbase facilitator.
      </p>
      <pre><code>{`// Gate endpoints with x402 micropayments
app.use(paymentMiddleware({
  'GET /api/token-holders': {
    price: '$0.001',
    network: 'base',
    config: {
      description: 'Top token holders with ZK proof',
    },
  },
  'GET /api/whale-transfers': {
    price: '$0.005',
    network: 'base',
    config: {
      description: 'Recent whale transfers (>$1M) with ZK proof',
    },
  },
  'POST /api/custom-query': {
    price: '$0.01',
    network: 'base',
    config: {
      description: 'Custom SQL query with ZK proof',
    },
  },
}));`}</code></pre>

      <h2 id="step-3">Step 3 — Implement Data Endpoints</h2>
      <p>
        Each endpoint queries SxT with <code>proof: true</code> to include a ZK proof in the response. Callers can independently verify this proof on-chain.
      </p>
      <pre><code>{`// Token holders endpoint — $0.001 per call
app.get('/api/token-holders', async (req, res) => {
  const { token } = req.query;

  const result = await query.sql(\`
    SELECT WALLET_ADDRESS, BALANCE
    FROM ETHEREUM.TOKEN_ERC20_WALLET_BALANCES
    WHERE CONTRACT_ADDRESS = :token
    AND BALANCE > 0
    ORDER BY BALANCE DESC
    LIMIT 100
  \`, { token, proof: true });

  res.json({
    data: result.rows,
    proof: result.proof,
    proofHash: result.proofHash,
    verifyAt: 'https://etherscan.io/address/0xSxTVerifier',
  });
});

// Whale transfers endpoint — $0.005 per call
app.get('/api/whale-transfers', async (req, res) => {
  const result = await query.sql(\`
    SELECT TX_HASH, FROM_ADDRESS, TO_ADDRESS, VALUE, BLOCK_NUMBER
    FROM ETHEREUM.TOKEN_TRANSFERS
    WHERE VALUE > 1000000000000  -- > $1M in wei equivalent
    AND BLOCK_NUMBER > (SELECT MAX(BLOCK_NUMBER) - 1000 FROM ETHEREUM.BLOCKS)
    ORDER BY BLOCK_NUMBER DESC
    LIMIT 50
  \`, { proof: true });

  res.json({
    data: result.rows,
    proof: result.proof,
    proofHash: result.proofHash,
  });
});

// Custom query endpoint — $0.01 per call
app.post('/api/custom-query', async (req, res) => {
  const { sql, params } = req.body;

  // Only allow SELECT queries for Proof of SQL
  if (!sql.trim().toUpperCase().startsWith('SELECT')) {
    return res.status(400).json({ error: 'Only SELECT queries are supported' });
  }

  const result = await query.sql(sql, { ...params, proof: true });

  res.json({
    data: result.rows,
    proof: result.proof,
    proofHash: result.proofHash,
  });
});`}</code></pre>

      <h2 id="step-4">Step 4 — Client-Side Usage</h2>
      <p>
        Clients use <code>@x402/fetch</code> (or the DreamSpace wrapper) to automatically handle 402 payment flows. The client wallet pays in USDC on Base.
      </p>
      <pre><code>{`import { x402 } from '@dreamspace/sdk';

// Create an x402 client with auto-pay
const client = x402.createClient({
  wallet: myWallet,
  maxAutoPayment: '0.05',
  network: 'base',
});

// Fetch paid endpoint — payment happens automatically
const response = await client.fetch(
  'https://my-verified-api.dreamspace.app/api/token-holders?token=0xA0b8...'
);

// Response includes data + proof
console.log(response.data);        // Token holder rows
console.log(response.proof);       // ZK-SNARK proof
console.log(response.payment);     // { txHash, amount: '0.001', token: 'USDC' }`}</code></pre>

      <h2 id="step-5">Step 5 — Deploy</h2>
      <pre><code>{`import { deployment } from '@dreamspace/sdk';

await deployment.deploy({
  name: 'verified-data-api',
  framework: 'express',
  env: {
    SXT_API_KEY: process.env.SXT_API_KEY,
  },
});

// Deployed to: https://verified-data-api.dreamspace.app`}</code></pre>

      <h2 id="limitations">Limitations &amp; Honest Notes</h2>
      <ul>
        <li><strong>x402 mainnet requires Coinbase keys</strong> — The mainnet facilitator at <code>api.cdp.coinbase.com</code> requires Coinbase Developer Platform API keys. Testnet facilitator at <code>x402.org/facilitator</code> works without keys.</li>
        <li><strong>SxT does not natively support x402</strong> — DreamSpace bridges the two protocols. SxT uses its own ZKpay system for on-chain query payments.</li>
        <li><strong>Settlement has gas costs</strong> — x402 payments settle on-chain (Base network). For very small micropayments (&lt;$0.001), gas may exceed the payment amount. The Coinbase facilitator batches to reduce this.</li>
        <li><strong>Only SELECT queries produce proofs</strong> — INSERT, UPDATE, and DELETE operations cannot generate Proof of SQL proofs.</li>
        <li><strong>1,000 free monthly transactions</strong> — The Coinbase facilitator provides 1,000 free verifications per month. After that, $0.001 per transaction.</li>
      </ul>
    </>
  );
}
