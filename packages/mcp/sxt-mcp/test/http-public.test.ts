/**
 * Public-mode HTTP transport, end to end and in-process: OAuth discovery,
 * dynamic client registration, consent with bring-your-own key, PKCE code
 * exchange, refresh rotation, the X-SXT-API-Key header path, and the hosted
 * tool surface.
 *
 * Spends nothing. The SXT key check is stubbed, and every tool call uses
 * input that our own validators refuse before any network request.
 */

import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertStartable, createHttpApp } from "../src/http-app.js";
import type { HttpConfig } from "../src/lib/config.js";
import type { KeyValidator } from "../src/lib/sxt-auth.js";

const GOOD_KEY = "good-key-0123456789abcdef";
const readFoundations = async () => ({ uri: "sxt://docs/proof-of-sql-foundations", mimeType: "text/markdown", text: "# stub" });
const validateKey: KeyValidator = async (k) =>
  k === GOOD_KEY ? { ok: true } : { ok: false, reason: "invalid", detail: "stub: rejected" };

function config(port: number, extra: Partial<HttpConfig> = {}): HttpConfig {
  return {
    port,
    bindHost: "127.0.0.1",
    bindExplicit: true,
    allowedOrigins: [],
    bearer: undefined,
    publicUrl: new URL(`http://localhost:${port}/`),
    tokenSecret: "t".repeat(48),
    tokenSecretPrevious: undefined,
    rateLimitPerMin: 3,
    allowKeyHeader: true,
    trustProxy: 0,
    ...extra,
  };
}

let server: Server;
let base: string;

