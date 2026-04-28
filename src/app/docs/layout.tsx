"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const sidebarNav = [
  {
    category: "Getting Started",
    items: [
      { title: "Overview", href: "/docs" },
      { title: "Quick Start", href: "/docs/quick-start" },
    ],
  },
  {
    category: "Core Modules",
    items: [
      { title: "Auth & Identity", href: "/docs/auth" },
      { title: "Wallet", href: "/docs/wallet" },
      { title: "Query", href: "/docs/query" },
      { title: "Contracts", href: "/docs/contracts" },
      { title: "Networks", href: "/docs/networks" },
      { title: "Components", href: "/docs/components" },
      { title: "Deployment & Storage", href: "/docs/deployment" },
    ],
  },
  {
    category: "Advanced",
    items: [
      { title: "x402 Payment Protocol", href: "/docs/x402" },
      { title: "ERC-8004 Trustless Agents", href: "/docs/erc-8004" },
      { title: "Space and Time", href: "/docs/space-and-time" },
      { title: "Marketplace", href: "/docs/marketplace" },
    ],
  },
  {
    category: "Examples",
    items: [
      { title: "Examples", href: "/docs/examples" },
      { title: "ZK Search Engine", href: "/docs/examples/zk-search-engine" },
      { title: "Onchain Yield Agent", href: "/docs/examples/onchain-yield-agent" },
      { title: "Verified Data API", href: "/docs/examples/verified-data-api" },
      { title: "Agent Marketplace", href: "/docs/examples/agent-marketplace" },
    ],
  },
];

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      {/* Top Nav */}
      <nav className="docs-nav">
        <div className="flex items-center justify-between w-full max-w-[1600px] mx-auto">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center">
              <img src="/dreamspace-logo.png" alt="DreamSpace SDK" className="h-7" />
            </Link>
            <div className="hidden md:flex items-center gap-6 text-sm">
              <Link
                href="/"
                className="text-[var(--muted-grey)] hover:text-[var(--off-white)] transition-colors"
              >
                Home
              </Link>
              <Link
                href="/docs"
                className="text-[var(--hot-pink)] font-semibold"
              >
                Docs
              </Link>
            </div>
          </div>
          <a
            href="https://dream.space"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary text-sm py-2 px-4"
          >
            <span>dream.space</span>
          </a>
        </div>
      </nav>

      <div className="docs-layout">
        {/* Sidebar */}
        <aside className={`docs-sidebar ${sidebarOpen ? "open" : ""}`}>
          {sidebarNav.map((section) => (
            <div key={section.category} className="docs-sidebar-category">
              <div className="docs-sidebar-category-title">
                {section.category}
              </div>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`docs-sidebar-link ${pathname === item.href ? "active" : ""}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  {item.title}
                </Link>
              ))}
            </div>
          ))}
        </aside>

        {/* Main Content */}
        <main className="docs-main">
          <div className="docs-content">{children}</div>
        </main>

        {/* Mobile Toggle */}
        <button
          className="docs-sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? "\u2715" : "\u2630"}
        </button>
      </div>
    </>
  );
}
