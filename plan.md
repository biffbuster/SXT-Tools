# DreamSpace SDK — Landing Page Build Plan

## Project Overview

Build a premium, visually striking landing page for the **DreamSpace SDK** — a TypeScript development toolkit that bridges professional local development (Claude Code CLI, VS Code, etc.) with DreamSpace's no-code AI app builder and deployment platform. The page should communicate what the SDK is, why it matters, and how it upgrades the existing Space and Time development experience — all wrapped in DreamSpace's brand identity with world-class creative design.

**Live URL:** [dream.space](https://dream.space)  
**Platform:** DreamSpace — AI-powered no-code app builder on Base (Coinbase L2)  
**Backed by:** Microsoft M12, Space and Time, Base/Coinbase  
**Parent org:** MakeInfinite Labs

---

## Brand Identity & Media Kit

### Color Palette (DreamSpace / Space and Time)

Use these as the core palette, drawing from the Space and Time brand kit:

| Color             | Hex       | Usage                              |
|-------------------|-----------|------------------------------------|
| Electric Purple   | `#5000BF` | Primary accent, CTAs, highlights   |
| Neon Magenta      | `#CC0AAC` | Secondary accent, gradients, glow  |
| Nebula Black      | `#100217` | Primary background, deep sections  |
| Nebula Silver     | `#6F4D80` | Muted text, borders, subtle UI     |
| Off White         | `#E6E6E6` | Body text, headings on dark bg     |
| Ocean Cyan        | `#00FFFF` | Code highlights, interactive glow  |

### Design Direction

- **Aesthetic:** Dark, cosmic, futuristic — "nebula meets IDE." Think deep space gradients with crystalline code elements floating in the void.
- **Typography:** Use distinctive, modern display fonts (e.g., `JetBrains Mono` for code, paired with a bold geometric sans like `Satoshi`, `Cabinet Grotesk`, or `Clash Display` for headings). Avoid Inter/Roboto.
- **Atmosphere:** Layered mesh gradients, grain/noise overlays, subtle particle effects or animated gradient orbs. Glass-morphic cards with purple/magenta glow edges.
- **Motion:** Staggered scroll-triggered reveals, code blocks that "type" in on scroll, floating orbs that drift slowly, subtle parallax depth layers.
- **Spatial:** Generous whitespace between sections. Asymmetric layouts with overlapping code blocks and UI previews. Grid-breaking hero with diagonal flow.

### Logo & Assets

- DreamSpace logo from `dreamspace.xyz` (fetch SVG or reference brand assets)
- Space and Time logo for "Powered by" section
- Base / Coinbase, Microsoft Azure logos for partner badges
- Use placeholder images where needed with notes for future asset swap

---

## Page Structure & Sections

### 1. Hero Section
- **Headline:** "The Missing SDK for On-Chain Development"
- **Subheadline:** "Build production-grade Web3 apps with TypeScript. Query blockchain data, deploy smart contracts, and ship to DreamSpace — all from your terminal."
- **CTA Buttons:** `npm install @dreamspace/sdk` (copyable) + "Read the Docs" + "View on GitHub"
- **Visual:** Animated code snippet showing a 3-line SDK usage floating over a cosmic gradient background with subtle particle/orb effects
- **Design notes:** Full-viewport height. Code snippet should glow with Electric Purple border. Background is Nebula Black with radial gradient bleed of Magenta/Purple.

### 2. Problem → Solution Section
- **Heading:** "From 150 Lines to 15"
- **Layout:** Side-by-side comparison showing "Without SDK" (verbose, raw SxT SQL + manual config) vs "With SDK" (clean 15-line code block)
- **Include animated transition** or slider between the two code blocks
- **Key stat callouts:** "10x less code" · "Zero config" · "Type-safe"
- **Design notes:** Glassmorphic code cards on dark background. Left card slightly dimmed/red-tinted, right card glowing with purple accent.

### 3. SDK vs SxT SDK Comparison Table
- **Heading:** "Built on Space and Time. Supercharged for Builders."
- **Interactive comparison table** showing feature-by-feature upgrade:

| Feature              | SxT SDK (Existing)        | DreamSpace SDK (New)          |
|----------------------|---------------------------|-------------------------------|
| Blockchain queries   | Raw SQL required           | Pre-built query functions     |
| Smart contracts      | Not included               | Templates + deployer          |
| UI components        | Not included               | React library with themes     |
| Chain configs        | Manual setup               | One-line configuration        |
| Code volume          | 50+ lines per query        | 1 function call               |
| Learning curve       | High (SQL + APIs)          | Low (simple methods)          |
| AI compatibility     | Verbose prompts            | Clean, simple code            |
| DreamSpace deploy    | None                       | Export bundles ready           |

- **Design notes:** Table rows animate in on scroll. "New" column has subtle glow. Check/X icons with color coding.

### 4. Core Features Grid
- **Heading:** "Everything You Need to Build On-Chain"
- **Layout:** 2x3 or 3x2 grid of feature cards with icons
- **Features:**
  1. **Simplified Data Access** — Pre-built query templates for ERC20, ERC721, DeFi protocols. No raw SQL.
  2. **Smart Contract Templates** — OpenZeppelin-based contract generation. NFTs, tokens, DAOs in one command.
  3. **Multi-Chain Support** — Pre-configured for Base, Ethereum, Polygon, Avalanche, Sui. One-line chain switching.
  4. **React UI Components** — Glassmorphic dashboards, data tables, charts, wallet connect. DreamSpace-themed.
  5. **AI-Friendly API** — Designed to work seamlessly with Claude Code CLI, Cursor, and AI coding assistants.
  6. **DreamSpace Deployment** — Bundle and export directly to DreamSpace's audited infrastructure on Base.
- **Design notes:** Cards use glass-morphic style with gradient borders. Hover reveals subtle glow animation. Icons should be custom/geometric, not generic Lucide defaults.

### 5. Code Showcase Section
- **Heading:** "Ship Your Dream App in Minutes"
- **Layout:** Tabbed code editor UI showing 4 real SDK usage examples:

**Tab 1 — Query Blockchain Data:**
```typescript
import { DreamSpaceSDK } from '@dreamspace/sdk'

const sdk = new DreamSpaceSDK(process.env.SXT_API_KEY)
const transfers = await sdk.queries.erc20.getTransfers({
  chain: 'base',
  tokenAddress: '0x...',
  fromBlock: 19000000
})
```

**Tab 2 — Deploy Smart Contract:**
```typescript
const nft = await sdk.contracts.deployNFT({
  name: 'CosmicCollectibles',
  symbol: 'COSM',
  maxSupply: 10_000,
  network: 'base'
})
console.log(`Deployed at: ${nft.address}`)
```

**Tab 3 — Create Dashboard:**
```typescript
const dashboard = await sdk.ui.createDashboard({
  title: 'DeFi Analytics',
  dataSource: transfers,
  visualizations: ['line', 'bar', 'table'],
  theme: 'dreamspace-dark'
})
```

**Tab 4 — Deploy to DreamSpace:**
```typescript
await sdk.deployment.bundle({
  contracts: ['./contracts/*.sol'],
  frontend: './dist',
  target: 'dreamspace',
  auditFirst: true,
  network: 'base'
})
```

- **Design notes:** Code editor should look like a real IDE with line numbers, syntax highlighting using the brand palette (purple keywords, cyan strings, magenta functions). Tabs animate on switch. Editor has a faint glow border.

### 6. Real-World Example Section
- **Heading:** "NFT Marketplace — Built in 15 Lines"
- **Layout:** Full code example on the left, rendered app preview/mockup on the right
- **Show the complete flow:** initialize → query → deploy contract → create UI → deploy to DreamSpace
- **Design notes:** Split layout. Code side is dark IDE. Preview side shows a glassmorphic NFT marketplace UI mockup. Connecting line or arrow between them showing "SDK powers this →"

### 7. Architecture / How It Works
- **Heading:** "How It Works"
- **Visual:** Horizontal 4-step flow diagram:
  1. 🛠️ **Build** — Write TypeScript in Claude Code CLI or your IDE
  2. 📊 **Query** — Access 100TB+ indexed blockchain data via Space and Time
  3. 🔐 **Audit** — Auto-verify smart contracts through MythX/Certora integration
  4. 🚀 **Ship** — Deploy to DreamSpace on Base with one command
- **Design notes:** Steps connected by animated gradient line. Each step is a floating card with icon. Background has subtle grid pattern.

### 8. Who It's For (Audience Section)
- **Heading:** "Built for Every Builder"
- **Layout:** 4 audience cards:
  1. **Professional Developers** — Local dev power + DreamSpace deployment
  2. **AI-Assisted Builders** — Optimized for Claude Code, Cursor, Copilot
  3. **Web3 Teams** — Production-grade multi-chain tooling
  4. **DreamSpace Creators** — Extend no-code apps with custom SDK features
- **Design notes:** Minimal cards with subtle icons. Clean and readable.

### 9. Partner / Powered By Logos
- **Heading:** "Powered By"
- **Logos:** DreamSpace · Space and Time · Microsoft Azure · Base/Coinbase · OpenZeppelin
- **Design notes:** Logo strip with subtle grayscale → color on hover. Nebula Black background.

### 10. CTA / Getting Started Footer
- **Heading:** "Start Building"
- **Content:**
  ```bash
  npm install @dreamspace/sdk
  ```
- **Buttons:** "Read the Docs" · "GitHub" · "Join Discord" · "dream.space"
- **Design notes:** Large, bold section. Gradient background with the full purple→magenta→cyan spectrum. Install command in a glowing terminal block.

---

## Technical Implementation

### Stack
- **Framework:** Next.js 14+ (App Router) or pure HTML/CSS/JS for maximum portability
- **Styling:** Tailwind CSS with custom theme extending DreamSpace palette
- **Animations:** Framer Motion (React) or CSS-only scroll animations
- **Code Highlighting:** Shiki or Prism with custom DreamSpace theme
- **Fonts:** Google Fonts — `JetBrains Mono` (code) + `Cabinet Grotesk` or `Clash Display` (headings) + `Satoshi` (body)
- **Effects:** CSS mesh gradients, backdrop-filter blur, SVG noise textures, CSS particle emitters

### File Structure (if built as single HTML artifact)
```
dreamspace-sdk-landing/
├── index.html          # Single-file landing page
├── assets/
│   ├── logos/          # DreamSpace, SxT, Base, Azure logos
│   ├── mockups/        # App preview screenshots
│   └── noise.svg       # Grain overlay texture
└── README.md
```

### Performance Targets
- Lighthouse score 90+
- First contentful paint < 1.5s
- All animations respect `prefers-reduced-motion`
- Mobile-responsive with fluid typography

---

## Key Messaging

### Tagline Options
1. "The Missing SDK for On-Chain Development"
2. "Build. Query. Deploy. Dream."
3. "Professional Tooling for the DreamSpace Ecosystem"
4. "From Idea to On-Chain in Minutes"

### Value Propositions
- **For Developers:** "Write TypeScript, not SQL. Deploy contracts, not configuration files."
- **For DreamSpace:** "The SDK that turns DreamSpace from a no-code tool into a full development platform."
- **For Web3:** "100TB+ of indexed blockchain data, one function call away."

---

## Design Inspiration References

- [linear.app](https://linear.app) — Dark theme, glass UI, code-first aesthetic
- [vercel.com](https://vercel.com) — Bold typography, animated code blocks, cosmic gradients
- [stripe.com/docs](https://stripe.com/docs) — Clean code showcase with syntax highlighting
- [raycast.com](https://raycast.com) — Glassmorphic cards, ambient glow, dark luxe feel
- [supabase.com](https://supabase.com) — Developer-focused landing with interactive code tabs

---

## Build Notes for Claude Code

1. **Read the frontend-design SKILL.md** before starting any implementation
2. **Single-file React (.jsx) or HTML** preferred for portability to DreamSpace
3. **All code blocks must use real, working SDK examples** from the proposal
4. **Prioritize visual impact** — this is a showcase piece, not a docs site
5. **Use CSS custom properties** for all brand colors for easy theming
6. **Test at 1440px, 1024px, 768px, 375px** breakpoints
7. **No placeholder "Lorem ipsum"** — all copy should be real and compelling

---

## Deliverables

- [ ] `index.html` or `index.jsx` — Complete landing page
- [ ] All section designs matching the plan above
- [ ] Responsive across desktop, tablet, mobile
- [ ] Smooth scroll-triggered animations
- [ ] Interactive code tabs with syntax highlighting
- [ ] Glassmorphic UI components matching DreamSpace aesthetic
- [ ] Partner logo section
- [ ] Copy-to-clipboard on install commands
- [ ] Dark mode only (matches brand)

---

*This landing page is both a marketing tool and a design showcase — it should demonstrate the same level of quality that the SDK itself promises to deliver.*