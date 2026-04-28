import Link from "next/link";

export default function DocsOverview() {
  return (
    <>
      <h1>
        DreamSpace SDK
      </h1>
      <p className="docs-subtitle">
        A TypeScript SDK that wraps the Space and Time data layer with smart contract tooling, wallet management, and deployment infrastructure for onchain development.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">What DreamSpace SDK Wraps</div>
        Under the hood, DreamSpace uses <code>sxt-nodejs-sdk</code> for verifiable SQL queries with Proof of SQL, adds EVM smart contract deployment via OpenZeppelin templates, integrates Coinbase&apos;s x402 for micropayments, and connects to ERC-8004 for on-chain agent identity. DreamSpace is the glue layer — SxT is the data engine.
      </div>

      {/* Install */}
      <pre>
        <code>$ npm install @dreamspace/sdk</code>
      </pre>

      {/* Quick Nav */}
      <div className="docs-quicknav-grid">
        <Link href="/docs/quick-start" className="docs-quicknav-card">
          <div className="docs-quicknav-card-title">Quick Start</div>
          <div className="docs-quicknav-card-desc">
            Get up and running in 5 minutes with SxT authentication and your first verified query.
          </div>
        </Link>
        <Link href="/docs/query" className="docs-quicknav-card">
          <div className="docs-quicknav-card-title">Core Modules</div>
          <div className="docs-quicknav-card-desc">
            7 modules — Auth &amp; Identity, Wallet, Query, Contracts, Networks, Components, Deployment &amp; Storage.
          </div>
        </Link>
        <Link href="/docs/x402" className="docs-quicknav-card">
          <div className="docs-quicknav-card-title">Advanced Features</div>
          <div className="docs-quicknav-card-desc">
            x402 micropayments, ERC-8004 agent identity, Space and Time deep dive, and marketplace tooling.
          </div>
        </Link>
        <Link href="/docs/space-and-time" className="docs-quicknav-card">
          <div className="docs-quicknav-card-title">Space and Time</div>
          <div className="docs-quicknav-card-desc">
            Deep dive into Proof of SQL, indexed chains, on-chain verification, and real capabilities vs. limitations.
          </div>
        </Link>
      </div>

      <h2 id="what-is-dreamspace">What is DreamSpace SDK?</h2>
      <p>
        <em>
          &ldquo;DreamSpace SDK is a TypeScript wrapper around the Space and Time decentralized data warehouse that adds smart contract deployment, wallet management, UI components, and a unified developer experience. SxT provides the verifiable data engine — DreamSpace makes it developer-friendly.&rdquo;
        </em>
      </p>
      <ul>
        <li>
          <strong>SxT data layer wrapper</strong> — Abstracts ED25519 authentication, biscuit token management, and raw SQL into simple <code>query.sql()</code> calls with automatic token refresh and TypeScript types.
        </li>
        <li>
          <strong>Proof of SQL verification</strong> — Every SELECT query can include a ZK-SNARK proof that the data is untampered and the computation is correct. Verifiable on-chain via deployed contracts on Ethereum.
        </li>
        <li>
          <strong>Smart contract tooling</strong> — Deploy ERC-20, ERC-721, ERC-1155, and custom Solidity contracts to any EVM chain. Built on OpenZeppelin templates.
        </li>
        <li>
          <strong>Agent infrastructure</strong> — Integrates x402 (Coinbase) for micropayment-gated APIs and ERC-8004 for on-chain agent identity, reputation, and validation.
        </li>
      </ul>

      <h2 id="core-modules">Core Modules</h2>
      <div className="docs-module-grid">
        <Link href="/docs/auth" className="docs-module-card">
          <div className="docs-module-card-icon">🔐</div>
          <div className="docs-module-card-title">Auth &amp; Identity</div>
          <div className="docs-module-card-desc">
            SxT ED25519 auth, SIWE sign-in, biscuit tokens, DID abstractions, ENS resolution, RBAC, and agent identity.
          </div>
        </Link>
        <Link href="/docs/wallet" className="docs-module-card">
          <div className="docs-module-card-icon">👛</div>
          <div className="docs-module-card-title">Wallet</div>
          <div className="docs-module-card-desc">
            Multi-chain wallet creation, HD derivation, embedded wallets, and transaction signing.
          </div>
        </Link>
        <Link href="/docs/query" className="docs-module-card">
          <div className="docs-module-card-icon">🔍</div>
          <div className="docs-module-card-title">Query</div>
          <div className="docs-module-card-desc">
            SQL queries against SxT-indexed blockchain data with Proof of SQL ZK proofs.
          </div>
        </Link>
        <Link href="/docs/contracts" className="docs-module-card">
          <div className="docs-module-card-icon">📜</div>
          <div className="docs-module-card-title">Contracts</div>
          <div className="docs-module-card-desc">
            Deploy and interact with smart contracts on any EVM chain. OpenZeppelin templates included.
          </div>
        </Link>
        <Link href="/docs/networks" className="docs-module-card">
          <div className="docs-module-card-icon">🌐</div>
          <div className="docs-module-card-title">Networks</div>
          <div className="docs-module-card-desc">
            Multi-chain config with separate SxT data and contract deployment chain support.
          </div>
        </Link>
        <Link href="/docs/components" className="docs-module-card">
          <div className="docs-module-card-icon">🧩</div>
          <div className="docs-module-card-title">Components</div>
          <div className="docs-module-card-desc">
            Pre-built React components for wallet connect, NFT galleries, and token displays.
          </div>
        </Link>
        <Link href="/docs/deployment" className="docs-module-card">
          <div className="docs-module-card-icon">🚀</div>
          <div className="docs-module-card-title">Deployment &amp; Storage</div>
          <div className="docs-module-card-desc">
            One-command deploy, IPFS pinning, Arweave permanent storage, NFT metadata, and edge CDN.
          </div>
        </Link>
      </div>

      <h2 id="advanced-features">Advanced Features</h2>
      <div className="docs-module-grid">
        <Link href="/docs/x402" className="docs-module-card">
          <div className="docs-module-card-icon">💳</div>
          <div className="docs-module-card-title">x402 Payment Protocol</div>
          <div className="docs-module-card-desc">
            Coinbase&apos;s HTTP-native micropayments. DreamSpace bridges x402 with SxT verified data APIs.
          </div>
        </Link>
        <Link href="/docs/erc-8004" className="docs-module-card">
          <div className="docs-module-card-icon">🤖</div>
          <div className="docs-module-card-title">ERC-8004 Trustless Agents</div>
          <div className="docs-module-card-desc">
            On-chain agent identity, reputation, and validation registries. Live on Ethereum mainnet.
          </div>
        </Link>
        <Link href="/docs/space-and-time" className="docs-module-card">
          <div className="docs-module-card-icon">⏱️</div>
          <div className="docs-module-card-title">Space and Time</div>
          <div className="docs-module-card-desc">
            Deep dive into Proof of SQL, indexed chains, on-chain verification, and honest limitations.
          </div>
        </Link>
        <Link href="/docs/marketplace" className="docs-module-card">
          <div className="docs-module-card-icon">🏪</div>
          <div className="docs-module-card-title">Marketplace</div>
          <div className="docs-module-card-desc">
            NFT marketplaces and auction systems with built-in escrow and SxT analytics.
          </div>
        </Link>
      </div>
    </>
  );
}
