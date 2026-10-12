/**
 * Owned prover poll loop (lib/prover.ts) against a scripted fake prover.
 * No network. The property that matters most: the submit call, the only one
 * that spends a credit, is made exactly once whatever else fails.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { ProverClient, clearTokenCache } from "../src/lib/prover.js";
import { sanitizeError } from "../src/lib/sanitize.js";

const EP = { prover: "https://prover.test", auth: "https://auth.test/apikey", rpc: "https://rpc.test/" };

type Step = (url: string, init: RequestInit) => Response | Error;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function netError(code = "ECONNRESET"): Error {
  return Object.assign(new TypeError("fetch failed"), { cause: { code } });
}

/** Routes each call by kind, consuming that kind's scripted responses in order. */
function fakeProver(script: Partial<Record<"auth" | "attest" | "submit" | "status" | "results", Step[]>>) {
  const calls: Record<string, number> = { auth: 0, attest: 0, submit: 0, status: 0, results: 0 };
  const defaults: Record<string, Step> = {
    auth: () => json({ accessToken: "jwt-1", accessTokenExpires: 0 }),
    attest: () => json({ result: { attestationsFor: "0xabc" } }),
    submit: () => json({ queryId: "q-12345678" }),
    status: () => json({ status: "done" }),
    results: () => json({ proof: "p" }),
  };
  const kindOf = (url: string, init: RequestInit) => {
    if (url === EP.auth) return "auth";
    if (url === EP.rpc) return "attest";
    if (url.endsWith("/status")) return "status";
    if (url.endsWith("/results")) return "results";
    if (url.endsWith("/v1/zkquery") && init.method === "POST") return "submit";
    throw new Error(`unexpected call ${url}`);
  };
  const fetch = async (url: string, init: RequestInit) => {
    const kind = kindOf(url, init);
    const i = calls[kind]!++;
    const step = script[kind]?.[i] ?? defaults[kind]!;
    const out = step(url, init);
    if (out instanceof Error) throw out;
    return out;
  };
  return { fetch, calls };
}

let clock = 0;
const deps = (fetch: ReturnType<typeof fakeProver>["fetch"]) => ({
  fetch,
  verify: (r: unknown) => ({ verified: r }),
  sleep: async (ms: number) => {
    clock += ms;
  },
  now: () => clock,
});

beforeEach(() => {
  clearTokenCache();
  clock = 1_000_000;
});

