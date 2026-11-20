/**
 * Consent page for the hosted OAuth flow. Plain server-rendered HTML with no
 * scripts, no external assets, and every interpolated value escaped. The form
 * posts back to the same origin (CSP `form-action 'self'`); the pending
 * authorization request travels as a sealed token, so it cannot be forged or
 * edited in the browser.
 */

export interface ConsentView {
  consentToken?: string;
  clientName?: string;
  redirectUri?: string;
  action?: string;
  error?: string;
  /** Unrecoverable error: render a message with no form. */
  fatal?: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--fg:#1c1c1a;--muted:#62625c;--line:#dcdcd6;--accent:#2f5bd3;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--card:#1c1c1a;--fg:#ececea;--muted:#a3a39c;--line:#33332f;--accent:#7d9bf0;--err:#f97066}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{font-size:19px;margin:0 0 6px}p{margin:0 0 14px;color:var(--muted)}
.who{color:var(--fg);font-weight:600}.uri{font-family:ui-monospace,monospace;font-size:12.5px;word-break:break-all;color:var(--muted)}
label{display:block;font-weight:600;margin:18px 0 6px}
input[type=password]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
.row{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}
button{flex:1;min-width:120px;padding:10px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);font:inherit;font-weight:600;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.err{color:var(--err);margin-top:12px}.fine{font-size:13px;margin-top:18px}
`;

export function renderConsentPage(view: ConsentView): string {
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to Space and Time</title><style>${STYLE}</style></head><body><main>`;
  const foot = `</main></body></html>`;

  if (view.fatal) {
    return `${head}<h1>Connection not completed</h1><p>${esc(view.fatal)}</p>${foot}`;
  }

  const client = view.clientName ? esc(view.clientName) : "An MCP client";
  const redirectHost = view.redirectUri ? esc(new URL(view.redirectUri).host || view.redirectUri) : "";

  return `${head}
<h1>Connect to Space and Time</h1>
<p><span class="who">${client}</span> wants to run Proof of SQL queries on your behalf. Queries are billed to the SXT account that owns the key you enter.</p>
<p class="uri">Returns to ${redirectHost}</p>
<form method="post" action="${esc(view.action ?? "")}" autocomplete="off">
  <input type="hidden" name="consent" value="${esc(view.consentToken ?? "")}">
  <label for="k">SXT API key</label>
  <input id="k" name="sxt_api_key" type="password" required spellcheck="false" autocapitalize="off">
  ${view.error ? `<p class="err" role="alert">${esc(view.error)}</p>` : ""}
  <div class="row">
    <button type="submit" name="decision" value="deny" formnovalidate>Cancel</button>
    <button class="primary" type="submit" name="decision" value="approve">Connect</button>
  </div>
</form>
<p class="fine">Find your key at app.spaceandtime.ai under API Authentication. The key is checked with SXT, then stored only inside an encrypted token held by your client. This server keeps no copy. Rotating the key at SXT disconnects every client that uses it.</p>
${foot}`;
}
