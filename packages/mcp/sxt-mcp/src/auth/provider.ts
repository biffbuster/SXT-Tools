/**
 * Stateless OAuth 2.1 provider for the hosted transport. Bring-your-own-key:
 * every user authorizes with their own SXT API key, and every token the server
 * issues is sealed over that key (see lib/sealed.ts). The operator's own key is
 * never used on behalf of a hosted caller.
 *
 * The protocol surface (metadata, dynamic client registration, PKCE checks,
 * token and revocation endpoints) comes from the MCP SDK's `mcpAuthRouter`.
 * This class supplies only the storage-free pieces:
 *
 *   - clientsStore: the registered client's metadata IS its client_id (sealed).
 *   - authorize():  renders the consent page; the pending request rides along
 *                   as a sealed `consent` token in the form.
 *   - codes:        sealed, 5-minute TTL, single-use per instance.
 *   - access:       sealed, 1-hour TTL, carries the SXT key.
 *   - refresh:      sealed, 30-day TTL, re-validates the key on every use so a
 *                   key rotated at the SXT console stops refreshing.
 */

import { createHash } from "node:crypto";
import type { Response } from "express";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";

import { SealError, Sealer, nowSeconds, principalId } from "../lib/sealed.js";
import type { KeyValidator } from "../lib/sxt-auth.js";
import { renderConsentPage } from "./consent.js";

export const SCOPE = "sxt:query";

const CLIENT_TTL = 365 * 24 * 3600;
const CONSENT_TTL = 10 * 60;
const CODE_TTL = 5 * 60;
const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 30 * 24 * 3600;

interface ConsentPayload {
  cid: string;
  clientName?: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: string[];
  resource?: string;
}

interface CodePayload {
  cid: string;
  k: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
}

interface GrantPayload {
  cid: string;
  k: string;
  scopes: string[];
  resource?: string;
}