describe("ProverClient.prove", () => {
  it("runs the SDK's request sequence with the same submit body", async () => {
    let submitBody: unknown;
    const fp = fakeProver({
      submit: [
        (_u, init) => {
          submitBody = JSON.parse(String(init.body));
          return json({ queryId: "q-12345678" });
        },
      ],
      status: [() => json({ status: "running" }), () => json({ status: "done" })],
    });
    const out = await new ProverClient(EP, "key-1", deps(fp.fetch)).prove("SELECT 1", { waitMs: 60_000 });
    expect(out).toMatchObject({ state: "verified", queryId: "q-12345678", result: { verified: { proof: "p" } } });
    expect(submitBody).toEqual({
      sqlText: "SELECT 1",
      sourceNetwork: "mainnet",
      commitmentScheme: "HYPER_KZG",
      blockHash: "0xabc",
      timeout: null,
    });
    expect(fp.calls).toEqual({ auth: 1, attest: 1, submit: 1, status: 2, results: 1 });
  });

  it("survives dropped status and result requests without resubmitting", async () => {
    const fp = fakeProver({
      status: [() => netError(), () => json({}, 503), () => json({ status: "running" }), () => json({ status: "done" })],
      results: [() => netError("ETIMEDOUT"), () => json({ proof: "p" })],
    });
    const out = await new ProverClient(EP, "key-1", deps(fp.fetch)).prove("SELECT 1", { waitMs: 60_000 });
    expect(out.state).toBe("verified");
    expect(fp.calls.submit).toBe(1);
  });

  it("never retries a failed submit, and says why", async () => {
    const fp = fakeProver({ submit: [() => netError()] });
    const err = await new ProverClient(EP, "key-1", deps(fp.fetch))
      .prove("SELECT 1", { waitMs: 60_000 })
      .catch((e) => e);
    expect(fp.calls.submit).toBe(1);
    expect(String(err.message)).toContain("could spend a second credit");
    expect(sanitizeError(err).code).toBe("UPSTREAM_ERROR");
  });

  it("does not retry non-transient statuses on free calls", async () => {
    const fp = fakeProver({ auth: [() => json({ title: "No Api Key found" }, 404)] });
    const err = await new ProverClient(EP, "bad", deps(fp.fetch)).prove("SELECT 1", { waitMs: 60_000 }).catch((e) => e);
    expect(fp.calls.auth).toBe(1);
    expect(fp.calls.submit).toBe(0);
    expect(sanitizeError(err).code).toBe("SXT_KEY_INVALID");
  });

  it("classifies the subscription gate on submit", async () => {
    const fp = fakeProver({ submit: [() => json({ title: "Subscription required" }, 403)] });
    const err = await new ProverClient(EP, "key-1", deps(fp.fetch)).prove("SELECT 1", { waitMs: 60_000 }).catch((e) => e);
    expect(sanitizeError(err).code).toBe("SXT_SUBSCRIPTION_REQUIRED");
  });

  it("refreshes the JWT once on a 401 mid-poll", async () => {
    const fp = fakeProver({
      auth: [() => json({ accessToken: "jwt-1" }), () => json({ accessToken: "jwt-2" })],
      status: [
        () => json({}, 401),
        (_u, init) => json({ status: (init.headers as Record<string, string>).Authorization === "Bearer jwt-2" ? "done" : "bad" }),
      ],
    });
    const out = await new ProverClient(EP, "key-1", deps(fp.fetch)).prove("SELECT 1", { waitMs: 60_000 });
    expect(out.state).toBe("verified");
    expect(fp.calls.auth).toBe(2);
  });

  it("caches the JWT per key across queries", async () => {
    const fp = fakeProver({});
    const c = new ProverClient(EP, "key-1", deps(fp.fetch));
    await c.prove("SELECT 1", { waitMs: 60_000 });
    await c.prove("SELECT 2", { waitMs: 60_000 });
    expect(fp.calls.auth).toBe(1);
    await new ProverClient(EP, "key-2", deps(fp.fetch)).prove("SELECT 3", { waitMs: 60_000 });
    expect(fp.calls.auth).toBe(2);
  });

  it("returns a pending handle at the deadline, then resumes without a credit", async () => {
    const running = () => json({ status: "running" });
    const fp = fakeProver({ status: [running, running, running, running, running, running] });
    const c = new ProverClient(EP, "key-1", deps(fp.fetch));
    const first = await c.prove("SELECT 1", { waitMs: 2_000 });
    expect(first).toMatchObject({ state: "pending", queryId: "q-12345678", lastStatus: "running" });
    expect(fp.calls.results).toBe(0);

    const second = await c.resume("q-12345678", { waitMs: 60_000 });
    expect(second.state).toBe("verified");
    expect(fp.calls.submit).toBe(1);
  });

  it("reports a failed proof with the prover's own result text", async () => {
    const fp = fakeProver({
      status: [() => json({ status: "failed" })],
      results: [() => json({ error: "does not exist in source network MAINNET" })],
    });
    const err = await new ProverClient(EP, "key-1", deps(fp.fetch)).prove("SELECT 1", { waitMs: 60_000 }).catch((e) => e);
    expect(sanitizeError(err).code).toBe("TABLE_NOT_PROVABLE");
  });

  it("streams status as progress", async () => {
    const msgs: string[] = [];
    const fp = fakeProver({ status: [() => json({ status: "running" }), () => json({ status: "done" })] });
    await new ProverClient(EP, "key-1", deps(fp.fetch)).prove("SELECT 1", {
      waitMs: 60_000,
      onProgress: (m) => {
        msgs.push(m);
      },
    });
    expect(msgs[0]).toBe("authenticating with SXT");
    expect(msgs.some((m) => m.startsWith("submitted (queryId q-12345678)"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("prover status: running"))).toBe(true);
    expect(msgs.at(-1)).toBe("verifying proof locally");
  });

  it("rejects a malformed queryId on resume", async () => {
    const fp = fakeProver({});
    const err = await new ProverClient(EP, "k", deps(fp.fetch)).resume("../../etc", { waitMs: 1000 }).catch((e) => e);
    expect(sanitizeError(err).code).toBe("INVALID_ARGUMENTS");
    expect(fp.calls.status).toBe(0);
  });
});
