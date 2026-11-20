/**
 * SXT API key validation via the free `/auth/apikey` exchange.
 *
 * Same endpoint and header shape as `examples/scripts/verify-table.mjs` (via the
 * SDK) and the curl health check in the root CLAUDE.md: POST with header
 * `apikey: <key>`, returns `{ accessToken, accessTokenExpires }`. The exchange
 * does not run a query, so it costs no SXT query credits. The hosted consent
 * page and the refresh-token path call it to confirm a key is live before the
 * server issues a token sealed over it.
 */

export const AUTH_URL = process.env.SXT_AUTH ?? "https://proxy.api.makeinfinite.dev/auth/apikey";

export type KeyCheck =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unavailable"; detail: string };

export type KeyValidator = (apiKey: string) => Promise<KeyCheck>;

/** Loose shape check before any network call. SXT keys are opaque strings. */
export function looksLikeApiKey(value: string): boolean {
  return /^[A-Za-z0-9_\-.:+/=]{16,256}$/.test(value);
}

export const validateApiKey: KeyValidator = async (apiKey) => {
  if (!looksLikeApiKey(apiKey)) {
    return { ok: false, reason: "invalid", detail: "the value does not look like an SXT API key" };
  }
  let res: Response;
  try {
    res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: apiKey },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return {
      ok: false,
      reason: "unavailable",
      detail: `SXT auth endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as { accessToken?: unknown };
    if (typeof body.accessToken === "string") return { ok: true };
    return { ok: false, reason: "unavailable", detail: "SXT auth returned no access token" };
  }
  // 4xx means the key itself was rejected: a stale key is a 404 ("No Api Key
  // found ..."), a malformed one a 400. 429 is load, not a bad key.
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    return { ok: false, reason: "invalid", detail: "SXT did not recognise this API key" };
  }
  return { ok: false, reason: "unavailable", detail: `SXT auth returned HTTP ${res.status}` };
};
