"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

const SKILLS_COUNT = 7;

// Skill explainer anchors. Each Skills-catalog card on /docs carries
// id="skill-<name>", so these deep-link straight to that skill's explainer.
// Keep in sync with SKILL_SPECS in src/app/docs/page.tsx.
const SKILL_LINKS: Array<{ title: string; href: string; tag: string }> = [
  { title: "dataset-publish", href: "/docs#skill-dataset-publish", tag: "Publish" },
  { title: "index-contract", href: "/docs#skill-index-contract", tag: "Publish" },
  { title: "proof-of-sql-foundations", href: "/docs#skill-proof-of-sql-foundations", tag: "Foundations" },
  { title: "run-proven-query", href: "/docs#skill-run-proven-query", tag: "Query" },
  { title: "chain-data-query", href: "/docs#skill-chain-data-query", tag: "Query" },
  { title: "pre-deploy-audit", href: "/docs#skill-pre-deploy-audit", tag: "Audit" },
  { title: "deploy-contract", href: "/docs#skill-deploy-contract", tag: "Deploy" },
];

const NAV_TABS: Array<{
  title: string;
  href: string;
  count?: number;
  matchExact?: boolean;
  dropdown?: typeof SKILL_LINKS;
}> = [
  { title: "Skills", href: "/docs", count: SKILLS_COUNT, matchExact: true },
  { title: "Quick start", href: "/docs/quick-start", dropdown: SKILL_LINKS },
  { title: "Workflows", href: "/docs/generate-audit-deploy" },
  { title: "Reference", href: "/docs/space-and-time" },
  { title: "MCP", href: "/docs/mcp" },
];

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* Single top pill nav — logo left, tabs centered, actions right */}
      <div className="docs-pill-nav-wrap">
        <nav className="docs-pill-nav" aria-label="Docs navigation">
          <Link href="/" className="docs-pill-logo" aria-label="SXT Tools home">
            <img src="/sxt-skills-logo.jpg" alt="" />
          </Link>

          <div className="docs-pill-tabs" role="tablist">
            {NAV_TABS.map((tab) => {
              const active = isActive(tab.href, tab.matchExact);
              const tabLink = (
                <Link
                  key={tab.href}
                  href={tab.href}
                  role="tab"
                  aria-selected={active}
                  aria-haspopup={tab.dropdown ? "menu" : undefined}
                  className={`docs-pill-tab ${active ? "active" : ""}`}
                >
                  <span>{tab.title}</span>
                  {tab.count !== undefined && (
                    <span className="docs-pill-count">{tab.count}</span>
                  )}
                  {tab.dropdown && (
                    <svg
                      className="docs-pill-caret"
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                    >
                      <path
                        d="M2 4.5l4 4 4-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </Link>
              );

              if (!tab.dropdown) {
                return tabLink;
              }

              return (
                <div key={tab.href} className="docs-pill-tab-group">
                  {tabLink}
                  <div className="docs-pill-dropdown" role="menu" aria-label={`${tab.title} skills`}>
                    <div className="docs-pill-dropdown-panel">
                      <div className="docs-pill-dropdown-label">Skill explainers</div>
                      {tab.dropdown.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          role="menuitem"
                          className="docs-pill-dropdown-item"
                        >
                          <span className="docs-pill-dropdown-item-name">{item.title}</span>
                          <span className="docs-pill-dropdown-item-tag">{item.tag}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            <Link href="/" className="docs-pill-tab">
              <span>Home</span>
            </Link>
          </div>

          <div className="docs-pill-actions">
            <a
              href="https://github.com/biffbuster/sxt-tools"
              target="_blank"
              rel="noopener noreferrer"
              className="docs-pill-icon-btn"
              aria-label="GitHub repository"
              title="biffbuster/sxt-tools on GitHub"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17.91-.25 1.89-.38 2.86-.38s1.95.13 2.86.38c2.18-1.48 3.14-1.17 3.14-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.26 5.65.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
              </svg>
            </a>
            <ThemeToggle />
            <a
              href="https://dream.space"
              target="_blank"
              rel="noopener noreferrer"
              className="docs-pill-cta"
            >
              dream.space
            </a>
          </div>
        </nav>
      </div>

      <main className="docs-main">
        <div className="docs-content">{children}</div>
      </main>
    </>
  );
}