/** Short stable hash of a (long, sealed) client_id, so codes and tokens stay compact. */
function clientHash(clientId: string): string {
  return createHash("sha256").update(clientId).digest("base64url").slice(0, 22);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/**
 * Per-instance memory of spent one-time values (authorization codes) and
 * revoked tokens, held until each entry's natural expiry. Across instances a
 * code is still bound to its PKCE verifier, so replaying one needs the
 * verifier too; this set closes the same-instance replay window.
 */
class ExpiringSet {
  private readonly entries = new Map<string, number>();

  add(key: string, exp: number): void {
    this.entries.set(key, exp);
    if (this.entries.size > 10_000) this.prune();
  }

  has(key: string): boolean {
    const exp = this.entries.get(key);
    if (exp === undefined) return false;
    if (exp < nowSeconds()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  private prune(): void {
    const now = nowSeconds();
    for (const [k, exp] of this.entries) if (exp < now) this.entries.delete(k);
  }
}

export interface SxtOAuthProviderOptions {
  sealer: Sealer;
  validateKey: KeyValidator;
  /** Canonical resource URL of the MCP endpoint, e.g. https://mcp.example.com/mcp */
  resourceUrl: URL;
  /** Path the consent form posts to. */
  consentPath: string;
}

export class SxtOAuthProvider implements OAuthServerProvider {
  private readonly sealer: Sealer;
  private readonly validateKey: KeyValidator;
  private readonly resourceUrl: URL;
  private readonly consentPath: string;
  private readonly spentCodes = new ExpiringSet();
  private readonly revoked = new ExpiringSet();

  constructor(opts: SxtOAuthProviderOptions) {
    this.sealer = opts.sealer;
    this.validateKey = opts.validateKey;
    this.resourceUrl = opts.resourceUrl;
    this.consentPath = opts.consentPath;
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    const sealer = this.sealer;
    return {
      getClient(clientId: string): OAuthClientInformationFull | undefined {
        try {
          const meta = sealer.open<Omit<OAuthClientInformationFull, "client_id">>("client", clientId);
          const { exp: _exp, ...rest } = meta as typeof meta & { exp: number };
          return { ...rest, client_id: clientId } as OAuthClientInformationFull;
        } catch {
          return undefined;
        }
      },
      registerClient(client): OAuthClientInformationFull {
        // The SDK has already generated a random UUID client_id; replace it
        // with a sealed blob of the metadata so no store is needed.
        const { client_id: _discard, ...meta } = client as OAuthClientInformationFull;
        const clientId = sealer.seal("client", meta, CLIENT_TTL);
        return { ...meta, client_id: clientId } as OAuthClientInformationFull;
      },
    };
  }

  /** Validates that a requested RFC 8707 resource, if any, is this server. */
  private checkResource(resource: string | URL | undefined): void {
    if (resource === undefined) return;
    const r = new URL(resource.toString());
    r.hash = "";
    if (r.href !== this.resourceUrl.href) {
      throw new InvalidTargetError(`token is not valid for resource ${r.href}`);
    }
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    this.checkResource(params.resource);
    const consent = this.sealer.seal<ConsentPayload>(
      "consent",
      {
        cid: client.client_id,
        clientName: client.client_name,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
        scopes: params.scopes?.length ? params.scopes : [SCOPE],
        resource: params.resource?.href,
      },
      CONSENT_TTL,
    );
    sendConsent(res, 200, {
      consentToken: consent,
      clientName: client.client_name,
      redirectUri: params.redirectUri,
      action: this.consentPath,
    });
  }

  /**
   * Handles the consent form POST. Returns the redirect URL to send the user
   * to, or re-renders the page with an error if the key was rejected.
   */
  async completeConsent(
    form: { consent?: string; sxt_api_key?: string; decision?: string },
    res: Response,
  ): Promise<void> {
    let consent: ConsentPayload;
    try {
      consent = this.sealer.open<ConsentPayload>("consent", form.consent ?? "");
    } catch (err) {
      sendConsentError(res, 400, err instanceof SealError && err.message === "token expired"
        ? "This sign-in request expired. Start the connection again from your MCP client."
        : "This sign-in request is not valid. Start the connection again from your MCP client.");
      return;
    }

    const redirect = new URL(consent.redirectUri);
    if (consent.state !== undefined) redirect.searchParams.set("state", consent.state);

    if (form.decision !== "approve") {
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("error_description", "The user declined to connect.");
      res.redirect(302, redirect.href);
      return;
    }

    const apiKey = (form.sxt_api_key ?? "").trim();
    const check = await this.validateKey(apiKey);
    if (!check.ok) {
      sendConsent(res, check.reason === "invalid" ? 400 : 503, {
        consentToken: form.consent!,
        clientName: consent.clientName,
        redirectUri: consent.redirectUri,
        action: this.consentPath,
        error:
          check.reason === "invalid"
            ? "SXT did not accept that API key. Copy a current key from app.spaceandtime.ai and try again."
            : "The SXT sign-in service is not responding. Try again in a minute.",
      });
      return;
    }

    const code = this.sealer.seal<CodePayload>(
      "code",
      {
        cid: clientHash(consent.cid),
        k: apiKey,
        codeChallenge: consent.codeChallenge,
        redirectUri: consent.redirectUri,
        scopes: consent.scopes,
        resource: consent.resource,
      },
      CODE_TTL,
    );
    redirect.searchParams.set("code", code);
    res.redirect(302, redirect.href);
  }

  private openCode(client: OAuthClientInformationFull, code: string): CodePayload & { exp: number } {
    let payload: CodePayload & { exp: number };
    try {
      payload = this.sealer.open<CodePayload>("code", code);
    } catch (err) {
      throw new InvalidGrantError(`invalid authorization code: ${(err as Error).message}`);
    }
    if (payload.cid !== clientHash(client.client_id)) {
      throw new InvalidGrantError("authorization code was issued to another client");
    }
    return payload;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.openCode(client, code).codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const payload = this.openCode(client, code);
    const h = tokenHash(code);
    if (this.spentCodes.has(h)) throw new InvalidGrantError("authorization code already used");
    this.spentCodes.add(h, payload.exp);

    if (redirectUri !== undefined && redirectUri !== payload.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    this.checkResource(resource ?? payload.resource);
    return this.issue({
      cid: payload.cid,
      k: payload.k,
      scopes: payload.scopes,
      resource: resource?.href ?? payload.resource,
    });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    if (this.revoked.has(tokenHash(refreshToken))) throw new InvalidGrantError("refresh token revoked");
    let payload: GrantPayload & { exp: number };
    try {
      payload = this.sealer.open<GrantPayload>("refresh", refreshToken);
    } catch (err) {
      throw new InvalidGrantError(`invalid refresh token: ${(err as Error).message}`);
    }
    if (payload.cid !== clientHash(client.client_id)) {
      throw new InvalidGrantError("refresh token was issued to another client");
    }
    if (scopes?.some((s) => !payload.scopes.includes(s))) {
      throw new InvalidGrantError("requested scopes exceed the original grant");
    }
    this.checkResource(resource ?? payload.resource);

    // A key rotated or revoked at the SXT console must stop refreshing.
    const check = await this.validateKey(payload.k);
    if (!check.ok && check.reason === "invalid") {
      throw new InvalidGrantError("the SXT API key behind this grant is no longer valid; reconnect");
    }

    this.revoked.add(tokenHash(refreshToken), payload.exp); // rotate: old refresh token is spent
    return this.issue({ ...payload, scopes: scopes ?? payload.scopes });
  }

  private issue(grant: GrantPayload): OAuthTokens {
    const { cid, k, scopes, resource } = grant;
    return {
      access_token: this.sealer.seal<GrantPayload>("access", { cid, k, scopes, resource }, ACCESS_TTL),
      token_type: "bearer",
      expires_in: ACCESS_TTL,
      refresh_token: this.sealer.seal<GrantPayload>("refresh", { cid, k, scopes, resource }, REFRESH_TTL),
      scope: scopes.join(" "),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (this.revoked.has(tokenHash(token))) throw new InvalidTokenError("token revoked");
    let payload: GrantPayload & { exp: number };
    try {
      payload = this.sealer.open<GrantPayload>("access", token);
    } catch (err) {
      throw new InvalidTokenError((err as Error).message);
    }
    this.checkResource(payload.resource);
    return {
      token,
      clientId: payload.cid,
      scopes: payload.scopes,
      expiresAt: payload.exp,
      resource: payload.resource ? new URL(payload.resource) : undefined,
      extra: { sxtApiKey: payload.k, principal: principalId(payload.k) },
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    for (const typ of ["access", "refresh"] as const) {
      try {
        const p = this.sealer.open(typ, request.token);
        this.revoked.add(tokenHash(request.token), p.exp);
        return;
      } catch {
        // not this type; try the next
      }
    }
  }
}

/**
 * CSP source for the client's redirect URI. Browsers apply form-action to the
 * redirect that follows the consent POST, so 'self' alone blocks the hop back
 * to the client. They apply it to every later hop too: Cursor's callback on
 * www.cursor.com 308s to cursor.com, so an https redirect allows any https
 * target. The page runs no scripts and its one form posts to 'self'.
 */
function redirectSource(redirectUri: string | undefined): string {
  if (!redirectUri) return "";
  try {
    const u = new URL(redirectUri);
    if (u.protocol === "https:") return " https:";
    // Loopback http keeps its exact origin. Custom schemes (cursor://,
    // vscode://) have an opaque origin; allow the scheme.
    return u.protocol === "http:" ? ` ${u.origin}` : ` ${u.protocol}`;
  } catch {
    return "";
  }
}

function securityHeaders(res: Response, redirectUri?: string): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  // Not no-referrer: under that policy browsers send `Origin: null` on the
  // consent POST, which the origin check rejects. same-origin still sends no
  // referrer to the client or any other site.
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${redirectSource(redirectUri)}; ` +
      "frame-ancestors 'none'; base-uri 'none'",
  );
}

function sendConsent(res: Response, status: number, view: Parameters<typeof renderConsentPage>[0]): void {
  securityHeaders(res, view.redirectUri);
  res.status(status).type("html").send(renderConsentPage(view));
}

function sendConsentError(res: Response, status: number, message: string): void {
  securityHeaders(res);
  res.status(status).type("html").send(renderConsentPage({ fatal: message }));
}
