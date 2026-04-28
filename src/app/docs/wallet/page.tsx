export default function Wallet() {
  return (
    <>
      <h1>Wallet</h1>
      <p>
        The Wallet module handles multi-chain wallet creation, key management, HD derivation, and transaction signing. It supports both embedded wallets for dApps and external wallet connections.
      </p>

      <h2 id="overview">Overview</h2>
      <pre><code>{`import { wallet } from '@dreamspace/sdk';

// Create a new HD wallet
const w = await wallet.create({
  type: 'hd',              // 'hd' | 'imported' | 'embedded'
  chains: ['base', 'ethereum', 'polygon'],
});

console.log(w.address);    // 0x7c3f...
console.log(w.mnemonic);   // 12-word recovery phrase (secure this!)`}</code></pre>

      <h2 id="multi-chain">Multi-Chain Support</h2>
      <p>
        A single wallet instance can derive addresses and sign transactions across multiple EVM-compatible chains. Chain switching is seamless.
      </p>
      <pre><code>{`// Get balances across all configured chains
const balances = await wallet.balances(w.address);
// { base: '1.5', ethereum: '0.8', polygon: '24.3' }

// Switch chain context for transactions
await wallet.setChain('base');
const tx = await wallet.send({
  to: '0xRecipient...',
  value: '0.1',  // ETH
});`}</code></pre>

      <h2 id="embedded-wallets">Embedded Wallets</h2>
      <p>
        Create non-custodial embedded wallets for your dApp users. Keys are encrypted client-side and never leave the browser.
      </p>
      <pre><code>{`// Create an embedded wallet for a user session
const embedded = await wallet.createEmbedded({
  userId: 'user_123',
  recoveryMethod: 'email',  // 'email' | 'social' | 'passkey'
});

// Users can sign transactions without managing private keys
const sig = await embedded.signMessage('Hello DreamSpace');`}</code></pre>

      <h2 id="transaction-signing">Transaction Signing</h2>
      <p>
        Sign raw transactions, typed data (EIP-712), and messages with automatic gas estimation and nonce management.
      </p>
      <pre><code>{`// Sign typed data (EIP-712)
const signature = await wallet.signTypedData({
  domain: { name: 'DreamSpace', chainId: 8453 },
  types: { Order: [{ name: 'amount', type: 'uint256' }] },
  value: { amount: 1000 },
});

// Batch transactions
const receipts = await wallet.sendBatch([
  { to: addr1, value: '0.1' },
  { to: addr2, value: '0.2' },
  { to: addr3, data: contractCallData },
]);`}</code></pre>

      <h2 id="security">Security</h2>
      <ul>
        <li>Private keys are never stored in plaintext — always encrypted at rest</li>
        <li>Hardware wallet support via WalletConnect and Ledger</li>
        <li>Transaction simulation before signing to prevent loss of funds</li>
        <li>Spending limits and allowlists for agent wallets</li>
      </ul>
    </>
  );
}
