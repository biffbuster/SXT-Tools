"use client";

import { useState, useEffect, useRef } from "react";

// Code snippet data
const codeSnippets = {
  query: `import { DreamSpaceSDK } from '@dreamspace/sdk'

const sdk = new DreamSpaceSDK(process.env.SXT_API_KEY)

// Query ERC20 transfers on Base — no SQL needed
const transfers = await sdk.queries.erc20.getTransfers({
  chain: 'base',
  tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  fromBlock: 19000000,
  limit: 100
})

// Query NFT activity across chains
const nftActivity = await sdk.queries.erc721.getActivity({
  chain: 'ethereum',
  collection: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
  timeframe: '30d'
})

console.log(\`Found \${transfers.length} transfers\`)`,

  deploy: `// Deploy an NFT collection to Base
const nft = await sdk.contracts.deployNFT({
  name: 'CosmicCollectibles',
  symbol: 'COSM',
  maxSupply: 10_000,
  network: 'base',
  mintPrice: '0.01'
})

console.log(\`✓ Deployed at: \${nft.address}\`)
console.log(\`✓ Verified on BaseScan\`)

// Deploy an ERC20 token
const token = await sdk.contracts.deployToken({
  name: 'DreamToken',
  symbol: 'DREAM',
  initialSupply: 1_000_000,
  network: 'base'
})`,

  ui: `// Create a full analytics dashboard
const dashboard = await sdk.ui.createDashboard({
  title: 'DeFi Analytics',
  dataSource: transfers,
  visualizations: ['line', 'bar', 'table'],
  theme: 'dreamspace-dark',
  features: {
    walletConnect: true,
    realTimeUpdates: true,
    exportCSV: true
  }
})

// Or use individual components
const table = sdk.ui.DataTable({ data: transfers })
const chart = sdk.ui.LineChart({
  data: transfers,
  xKey: 'date',
  yKey: 'value'
})`,

  ship: `// Bundle everything for DreamSpace deployment
await sdk.deployment.bundle({
  contracts: ['./contracts/*.sol'],
  frontend: './dist',
  target: 'dreamspace',
  auditFirst: true,
  network: 'base',
  metadata: {
    name: 'My DeFi Dashboard',
    description: 'Built with DreamSpace SDK + Claude Code'
  }
})

// Or deploy directly
await sdk.deployment.toDreamSpace({
  projectPath: './dist',
  auditFirst: true,
  network: 'base'
})

console.log('✓ Live on dream.space!')`,
};

// Comparison table data
const comparisonData = [
  { feature: "Blockchain Queries", sxt: "Raw SQL required", dreamspace: "Pre-built query functions" },
  { feature: "Smart Contracts", sxt: "Not included", dreamspace: "Templates + one-click deployer" },
  { feature: "UI Components", sxt: "Not included", dreamspace: "React component library" },
  { feature: "Chain Configuration", sxt: "Manual setup per chain", dreamspace: "One-line multi-chain config" },
  { feature: "Code Volume", sxt: "50+ lines per query", dreamspace: "1 function call" },
  { feature: "Learning Curve", sxt: "High (SQL + API docs)", dreamspace: "Low (simple TypeScript methods)" },
  { feature: "AI Compatibility", sxt: "Verbose, complex prompts", dreamspace: "Clean code, AI-optimized API" },
  { feature: "DreamSpace Deploy", sxt: "No integration", dreamspace: "Export bundles ready to ship" },
];

