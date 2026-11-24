import { describe, expect, it } from "vitest";
import { Sealer, deriveKey, principalId, SealError } from "../src/lib/sealed.js";
import { sanitizeError, ToolError, UpstreamError } from "../src/lib/sanitize.js";
import { RateLimiter } from "../src/lib/rate-limit.js";
import { redact } from "../src/lib/logger.js";
import { MainnetGateError } from "../src/lib/errors.js";
import { proofLogFields } from "../src/core.js";

const SECRET_A = "a".repeat(40);
const SECRET_B = "b".repeat(40);

describe("Sealer", () => {
  const sealer = new Sealer(deriveKey(SECRET_A, 1));

  it("round-trips a payload", () => {
    const t = sealer.seal("access", { k: "key-123", scopes: ["sxt:query"] }, 60);
    expect(t.startsWith("sxt_access_")).toBe(true);
    const p = sealer.open<{ k: string }>("access", t);
    expect(p.k).toBe("key-123");
  });

  it("never exposes the payload in the token", () => {
    const t = sealer.seal("access", { k: "very-secret-api-key" }, 60);
    expect(t).not.toContain("very-secret-api-key");
    expect(Buffer.from(t.slice("sxt_access_".length), "base64url").toString("latin1")).not.toContain("very-secret");
  });

  it("rejects a token presented as another type", () => {
    const t = sealer.seal("refresh", { k: "x" }, 60);
    const forged = t.replace("sxt_refresh_", "sxt_access_");
    expect(() => sealer.open("access", forged)).toThrow(SealError);
  });

  it("rejects a tampered token", () => {
    const t = sealer.seal("access", { k: "x" }, 60);
    const body = Buffer.from(t.slice("sxt_access_".length), "base64url");
    body[body.length - 20]! ^= 0xff;
    expect(() => sealer.open("access", "sxt_access_" + body.toString("base64url"))).toThrow(/authentication/);
  });

  it("rejects an expired token", () => {
    const t = sealer.seal("access", { k: "x" }, -1);
    expect(() => sealer.open("access", t)).toThrow(/expired/);
  });

  it("opens tokens from the previous secret during rotation, not from an unknown one", () => {
    const old = new Sealer(deriveKey(SECRET_A, 0));
    const rotated = new Sealer(deriveKey(SECRET_B, 1), [deriveKey(SECRET_A, 0)]);
    const t = old.seal("access", { k: "x" }, 60);
    expect(rotated.open<{ k: string }>("access", t).k).toBe("x");
    const stranger = new Sealer(deriveKey(SECRET_B, 1));
    expect(() => stranger.open("access", t)).toThrow(/unknown key/);
  });

  it("refuses short secrets", () => {
    expect(() => deriveKey("short", 1)).toThrow(/32/);
  });

  it("derives a stable, non-reversible principal", () => {
    expect(principalId("k1")).toBe(principalId("k1"));
    expect(principalId("k1")).not.toBe(principalId("k2"));
    expect(principalId("k1")).not.toContain("k1");
  });
});

describe("sanitizeError", () => {
  it("classifies the stale-key 404 from /auth/apikey", () => {
    const e = sanitizeError(new UpstreamError("Prover", "404: No Api Key found with the given apikey"));
    expect(e.code).toBe("SXT_KEY_INVALID");
    expect(e.message).not.toContain("404");
  });

  it("classifies the subscription gate", () => {
    expect(sanitizeError(new UpstreamError("Prover", "403: Forbidden")).code).toBe("SXT_SUBSCRIPTION_REQUIRED");
  });

  it("classifies a table missing from the MAINNET catalog", () => {
    const e = sanitizeError(new UpstreamError("Prover", '422 "does not exist in source network MAINNET"'));
    expect(e.code).toBe("TABLE_NOT_PROVABLE");
  });

  it("classifies an expired or foreign queryId as non-retryable", () => {
    // Exact prover text from a resume of an expired query on 2026-11-23.
    const e = sanitizeError(
      new UpstreamError(
        "Prover",
        `status poll failed: GET /v1/zkquery/{id}/status: 404: {"type":"CLIENT: Resource does not exist","title":"Query not found","detail":"Could not find query 'ee6cb902-aab2-4cf1-9601-cddc4ea0a5e7'"}`,
      ),
    );
    expect(e.code).toBe("QUERY_NOT_FOUND");
    expect(e.retryable).toBe(false);
    expect(e.message).not.toContain("404");
  });

  it("does not let the troubleshooting hint drive classification", () => {
    const e = sanitizeError(new UpstreamError("Prover", "connection reset", "raw API key passed as Bearer (401)"));
    expect(e.code).toBe("UPSTREAM_ERROR");
    expect(e.retryable).toBe(true);
  });

  it("passes our own messages through and keeps upstream text out of `message`", () => {
    expect(sanitizeError(new ToolError("SQL_REJECTED", "no OVER")).message).toBe("no OVER");
    expect(sanitizeError(new MainnetGateError("x")).code).toBe("MAINNET_GATE");
    const internal = sanitizeError(new Error("stack /srv/app/secret path"));
    expect(internal.code).toBe("INTERNAL");
    expect(internal.message).not.toContain("/srv");
    expect(internal.detail).toContain("/srv");
  });
});

describe("RateLimiter", () => {
  it("allows a burst, then refills over time", () => {
    const rl = new RateLimiter(2);
    const t0 = 1_000_000;
    expect(rl.take("p", t0)).toBe(0);
    expect(rl.take("p", t0)).toBe(0);
    expect(rl.take("p", t0)).toBeGreaterThan(0);
    expect(rl.take("other", t0)).toBe(0);
    expect(rl.take("p", t0 + 30_000)).toBe(0);
  });
});

describe("redact", () => {
  it("scrubs sealed tokens, JWTs and private keys", () => {
    const line = redact(
      "tok=sxt_access_AAAAbbbbCCCC jwt=eyJhbGciOi.eyJzdWIi.sig pk=0x" + "ab".repeat(32),
    );
    expect(line).not.toContain("AAAAbbbb");
    expect(line).not.toContain("eyJzdWIi");
    expect(line).toContain("[REDACTED-PRIVATE-KEY]");
  });
});

describe("proofLogFields", () => {
  it("keeps proof status and queryId, never rows or SQL", () => {
    const fields = proofLogFields({
      status: "verified",
      queryId: "ee6cb902-aab2-4cf1-9601-cddc4ea0a5e7",
      sql: "SELECT * FROM T LIMIT 1",
      rows: [{ A: 1 }],
    });
    expect(fields).toEqual({ status: "verified", queryId: "ee6cb902-aab2-4cf1-9601-cddc4ea0a5e7" });
  });

  it("logs a pending proof distinctly", () => {
    expect(proofLogFields({ status: "pending", queryId: "q1234567" })).toEqual({
      status: "pending",
      queryId: "q1234567",
    });
  });

  it("adds nothing for results without proof fields", () => {
    expect(proofLogFields({ tables: [] })).toEqual({});
    expect(proofLogFields(null)).toEqual({});
    expect(proofLogFields({ status: 1 })).toEqual({});
  });
});
