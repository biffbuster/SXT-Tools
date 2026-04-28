export default function ERC8004() {
  return (
    <>
      <h1>ERC-8004 Trustless Agents</h1>
      <p>
        ERC-8004 is an Ethereum standard for AI agent trust infrastructure that <strong>went live on Ethereum mainnet on January 29, 2026</strong>. It defines three on-chain registries — Identity, Reputation, and Validation — that enable trustless agent-to-agent interaction, verifiable reputation, and third-party validation of agent capabilities.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">ERC-8004 is an Independent Standard</div>
        ERC-8004 is not built by Space and Time. It is an independent EIP (requires EIP-155, EIP-712, EIP-721, EIP-1271). DreamSpace integrates with the three registries and bridges ERC-8004 agent identities with SxT data verification and x402 payments. SxT can index ERC-8004 contract events for verifiable agent history queries.
      </div>

      <h2 id="three-registries">The Three Registries</h2>

      <h3 id="identity-registry">1. Identity Registry (ERC-721 Based)</h3>
      <p>
        Every agent is registered as an on-chain NFT with metadata, a wallet address, and a URI pointing to a JSON descriptor file.
      </p>
      <pre><code>{`import { erc8004 } from '@dreamspace/sdk';

// Register an agent on-chain (mints an ERC-721 token)
const agent = await erc8004.register({
  agentURI: 'https://my-agent.api/.well-known/agent.json',
  metadata: [
    { key: 'name', value: 'DeFi Rebalancer' },
    { key: 'version', value: '2.0.0' },
    { key: 'capabilities', value: 'swap,transfer,query' },
  ],
});

console.log(agent.agentId);    // On-chain agent ID (uint256)
console.log(agent.tokenId);    // ERC-721 token ID

// Set the agent's wallet address (requires EIP-712 signature)
await erc8004.setAgentWallet(agent.agentId, '0xAgentWallet...');

// Update agent URI
await erc8004.setAgentURI(agent.agentId, 'https://my-agent.api/v2/.well-known/agent.json');`}</code></pre>

      <h3 id="reputation-registry">2. Reputation Registry</h3>
      <p>
        Any address can submit feedback about an agent. Feedback includes a numeric value, tags for categorization, and optional evidence.
      </p>
      <pre><code>{`// Submit feedback about an agent
await erc8004.giveFeedback({
  agentId: agent.agentId,
  value: 95,                    // Score (int128)
  valueDecimals: 0,
  tag1: 'reliability',          // Category tag
  tag2: 'defi',                 // Subcategory tag
  endpoint: '/swap',            // Which endpoint was used
  feedbackURI: 'ipfs://...',    // Optional detailed feedback
  feedbackHash: '0x...',        // Hash of feedback content
});

// Query an agent's reputation summary
const reputation = await erc8004.getSummary(agent.agentId, {
  clientAddresses: [],          // Filter by specific clients (empty = all)
  tag1: 'reliability',
  tag2: '',                     // Empty = all subcategories
});

console.log(reputation.count);         // Number of feedbacks
console.log(reputation.summaryValue);  // Aggregate score

// Revoke feedback if needed
await erc8004.revokeFeedback(agent.agentId, feedbackIndex);`}</code></pre>

      <h3 id="validation-registry">3. Validation Registry</h3>
      <p>
        Third-party validators can audit agents and publish on-chain validation results. This enables a decentralized auditing ecosystem.
      </p>
      <pre><code>{`// Request validation of an agent
const request = await erc8004.requestValidation({
  validatorAddress: '0xTrustedAuditor...',
  agentId: agent.agentId,
  requestURI: 'ipfs://...',     // What to validate
  requestHash: '0x...',
});

// Validator responds on-chain
// Response values: 0 = pending, 1 = approved, 2 = rejected
await erc8004.respondToValidation({
  requestHash: request.hash,
  response: 1,                   // Approved
  responseURI: 'ipfs://...',     // Detailed audit report
  responseHash: '0x...',
  tag: 'security-audit',
});

// Check validation status
const status = await erc8004.getValidationStatus(request.hash);`}</code></pre>

      <h2 id="agent-descriptor">Agent Descriptor File</h2>
      <p>
        The <code>agentURI</code> resolves to a JSON file describing the agent&apos;s capabilities and endpoints:
      </p>
      <pre><code>{`// https://my-agent.api/.well-known/agent.json
{
  "type": "ai-agent",
  "name": "DeFi Rebalancer",
  "description": "Autonomous portfolio rebalancing agent",
  "image": "https://my-agent.api/avatar.png",
  "services": [
    { "type": "web", "url": "https://my-agent.api" },
    { "type": "a2a", "url": "https://my-agent.api/a2a" }
  ],
  "x402Support": true,           // Agent accepts x402 payments
  "active": true,
  "registrations": [
    { "agentId": "42", "agentRegistry": "0xERC8004Registry..." }
  ],
  "supportedTrust": ["reputation", "crypto-economic"]
}`}</code></pre>

      <h2 id="x402-integration">x402 + ERC-8004 Integration</h2>
      <p>
        ERC-8004 was designed with x402 interoperability in mind — the agent descriptor includes an <code>x402Support</code> field. DreamSpace bridges both standards so agents can discover, pay, and interact with each other trustlessly.
      </p>
      <pre><code>{`// Discover an agent, check its reputation, and call its x402 API
const agentInfo = await erc8004.getAgent(targetAgentId);
const reputation = await erc8004.getSummary(targetAgentId);

if (reputation.summaryValue > 80) {
  // Agent is reputable — call its x402-gated endpoint
  const client = x402.createClient({ wallet: myWallet });
  const result = await client.fetch(agentInfo.services.a2a + '/market-analysis', {
    method: 'POST',
    body: JSON.stringify({ tokens: ['WETH', 'USDC'] }),
  });
}`}</code></pre>

      <h2 id="sxt-indexing">Space and Time Indexing</h2>
      <p>
        SxT can index ERC-8004 contract events, enabling verifiable queries about agent registration, reputation, and validation history. This is a DreamSpace integration — SxT indexes the raw contract events, DreamSpace provides the query abstractions.
      </p>
      <pre><code>{`import { query } from '@dreamspace/sdk';

// Query agent reputation history from indexed ERC-8004 events
const history = await query.sql(\`
  SELECT AGENT_ID, VALUE, TAG1, TAG2, BLOCK_NUMBER
  FROM ETHEREUM.ERC8004_FEEDBACK_EVENTS
  WHERE AGENT_ID = :agentId
  AND BLOCK_NUMBER > 19000000
\`, { agentId: agent.agentId, proof: true });

// Proof of SQL guarantees this history hasn't been tampered with`}</code></pre>

      <div className="docs-callout docs-callout-warning">
        <div className="docs-callout-title">SxT Indexing Note</div>
        SxT must be configured to index the ERC-8004 registry contracts. This requires custom table setup or waiting for SxT to add native ERC-8004 event indexing. Currently, you would need to set up custom indexing via SxT&apos;s Kafka ingestion pipeline to stream ERC-8004 events into queryable tables.
      </div>

      <h2 id="for-users">For Users (Delegating to Agents)</h2>
      <p>
        Users interact with ERC-8004 agents by checking reputation, reviewing validation audits, and optionally delegating on-chain actions. Delegation is handled via standard ERC-721 approval mechanics and smart contract allowlists — not part of the ERC-8004 spec itself.
      </p>
      <pre><code>{`// User checks agent reputation before trusting it
const rep = await erc8004.getSummary(agentId);
const validations = await erc8004.getValidationStatus(agentRequestHash);

// User approves agent to interact with their vault
// (This uses standard contract approval, not ERC-8004)
await contracts.call('UserVault', 'approveAgent', {
  args: [agentWalletAddress, maxAmount, expiry],
});`}</code></pre>

      <h2 id="limitations">Limitations</h2>
      <ul>
        <li>ERC-8004 is <strong>live on Ethereum mainnet</strong> but is still a relatively new standard — adoption is early</li>
        <li>Agent delegation and execution policies are <strong>not part of ERC-8004</strong> — they must be implemented in your own smart contracts</li>
        <li>SxT does not natively index ERC-8004 events — requires custom Kafka ingestion setup or waiting for native support</li>
        <li>The Reputation Registry does not have a built-in Sybil resistance mechanism — reputation scores can be manipulated by creating many addresses</li>
        <li>Cross-chain agent discovery is not supported — each chain has its own registry deployment</li>
      </ul>
    </>
  );
}