beforeAll(async () => {
  // Bind first to learn the port, then build the app with the matching public URL.
  const probe = await new Promise<Server>((r) => {
    const s = createHttpApp(config(1), { readFoundations }).app.listen(0, "127.0.0.1", () => r(s));
  });
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const { app } = createHttpApp(config(port), { validateKey, readFoundations });
  server = await new Promise<Server>((r) => {
    const s = app.listen(port, "127.0.0.1", () => r(s));
  });
  base = `http://localhost:${port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const REDIRECT = "http://127.0.0.1:9999/callback";

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function register(): Promise<string> {
  const res = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test Client <script>",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

async function startAuthorize(clientId: string, challenge: string): Promise<string> {
  const u = new URL(`${base}/authorize`);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-123",
    scope: "sxt:query",
    resource: `${base}/mcp`,
  }).toString();
  const res = await fetch(u, { redirect: "manual" });
  expect(res.status).toBe(200);
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  const html = await res.text();
  expect(html).not.toContain("<script>");
  const m = html.match(/name="consent" value="([^"]+)"/);
  expect(m).toBeTruthy();
  return m![1]!;
}

async function consent(consentToken: string, key: string, decision = "approve") {
  return fetch(`${base}/oauth/consent`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ consent: consentToken, sxt_api_key: key, decision }).toString(),
    redirect: "manual",
  });
}

async function token(params: Record<string, string>) {
  return fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

async function fullFlow() {
  const clientId = await register();
  const { verifier, challenge } = pkce();
  const c = await startAuthorize(clientId, challenge);
  const res = await consent(c, GOOD_KEY);
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const t = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT,
  });
  expect(t.status).toBe(200);
  return { clientId, tokens: (await t.json()) as { access_token: string; refresh_token: string; expires_in: number } };
}

/** POST a JSON-RPC message to /mcp and return the parsed result (SSE or JSON). */
async function rpc(headers: Record<string, string>, method: string, params: unknown = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  const json = dataLine ? JSON.parse(dataLine.slice(6)) : text ? JSON.parse(text) : undefined;
  return { status: res.status, headers: res.headers, json };
}

function toolError(json: { result?: { isError?: boolean; content?: Array<{ text: string }> } }) {
  expect(json.result?.isError).toBe(true);
  return JSON.parse(json.result!.content![0]!.text).error as { code: string; message: string; requestId: string; detail?: string };
}

describe("startup guards", () => {
  it("refuses public mode without a token secret", () => {
    expect(() => assertStartable(config(1, { tokenSecret: undefined }))).toThrow(/SXT_MCP_TOKEN_SECRET/);
  });
  it("refuses a static bearer in public mode", () => {
    expect(() => assertStartable(config(1, { bearer: "x" }))).toThrow(/local-mode/);
  });
  it("refuses a non-loopback local bind without a bearer", () => {
    expect(() =>
      assertStartable(config(1, { publicUrl: undefined, bindHost: "10.0.0.5", bindExplicit: true })),
    ).toThrow(/without SXT_MCP_HTTP_BEARER/);
  });
});

describe("discovery", () => {
  it("advertises protected-resource metadata pointing at this AS", async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    const meta = (await res.json()) as { resource: string; authorization_servers: string[] };
    expect(meta.resource).toBe(`${base}/mcp`);
    expect(meta.authorization_servers[0]).toContain(base);
  });

  it("advertises AS metadata with PKCE S256 and registration", async () => {
    const meta = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(meta.code_challenge_methods_supported).toContain("S256");
    expect(meta.registration_endpoint).toBe(`${base}/register`);
  });

  it("answers health probes regardless of Host", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(((await res.json()) as { mode: string }).mode).toBe("public");
  });

  it("challenges an unauthenticated /mcp call with the resource metadata URL", async () => {
    const r = await rpc({}, "tools/list");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("resource_metadata=");
  });
});

describe("OAuth with bring-your-own key", () => {
  it("issues sealed client ids", async () => {
    expect((await register()).startsWith("sxt_client_")).toBe(true);
  });

  it("re-renders the consent page when SXT rejects the key, and issues no code", async () => {
    const clientId = await register();
    const c = await startAuthorize(clientId, pkce().challenge);
    const res = await consent(c, "wrong-key-0123456789abcdef");
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("SXT did not accept that API key");
  });

  it("redirects with access_denied when the user cancels", async () => {
    const clientId = await register();
    const c = await startAuthorize(clientId, pkce().challenge);
    const res = await consent(c, "", "deny");
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("state")).toBe("st-123");
  });

  it("completes the code flow, then enforces PKCE and single use", async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const c = await startAuthorize(clientId, challenge);
    const res = await consent(c, GOOD_KEY);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("state")).toBe("st-123");
    const code = loc.searchParams.get("code")!;
    expect(code).not.toContain(GOOD_KEY);

    const wrong = await token({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: "x".repeat(43) });
    expect(wrong.status).toBe(400);

    const ok = await token({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT });
    expect(ok.status).toBe(200);
    const t = (await ok.json()) as { access_token: string; refresh_token: string; token_type: string };
    expect(t.access_token.startsWith("sxt_access_")).toBe(true);
    expect(t.access_token).not.toContain(GOOD_KEY);

    const replay = await token({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT });
    expect(replay.status).toBe(400);
  });

  it("refuses a code issued to another client", async () => {
    const a = await register();
    const b = await register();
    const { verifier, challenge } = pkce();
    const res = await consent(await startAuthorize(a, challenge), GOOD_KEY);
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    const t = await token({ grant_type: "authorization_code", client_id: b, code, code_verifier: verifier });
    expect(t.status).toBe(400);
  });

  it("rotates refresh tokens", async () => {
    const { clientId, tokens } = await fullFlow();
    const r1 = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token });
    expect(r1.status).toBe(200);
    const again = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token });
    expect(again.status).toBe(400);
  });
});

describe("hosted tool surface", () => {
  it("lists only the read-only allowlist for an OAuth caller", async () => {
    const { tokens } = await fullFlow();
    const r = await rpc({ authorization: `Bearer ${tokens.access_token}` }, "tools/list");
    expect(r.status).toBe(200);
    const names = (r.json.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(["sxt.generate_proof_plan", "sxt.get_proof_result", "sxt.run_proven_query"]);
  });

  it("rejects a forged bearer", async () => {
    const r = await rpc({ authorization: "Bearer sxt_access_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, "tools/list");
    expect(r.status).toBe(401);
  });

  it("refuses to call write tools that are not on the allowlist", async () => {
    const r = await rpc({ [`x-sxt-api-key`]: GOOD_KEY }, "tools/call", { name: "sxt.deploy_contract", arguments: {} });
    expect(r.json.result.content[0].text).toContain("Unknown tool");
  });

  it("routes the header key into the tool and refuses unproven SQL before any network call", async () => {
    const r = await rpc({ "x-sxt-api-key": "hdr-key-0123456789abcdef" }, "tools/call", {
      name: "sxt.run_proven_query",
      arguments: { tableRef: "A.B", sql: "SELECT X, ROW_NUMBER() OVER (ORDER BY X) FROM A.B" },
    });
    const e = toolError(r.json);
    expect(e.code).toBe("SQL_REJECTED");
    expect(e.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(e.detail).toBeUndefined();
  });

  it("refuses filesystem writes from generate_proof_plan", async () => {
    const r = await rpc({ "x-sxt-api-key": "hdr-key-fs-0123456789abcd" }, "tools/call", {
      name: "sxt.generate_proof_plan",
      arguments: { sql: "SELECT A FROM X.Y", outputPath: "/etc/owned.json" },
    });
    expect(toolError(r.json).message).toContain("outputPath is not available");
  });

  it("rate-limits per caller", async () => {
    const h = { "x-sxt-api-key": "hdr-key-rl-0123456789abcd" };
    const call = () =>
      rpc(h, "tools/call", { name: "sxt.run_proven_query", arguments: { tableRef: "A.B", sql: "SELECT COUNT(*) FROM A.B" } });
    const codes: string[] = [];
    for (let i = 0; i < 4; i++) codes.push(toolError((await call()).json).code);
    expect(codes.slice(0, 3)).toEqual(["SQL_REJECTED", "SQL_REJECTED", "SQL_REJECTED"]);
    expect(codes[3]).toBe("RATE_LIMITED");
  });

  it("rejects requests for a foreign Host", async () => {
    const res = await fetch(`${base.replace("localhost", "127.0.0.1")}/mcp`, { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("is stateless: GET /mcp is not a session stream", async () => {
    const res = await fetch(`${base}/mcp`);
    expect(res.status).toBe(405);
  });
});

describe("edge client IP (Workers)", () => {
  it("keys OAuth rate limits on the edge header and ignores a forged X-Forwarded-For", async () => {
    const probe = await new Promise<Server>((r) => {
      const s = createHttpApp(config(1), { readFoundations }).app.listen(0, "127.0.0.1", () => r(s));
    });
    const port = (probe.address() as AddressInfo).port;
    await new Promise((r) => probe.close(r));
    const { app } = createHttpApp(config(port), { validateKey, readFoundations, clientIpHeader: "cf-connecting-ip" });
    const edge = await new Promise<Server>((r) => {
      const s = app.listen(port, "127.0.0.1", () => r(s));
    });
    const reg = (ip: string, xff: string) =>
      fetch(`http://localhost:${port}/register`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip, "x-forwarded-for": xff },
        body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
      }).then((r) => Number(r.headers.get("ratelimit-remaining")));
    try {
      const a1 = await reg("203.0.113.7", "1.1.1.1");
      const a2 = await reg("203.0.113.7", "2.2.2.2");
      const b1 = await reg("198.51.100.9", "1.1.1.1");
      expect(a2).toBe(a1 - 1);
      expect(b1).toBe(a1);
    } finally {
      await new Promise<void>((r) => edge.close(() => r()));
    }
  });
});