// Features data
const features = [
  {
    icon: "📊",
    title: "Simplified Data Access",
    description: "Pre-built query templates for ERC20, ERC721, and DeFi protocols. Access 100TB+ of indexed blockchain data without writing SQL.",
  },
  {
    icon: "🔐",
    title: "Smart Contract Templates",
    description: "OpenZeppelin-based contract generation. Deploy NFTs, tokens, and DAOs to any EVM chain with a single command.",
  },
  {
    icon: "⛓️",
    title: "Multi-Chain Support",
    description: "Pre-configured for Base, Ethereum, Polygon, and Avalanche. Switch chains with one line of code.",
  },
  {
    icon: "🎨",
    title: "React UI Components",
    description: "Production-ready glassmorphic dashboards, data tables, charts, and wallet connectors themed to DreamSpace.",
  },
  {
    icon: "🤖",
    title: "AI-Optimized API",
    description: "Designed for Claude Code CLI, Cursor, and Copilot. Cleaner prompts, simpler outputs, 10x faster AI-assisted development.",
  },
  {
    icon: "🚀",
    title: "DreamSpace Deployment",
    description: "Bundle and export projects directly to DreamSpace's audited infrastructure on Base. One command from code to production.",
  },
];

// Benefits data
const developerBenefits = [
  "10x faster development with pre-built templates",
  "Professional tooling — Claude Code CLI, VS Code, Git",
  "Full TypeScript type safety and autocomplete",
  "AI-optimized API design for next-gen workflows",
  "Multi-chain deploy to Base, Ethereum, Polygon, Avalanche",
  "No vendor lock-in — works standalone or with DreamSpace",
];

const dreamspaceBenefits = [
  "Higher quality code from professional IDE development",
  "Advanced features beyond no-code limits",
  "Faster iteration with local testing before deployment",
  "Sophisticated UI/UX with the React component library",
  "Integrated security auditing via MythX and Certora",
  "Bi-directional workflow — build in CLI, deploy in DreamSpace",
];

// Pink Cloud Component
function PinkCloud({ className, style }: { className: string; style?: React.CSSProperties }) {
  return <div className={`pink-cloud ${className}`} style={style} />;
}

// Code Block with Syntax Highlighting
function CodeBlock({ code, showLineNumbers = true, glow = false }: { code: string; showLineNumbers?: boolean; glow?: boolean }) {
  const highlightSyntax = (line: string) => {
    // Simple syntax highlighting
    return line
      .replace(/(\/\/.*$)/gm, '<span class="code-comment">$1</span>')
      .replace(/('.*?'|".*?"|`.*?`)/g, '<span class="code-string">$1</span>')
      .replace(/\b(import|from|const|let|var|await|async|return|if|else|for|while|function|export|default)\b/g, '<span class="code-keyword">$1</span>')
      .replace(/\b(true|false|null|undefined)\b/g, '<span class="code-keyword">$1</span>')
      .replace(/\b(\d+(_\d+)?)\b/g, '<span class="code-number">$1</span>')
      .replace(/\b(sdk|DreamSpaceSDK|process|console|env)\b/g, '<span class="code-type">$1</span>')
      .replace(/\.([\w]+)\s*\(/g, '.<span class="code-function">$1</span>(')
      .replace(/(\{|\}|\[|\]|\(|\)|;|,|:)/g, '<span class="code-punctuation">$1</span>');
  };

  const lines = code.split("\n");

  return (
    <div className={`code-block ${glow ? "glow" : ""} p-5 overflow-x-auto`}>
      <pre className="m-0">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            {showLineNumbers && <span className="line-number select-none">{i + 1}</span>}
            <code dangerouslySetInnerHTML={{ __html: highlightSyntax(line) || "&nbsp;" }} />
          </div>
        ))}
      </pre>
    </div>
  );
}

