"use client";

import { useState } from "react";

export type SkillCard = {
  name: string;
  description: string;
  plugin: string;
  lifecycle: string;
  highlights: string[];
  languages: string[];
  githubUrl: string;
  // "stable" — ready to invoke today. "coming-soon" — scaffolded on the
  // catalog so the roadmap is honest; SKILL.md documents the current
  // workaround (typically a UI flow) until the CLI implementation ships.
  status?: "stable" | "coming-soon";
};

const FILTERS = [
  "All",
  "Publish",
  "Foundations",
  "Query",
  "Audit",
  "Deploy",
] as const;

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f7df1e",
  Solidity: "#aa6746",
  SQL: "#4f9bc7",
  Markdown: "#6b7280",
};

const LANG_LOGOS: Record<string, string> = {
  TypeScript: "/lang-typescript.png",
  JavaScript: "/lang-javascript.png",
  Solidity: "/lang-solidity.png",
};

const OpenAILogoPath = (
  <path
    fill="currentColor"
    d="M297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68C187.93 9.45 165.93-.07 142.95-.07c-35.16 0-66.3 22.78-77 56.55-22.51 4.62-41.94 18.73-53.31 38.71-17.59 30.32-13.58 68.51 9.92 94.51-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.46 17.36 37.46 26.88 60.45 26.88 35.16 0 66.3-22.78 77-56.55 22.51-4.62 41.94-18.73 53.31-38.71 17.59-30.32 13.58-68.51-9.92-94.51zm-120.28 168.11c-14.03 0-27.59-4.91-38.34-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.97-59.96 60.07zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.93-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08L74.1 184.2c-28.64-16.57-38.45-53.2-21.94-81.84zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.16c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74V82.97c.02-33.12 26.89-59.96 60.04-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"
  />
);

const GeminiLogoPath = (
  <path fill="currentColor" d="M12 24L9.4 16.6 2 14l7.4-2.6L12 4l2.6 7.4L22 14l-7.4 2.6L12 24z" />
);

export default function SkillsCatalog({ skills }: { skills: SkillCard[] }) {
  const [active, setActive] = useState<(typeof FILTERS)[number]>("All");

  const visible =
    active === "All" ? skills : skills.filter((s) => s.lifecycle === active);

  return (
    <div className="skills-catalog-section">
      <div className="skills-filter-chips" role="tablist" aria-label="Filter skills by lifecycle stage">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={active === f}
            className={`skills-filter-chip ${active === f ? "active" : ""}`}
            onClick={() => setActive(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="skills-card-grid">
        {visible.map((s) => (
          <article
            key={s.name}
            className={`skills-card ${s.status === "coming-soon" ? "skills-card-coming-soon" : ""}`}
            id={`skill-${s.name}`}
          >
            <header className="skills-card-header">
              <div className="skills-card-title-block">
                <h3 className="skills-card-title">
                  {s.name}
                  {s.status === "coming-soon" && (
                    <span className="skills-card-status-badge" aria-label="Coming soon">
                      🚧 Coming soon
                    </span>
                  )}
                </h3>
                <div className="skills-card-subpath">
                  {s.plugin}/{s.name}
                </div>
              </div>
              <span className={`skills-card-tag tag-${s.lifecycle.toLowerCase()}`}>
                {s.lifecycle}
              </span>
            </header>

            <p className="skills-card-desc">{s.description}</p>

            <div className="skills-card-meta">
              <div className="skills-card-models" aria-label="Supported AI runtimes">
                <span className="skills-model-logo skills-model-active" title="Claude (Anthropic) — active">
                  <img src="/anthropic-logo.png" alt="Claude" />
                </span>
                <span className="skills-model-logo skills-model-locked" title="Codex (OpenAI) — coming soon">
                  <svg width="16" height="16" viewBox="0 0 320 320" aria-hidden="true">
                    {OpenAILogoPath}
                  </svg>
                </span>
                <span className="skills-model-logo skills-model-locked" title="Gemini (Google) — coming soon">
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                    {GeminiLogoPath}
                  </svg>
                </span>
              </div>

              <div className="skills-card-langs" aria-label="Languages">
                {s.languages.map((lang) => {
                  const logo = LANG_LOGOS[lang];
                  return (
                    <span key={lang} className="skills-lang-tile" title={lang}>
                      {logo ? (
                        <img src={logo} alt={lang} />
                      ) : (
                        <span
                          className="skills-lang-tile-fallback"
                          style={{ color: LANG_COLORS[lang] || "var(--muted-grey)" }}
                          aria-hidden="true"
                        >
                          {lang.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>

            <ul className="skills-card-bullets">
              {s.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>

            <footer className="skills-card-footer">
              <a
                href={s.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="skills-card-link"
              >
                View SKILL.md →
              </a>
            </footer>
          </article>
        ))}
      </div>

      {visible.length === 0 && (
        <div className="skills-empty">No skills match this filter yet.</div>
      )}
    </div>
  );
}
