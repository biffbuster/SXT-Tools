"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const sidebarNav = [
  {
    category: "Getting Started",
    items: [
      { title: "Overview", href: "/docs" },
      { title: "Quick start", href: "/docs/quick-start" },
    ],
  },
  {
    category: "Workflows",
    items: [
      { title: "Generate, audit & deploy", href: "/docs/generate-audit-deploy" },
    ],
  },
  {
    category: "Reference",
    items: [
      { title: "Space and Time primitives", href: "/docs/space-and-time" },
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
              <img src="/dreamspace-logo.png" alt="SXT Tools" className="h-7" />
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