// IDE-style Code Window
function CodeWindow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card-strong overflow-hidden">
      {/* Window Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[rgba(63,63,70,0.5)] bg-[rgba(24,24,27,0.9)]">
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
          <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
          <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
        </div>
        <span className="font-mono text-sm text-[var(--muted-grey)]">{title}</span>
      </div>
      {children}
    </div>
  );
}

// Section wrapper with scroll animation
function Section({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const elements = entry.target.querySelectorAll(".animate-on-scroll");
            elements.forEach((el) => el.classList.add("visible"));
          }
        });
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section id={id} ref={ref} className={`relative py-32 md:py-44 ${className}`}>
      {children}
    </section>
  );
}

// Main Page Component
export default function Home() {
  const [activeTab, setActiveTab] = useState<"query" | "deploy" | "ui" | "ship">("query");
  const [showToast, setShowToast] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  // Handle scroll for navbar
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Copy to clipboard
  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[var(--dark-bg)] text-[var(--off-white)] overflow-hidden">
      {/* Toast Notification */}
      <div className={`toast ${showToast ? "show" : ""}`}>Copied to clipboard!</div>

      {/* ============================================
          SECTION 1: HERO (Cloud Card Container)
          ============================================ */}
      <section className="relative min-h-screen p-3 md:p-5">
        <div className="cloud-card w-full min-h-[calc(100vh-24px)] md:min-h-[calc(100vh-40px)] flex flex-col relative">
          <div className="cloud-card-overlay" />

          {/* Navigation — inside the card */}
          <nav className="cloud-card-content relative z-20 w-full px-6 py-4 flex items-center justify-between">
            <a href="#" className="flex items-center">
              <img src="/dreamspace-logo.png" alt="DreamSpace SDK" className="h-8" />
            </a>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-[var(--muted-grey)] hover:text-[var(--off-white)] transition-colors">
                Features
              </a>
              <a href="#code" className="text-[var(--muted-grey)] hover:text-[var(--off-white)] transition-colors">
                Code
              </a>
              <a href="#get-started" className="text-[var(--muted-grey)] hover:text-[var(--off-white)] transition-colors">
                Get Started
              </a>
            </div>
            <a href="/docs" className="text-sm py-2 px-5 font-semibold font-['Space_Grotesk'] rounded-lg text-white transition-all duration-300 hover:shadow-[0_0_20px_rgba(236,72,153,0.4)] hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg, var(--hot-pink), var(--neon-magenta), var(--electric-purple))' }}>
              Docs
            </a>
          </nav>

          {/* Hero Content */}
          <div className="cloud-card-content relative z-10 flex-1 flex items-center justify-center pt-16 md:pt-24">
            <div className="max-w-5xl mx-auto px-6 text-center">
              <h1 className="font-['Space_Grotesk'] text-5xl md:text-7xl font-bold mb-6 leading-tight">
                One powerful SDK for{" "}
                <span className="gradient-text">onchain development</span>
              </h1>
              <p className="text-xl md:text-2xl text-[var(--muted-grey)] max-w-3xl mx-auto mb-10 leading-relaxed">
                Build production-grade Web3 apps with TypeScript. Query blockchain data, deploy smart contracts, and ship to DreamSpace — all from your terminal.
              </p>

              {/* Install Command */}
              <div
                onClick={() => copyToClipboard("npm install @dreamspace/sdk")}
                className="inline-block mb-8 cursor-pointer group"
              >
                <div className="code-block glow px-8 py-4 font-mono text-lg transition-transform group-hover:scale-105">
                  <span className="text-[var(--muted-grey)]">$</span>{" "}
                  <span className="text-[var(--ocean-cyan)]">npm install</span>{" "}
                  <span className="text-[var(--hot-pink)]">@dreamspace/sdk</span>
                  <span className="ml-4 text-[var(--muted-grey)] opacity-0 group-hover:opacity-100 transition-opacity text-sm">
                    Click to copy
                  </span>
                </div>
              </div>

              {/* CTA Buttons */}
              <div className="flex flex-wrap justify-center gap-4 mb-12">
                <a href="#get-started" className="btn-primary">
                  <span>Get Started</span>
                </a>
                <a href="/docs" className="btn-outline">
                  Read Docs
                </a>
                <a href="/docs" className="btn-outline">
                  Documentation
                </a>
              </div>

              {/* Powered By */}
              <div className="text-sm text-[var(--muted-grey)]">
                <span className="opacity-60">Powered by</span>{" "}
                <span className="text-[var(--off-white)]">DreamSpace</span>
                <span className="mx-2 opacity-40">·</span>
                <span className="text-[var(--off-white)]">Space and Time</span>
                <span className="mx-2 opacity-40">·</span>
                <span className="text-[var(--off-white)]">Microsoft Azure</span>
                <span className="mx-2 opacity-40">·</span>
                <span className="text-[var(--off-white)]">Base</span>
              </div>
            </div>
          </div>

          {/* Scroll indicator */}
          <div className="cloud-card-content relative z-10 pb-8 flex justify-center animate-bounce">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--muted-grey)]">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
        </div>
      </section>

      {/* ============================================
          SECTION 2: DESCRIPTION
          ============================================ */}
      <Section>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p className="animate-on-scroll text-xl md:text-2xl text-[var(--light-grey)] leading-relaxed mb-8">
            DreamSpace SDK is a TypeScript toolkit that bridges professional local development with DreamSpace&apos;s no-code AI app builder. It wraps the Space and Time data layer with pre-built queries, smart contract templates, React UI components, and one-click deployment to Base.
          </p>
          <p className="animate-on-scroll stagger-1 text-lg text-[var(--muted-grey)] leading-relaxed">
            Whether you&apos;re building with Claude Code CLI, VS Code, or Cursor — the SDK gives you production-grade Web3 tooling with an API designed for AI-assisted development.
          </p>
        </div>
      </Section>

      {/* ============================================
          SECTION 3: PROBLEM → SOLUTION
          ============================================ */}
      <Section id="comparison">
        {/* Pink Cloud */}
        <PinkCloud className="pink-cloud-4" style={{ top: "-20%", right: "-20%" }} />

        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="animate-on-scroll font-['Space_Grotesk'] text-4xl md:text-5xl font-bold mb-4">
              From <span className="gradient-text">150 Lines to 15</span>
            </h2>
            <p className="animate-on-scroll stagger-1 text-xl text-[var(--muted-grey)] max-w-2xl mx-auto">
              Stop wrestling with raw SQL and configuration boilerplate. Write clean, type-safe code that just works.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Without SDK */}
            <div className="animate-on-scroll stagger-2">
              <div className="mb-4 flex items-center gap-2">
                <span className="text-red-400">✗</span>
                <span className="font-['Space_Grotesk'] font-semibold text-[var(--muted-grey)]">Without DreamSpace SDK</span>
              </div>
              <CodeWindow title="old-way.ts">
                <div className="opacity-70">
                  <CodeBlock
                    code={`// Manual SxT authentication + raw SQL
import { SxTClient } from 'spaceandtime-sdk'
import { ethers } from 'ethers'

const client = new SxTClient()
await client.authenticate(apiKey, secret)

const result = await client.executeQuery(\`
  SELECT contract_address, token_id,
         value, from_address, to_address
  FROM BASE.ERC721_EVT_TRANSFER
  WHERE block_timestamp >
    CURRENT_DATE - INTERVAL '7 days'
  ORDER BY block_timestamp DESC
  LIMIT 100
\`)

const provider = new ethers.JsonRpcProvider(
  'https://mainnet.base.org'
)
const wallet = new ethers.Wallet(privateKey, provider)
// ... 130+ more lines of boilerplate`}
                  />
                </div>
              </CodeWindow>
            </div>

            {/* With SDK */}
            <div className="animate-on-scroll stagger-3">
              <div className="mb-4 flex items-center gap-2">
                <span className="text-[var(--hot-pink)]">✓</span>
                <span className="font-['Space_Grotesk'] font-semibold text-[var(--hot-pink)]">With DreamSpace SDK</span>
              </div>
              <CodeWindow title="dreamspace-way.ts">
                <CodeBlock
                  code={`import { DreamSpaceSDK } from '@dreamspace/sdk'

const sdk = new DreamSpaceSDK(process.env.SXT_API_KEY)

const nftData = await sdk.nft.getRecentTransfers({
  chain: 'base',
  timeframe: 'week'
})

const dashboard = await sdk.ui.createDashboard({
  data: nftData,
  theme: 'glassmorphic-dark'
})

await sdk.deployment.exportBundle('./nft-dashboard')`}
                  glow
                />
              </CodeWindow>
            </div>
          </div>

        </div>
      </Section>

      {/* ============================================
          SECTION 3: COMPARISON TABLE
          ============================================ */}
      <Section>
        <PinkCloud className="pink-cloud-5" style={{ top: "30%", left: "-10%" }} />

        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="animate-on-scroll font-['Space_Grotesk'] text-4xl md:text-5xl font-bold mb-4">
              Built on Space and Time.{" "}
              <span className="gradient-text">Supercharged for Builders.</span>
            </h2>
            <p className="animate-on-scroll stagger-1 text-xl text-[var(--muted-grey)] max-w-3xl mx-auto">
              The DreamSpace SDK wraps the SxT SDK with smart contract templates, chain configurations, UI components, and deployment tools — everything the raw SDK is missing.
            </p>
          </div>

          <div className="animate-on-scroll stagger-2 glass-card-strong overflow-hidden">
            <table className="comparison-table">
              <thead>
                <tr className="bg-[rgba(63,63,70,0.3)]">
                  <th>Feature</th>
                  <th>SxT SDK (Current)</th>
                  <th>DreamSpace SDK (New)</th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((row, i) => (
                  <tr key={i} className="hover:bg-[rgba(236,72,153,0.05)] transition-colors">
                    <td className="font-['Space_Grotesk'] font-medium">{row.feature}</td>
                    <td>
                      <span className="text-red-400 mr-2">✗</span>
                      {row.sxt}
                    </td>
                    <td>
                      <span className="text-[var(--ocean-cyan)] mr-2">✓</span>
                      {row.dreamspace}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* ============================================
          SECTION 4: FEATURES GRID
          ============================================ */}
      {/* ============================================
          SECTION 5: INTERACTIVE CODE SHOWCASE
          ============================================ */}
      <Section id="code">
        <PinkCloud className="pink-cloud-2" style={{ top: "0%", left: "-15%" }} />
        <PinkCloud className="pink-cloud-3" style={{ bottom: "-10%", right: "-20%" }} />

        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="animate-on-scroll font-['Space_Grotesk'] text-4xl md:text-5xl font-bold mb-4">
              Ship Your Dream App{" "}
              <span className="gradient-text">in Minutes</span>
            </h2>
          </div>

          <div className="animate-on-scroll stagger-1">
            <CodeWindow title="sdk-examples.ts">
              {/* Tabs */}
              <div className="flex border-b border-[rgba(63,63,70,0.5)] bg-[rgba(24,24,27,0.6)] overflow-x-auto">
                {[
                  { key: "query", label: "Query Data" },
                  { key: "deploy", label: "Deploy Contracts" },
                  { key: "ui", label: "Build UI" },
                  { key: "ship", label: "Ship to DreamSpace" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as typeof activeTab)}
                    className={`code-tab whitespace-nowrap ${activeTab === tab.key ? "active" : ""}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Code Content */}
              <CodeBlock code={codeSnippets[activeTab]} glow />
            </CodeWindow>
          </div>
        </div>
      </Section>

      {/* ============================================
          SECTION 6: REAL-WORLD EXAMPLE
          ============================================ */}
      <Section>
        <PinkCloud className="pink-cloud-4" style={{ top: "20%", left: "50%", transform: "translateX(-50%)" }} />

        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="animate-on-scroll font-['Space_Grotesk'] text-4xl md:text-5xl font-bold mb-4">
              NFT Marketplace —{" "}
              <span className="gradient-text">Built in 15 Lines</span>
            </h2>
          </div>

          <div className="animate-on-scroll stagger-1 grid lg:grid-cols-2 gap-8 items-center">
            {/* Code Side */}
            <div>
              <CodeWindow title="nft-marketplace.ts">
                <CodeBlock
                  code={`import { DreamSpaceSDK } from '@dreamspace/sdk'

const sdk = new DreamSpaceSDK(process.env.SXT_API_KEY)

// 1. Get NFT collection data
const collection = await sdk.nft.getCollection({
  chain: 'base',
  address: '0x...',
  includeMetadata: true
})

// 2. Deploy marketplace contract
const marketplace = await sdk.contracts.deployMarketplace({
  name: 'Celestial Beings',
  fee: 2.5, // 2.5% platform fee
  network: 'base'
})

// 3. Create the UI
const app = await sdk.ui.createMarketplace({
  collection,
  marketplace,
  theme: 'dreamspace-dark'
})

// 4. Ship it!
await sdk.deployment.toDreamSpace({
  app,
  auditFirst: true
})`}
                  glow
                />
              </CodeWindow>
            </div>

            {/* Preview Side */}
            <div className="glass-card-strong p-8">
              <div className="text-center mb-6">
                <h3 className="font-['Space_Grotesk'] font-bold text-2xl gradient-text mb-2">Celestial Beings</h3>
                <p className="text-[var(--muted-grey)]">Live on DreamSpace</p>
              </div>

              {/* Mockup NFT Cards */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { name: "Aurora Spirit", price: "0.08", colors: ["#FF6B6B", "#4ECDC4", "#45B7D1"], rotation: 135 },
                  { name: "Void Walker", price: "0.12", colors: ["#2D1B69", "#11998E", "#38EF7D"], rotation: 45 },
                  { name: "Neon Phoenix", price: "0.15", colors: ["#F093FB", "#F5576C", "#FFD93D"], rotation: 180 },
                  { name: "Crystal Sage", price: "0.09", colors: ["#667EEA", "#764BA2", "#F472B6"], rotation: 90 },
                ].map((nft, i) => (
                  <div key={i} className="glass-card p-3 group hover:scale-105 transition-transform">
                    <div
                      className="aspect-square rounded-lg mb-3 relative overflow-hidden"
                      style={{
                        background: `linear-gradient(${nft.rotation}deg, ${nft.colors.join(", ")})`,
                      }}
                    >
                      {/* Abstract shape overlay */}
                      <div
                        className="absolute inset-0 opacity-30"
                        style={{
                          background: `radial-gradient(circle at ${30 + i * 15}% ${40 + i * 10}%, rgba(255,255,255,0.4) 0%, transparent 50%)`,
                        }}
                      />
                      <div
                        className="absolute w-20 h-20 rounded-full opacity-20"
                        style={{
                          background: nft.colors[0],
                          top: `${20 + i * 10}%`,
                          left: `${10 + i * 15}%`,
                          filter: "blur(10px)",
                        }}
                      />
                    </div>
                    <div className="font-['Space_Grotesk'] font-medium text-sm text-[var(--off-white)]">{nft.name}</div>
                    <div className="text-[var(--soft-pink)] text-sm font-mono">{nft.price} ETH</div>
                  </div>
                ))}
              </div>

              {/* Arrow indicator */}
              <div className="hidden lg:flex absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 items-center gap-2 text-[var(--muted-grey)]">
                <span className="text-sm">SDK powers this</span>
                <span className="text-2xl">→</span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================
          SECTION 9: DEVELOPER vs DREAMSPACE BENEFITS
          ============================================ */}
      <Section>
        <PinkCloud className="pink-cloud-3" style={{ top: "-10%", left: "30%" }} />

        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="animate-on-scroll font-['Space_Grotesk'] text-4xl md:text-5xl font-bold mb-4">
              Why <span className="gradient-text">DreamSpace SDK</span>?
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* For Developers */}
            <div className="animate-on-scroll stagger-1 glass-card-strong p-8">
              <h3 className="font-['Space_Grotesk'] font-bold text-2xl mb-6 gradient-text">For Developers</h3>
              <ul className="space-y-4">
                {developerBenefits.map((benefit, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="text-[var(--ocean-cyan)] mt-1">✓</span>
                    <span className="text-[var(--off-white)]">{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* For DreamSpace Projects */}
            <div className="animate-on-scroll stagger-2 glass-card-strong p-8">
              <h3 className="font-['Space_Grotesk'] font-bold text-2xl mb-6 gradient-text-alt">For DreamSpace Projects</h3>
              <ul className="space-y-4">
                {dreamspaceBenefits.map((benefit, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="text-[var(--neon-magenta)] mt-1">✓</span>
                    <span className="text-[var(--off-white)]">{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================
          SECTION 11: BI-DIRECTIONAL WORKFLOW
          ============================================ */}
      <Section>
        <PinkCloud className="pink-cloud-4" style={{ bottom: "-20%", left: "-20%" }} />

        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="animate-on-scroll font-['Space_Grotesk'] text-4xl md:text-5xl font-bold mb-4">
              The Bi-Directional <span className="gradient-text">Workflow</span>
            </h2>
            <p className="animate-on-scroll stagger-1 text-[var(--muted-grey)] text-lg max-w-2xl mx-auto">
              A seamless loop between design, development, and deployment
            </p>
          </div>

          {/* Horizontal Timeline */}
          <div className="animate-on-scroll stagger-2 relative">
            {/* Horizontal connecting line */}
            <div className="hidden md:block absolute top-[44px] left-[10%] right-[10%] h-[2px]">
              <div className="w-full h-full rounded-full bg-gradient-to-r from-[#EC4899] via-[#D946EF] to-[#22D3EE] opacity-40" />
            </div>

            {/* Steps */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-8 md:gap-4 relative">
              {[
                { step: "Design", label: "DreamSpace Web UI", desc: "Generate your initial app with AI-powered no-code tools", color: "#EC4899", icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                )},
                { step: "Develop", label: "Claude Code CLI", desc: "Enhance with SDK — add complex features and production code", color: "#8B5CF6", icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                    <line x1="14" y1="4" x2="10" y2="20" />
                  </svg>
                )},
                { step: "Integrate", label: "DreamSpace SDK", desc: "Query blockchain data, deploy contracts, build React UIs", color: "#D946EF", icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                  </svg>
                )},
                { step: "Bundle", label: "Export Package", desc: "Package everything for DreamSpace&apos;s audited infrastructure", color: "#F472B6", icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0022 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                )},
                { step: "Deploy", label: "Ship to Base", desc: "Go live with sub-cent fees and sub-second confirmations", color: "#22D3EE", icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z" />
                    <path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z" />
                    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
                  </svg>
                )},
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center text-center group">
                  {/* Step number + icon node */}
                  <div className="relative mb-6">
                    <div
                      className="w-[88px] h-[88px] rounded-2xl flex items-center justify-center transition-all duration-300 group-hover:scale-110"
                      style={{
                        background: `linear-gradient(135deg, ${item.color}25, ${item.color}10)`,
                        border: `1.5px solid ${item.color}40`,
                        boxShadow: `0 0 0 4px rgba(15,15,15,1), 0 0 25px ${item.color}20`,
                        color: item.color,
                      }}
                    >
                      {item.icon}
                    </div>
                    {/* Step number badge */}
                    <div
                      className="absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold font-['Space_Grotesk'] text-white"
                      style={{ background: item.color }}
                    >
                      {i + 1}
                    </div>
                  </div>

                  {/* Step label */}
                  <div
                    className="font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wider mb-1"
                    style={{ color: item.color }}
                  >
                    {item.step}
                  </div>

                  {/* Step title */}
                  <div className="font-['Space_Grotesk'] font-semibold text-base text-[var(--off-white)] mb-2">
                    {item.label}
                  </div>

                  {/* Step description */}
                  <p className="text-[var(--muted-grey)] text-sm leading-relaxed max-w-[180px]">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* Loop indicator */}
            <div className="mt-16 flex flex-col items-center gap-3">
              <div className="flex items-center gap-4">
                <div className="h-px flex-1 max-w-[120px] bg-gradient-to-r from-transparent to-[var(--hot-pink)] opacity-40" />
                <div className="glass-card px-6 py-3 flex items-center gap-3 border-[rgba(236,72,153,0.2)]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--hot-pink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                  <span className="text-[var(--muted-grey)] text-sm font-['Space_Grotesk']">Iterate &amp; improve</span>
                </div>
                <div className="h-px flex-1 max-w-[120px] bg-gradient-to-l from-transparent to-[var(--hot-pink)] opacity-40" />
              </div>
              <p className="text-[var(--muted-grey)] text-base opacity-70 max-w-lg text-center mt-4">
                Ship fast, gather feedback, and redeploy — your workflow loops seamlessly between DreamSpace and code.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================
          SECTION 13: CTA FOOTER
          ============================================ */}
      <Section id="get-started" className="pb-32">
        {/* Intense pink cloud formation */}
        <PinkCloud className="pink-cloud-1" style={{ top: "-30%", left: "20%" }} />
        <PinkCloud className="pink-cloud-2" style={{ top: "-20%", right: "20%" }} />
        <PinkCloud className="pink-cloud-5" style={{ bottom: "-30%", left: "40%" }} />

        <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
          <h2 className="animate-on-scroll font-['Space_Grotesk'] text-5xl md:text-6xl font-bold mb-4">
            Start Building{" "}
            <span className="gradient-text">the Future</span>
          </h2>
          <p className="animate-on-scroll stagger-1 text-xl text-[var(--muted-grey)] mb-10">
            The on-chain development experience you&apos;ve been waiting for.
          </p>

          {/* Giant Install Command */}
          <div
            onClick={() => copyToClipboard("npm install @dreamspace/sdk")}
            className="animate-on-scroll stagger-2 inline-block mb-10 cursor-pointer group"
          >
            <div className="code-block glow px-12 py-6 font-mono text-xl md:text-2xl transition-transform group-hover:scale-105">
              <span className="text-[var(--muted-grey)]">$</span>{" "}
              <span className="text-[var(--ocean-cyan)]">npm install</span>{" "}
              <span className="text-[var(--hot-pink)]">@dreamspace/sdk</span>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="animate-on-scroll stagger-3 flex flex-wrap justify-center gap-4">
            <a href="/docs" className="btn-primary text-lg px-8 py-4">
              <span>Documentation</span>
            </a>
            <a href="/docs" className="btn-outline text-lg px-8 py-4">
              Docs
            </a>
            <a href="#" className="btn-outline text-lg px-8 py-4">
              Discord
            </a>
            <a href="https://dream.space" target="_blank" rel="noopener noreferrer" className="btn-outline text-lg px-8 py-4">
              dream.space
            </a>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <footer className="border-t border-[rgba(63,63,70,0.5)] py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <img src="/dreamspace-logo.png" alt="DreamSpace SDK" className="h-6" />
          <div className="text-sm text-[var(--muted-grey)]">
            Built by MakeInfinite Labs · Powered by Space and Time
          </div>
          <div className="flex gap-6 text-sm text-[var(--muted-grey)]">
            <a href="/docs" className="hover:text-[var(--off-white)] transition-colors">
              Docs
            </a>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--off-white)] transition-colors">
              GitHub
            </a>
            <a href="#" className="hover:text-[var(--off-white)] transition-colors">
              Twitter
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
