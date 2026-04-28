import Link from "next/link";

export default function Examples() {
  return (
    <>
      <h1>Examples</h1>
      <p>
        End-to-end project walkthroughs that show how multiple DreamSpace SDK modules compose together into real applications. Each example includes a full init-to-deploy workflow with working code.
      </p>

      <div className="docs-module-grid">
        <Link href="/docs/examples/zk-search-engine" className="docs-module-card">
          <div className="docs-module-card-icon">🔎</div>
          <div className="docs-module-card-title">ZK Search Engine</div>
          <div className="docs-module-card-desc">
            A blockchain data search interface where every result is cryptographically provable via SxT Proof of SQL.
          </div>
          <div style={{ marginTop: 10 }}>
            <span className="docs-example-tag">Query</span>
            <span className="docs-example-tag">Auth</span>
            <span className="docs-example-tag">Components</span>
            <span className="docs-example-tag">Deployment</span>
          </div>
        </Link>
        <Link href="/docs/examples/onchain-yield-agent" className="docs-module-card">
          <div className="docs-module-card-icon">🤖</div>
          <div className="docs-module-card-title">Onchain Yield Agent</div>
          <div className="docs-module-card-desc">
            An autonomous AI agent that monitors DeFi yield opportunities using verified data and executes rebalancing strategies.
          </div>
          <div style={{ marginTop: 10 }}>
            <span className="docs-example-tag">Auth &amp; Identity</span>
            <span className="docs-example-tag">ERC-8004</span>
            <span className="docs-example-tag">Query</span>
            <span className="docs-example-tag">Contracts</span>
          </div>
        </Link>
        <Link href="/docs/examples/verified-data-api" className="docs-module-card">
          <div className="docs-module-card-icon">💳</div>
          <div className="docs-module-card-title">Verified Data API</div>
          <div className="docs-module-card-desc">
            A monetized API that serves ZK-verified blockchain data, gated by x402 micropayments.
          </div>
          <div style={{ marginTop: 10 }}>
            <span className="docs-example-tag">x402</span>
            <span className="docs-example-tag">Query</span>
            <span className="docs-example-tag">Auth</span>
            <span className="docs-example-tag">Deployment</span>
          </div>
        </Link>
        <Link href="/docs/examples/agent-marketplace" className="docs-module-card">
          <div className="docs-module-card-icon">🏪</div>
          <div className="docs-module-card-title">Agent Marketplace</div>
          <div className="docs-module-card-desc">
            A marketplace where AI agents register, build reputation, and sell services to each other using x402 and ERC-8004.
          </div>
          <div style={{ marginTop: 10 }}>
            <span className="docs-example-tag">ERC-8004</span>
            <span className="docs-example-tag">x402</span>
            <span className="docs-example-tag">Marketplace</span>
            <span className="docs-example-tag">Auth &amp; Identity</span>
          </div>
        </Link>
      </div>
    </>
  );
}
