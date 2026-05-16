#!/usr/bin/env node
/**
 * Day 2 HTTP transport smoke test.
 *
 * Spawns the compiled HTTP MCP server on an ephemeral high port and verifies:
 *
 *   1. tools/list exposes ONLY sxt.run_proven_query (read-only allowlist)
 *   2. The other three tools are NOT listed (no accidental write-surface leak)
 *   3. Calling a hidden tool by name returns "Unknown tool" (no bypass)
 *   4. Bad Host header → 403 (DNS rebinding defense)
 *   5. Cross-origin POST without allowlist → 403
 *   6. Bearer set but missing/wrong → 401 with WWW-Authenticate
 *   7. Initialize + tools/list happy path with valid bearer
 *
 * Zero network calls to SXT. Zero API quota tick. Pure protocol exercise.
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_HTTP = resolve(HERE, "..", "dist", "http.js");

const PORT = 30000 + Math.floor(Math.random() * 10000);
const BEARER = "test-bearer-" + Math.random().toString(36).slice(2);
const BASE = `http://127.0.0.1:${PORT}/mcp`;

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const mark = pass ? "✓" : "✗";
  console.log(`${mark} ${name}${detail ? `  — ${detail}` : ""}`);
}

// ─── Spawn server ────────────────────────────────────────────────────────────

function startServer(env = {}) {
  return new Promise((resolveStart, rejectStart) => {
    const child = spawn("node", [MCP_HTTP], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SXT_MCP_HTTP_PORT: String(PORT),
        SXT_MCP_BIND_HOST: "127.0.0.1",
        ...env,
      },
    });

    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      rejectStart(new Error(`server didn't start within 5s. stderr:\n${stderr}`));
    }, 5000);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.includes(`ready on http://127.0.0.1:${PORT}/mcp`)) {
        clearTimeout(timer);
        resolveStart(child);
      }
    });
    child.on("error", rejectStart);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) rejectStart(new Error(`server exited ${code}: ${stderr}`));
    });
  });
}

// ─── JSON-RPC over HTTP helper ───────────────────────────────────────────────

function rpc(method, params, id, { sessionId, bearer, origin, host } = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;
  if (origin) headers["origin"] = origin;
  if (host) headers["host"] = host;
  return fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

/** Read a Streamable HTTP response body, whether it's plain JSON or an SSE
 *  stream of one event. Returns the parsed JSON-RPC frame. */
async function readRpcResponse(res) {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (ct.includes("application/json")) {
    return JSON.parse(text);
  }
  // SSE: lines `event: message` / `data: {...}` / blank line. Find the first
  // `data:` line and parse it.
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error(`no data line in SSE response: ${text}`);
  return JSON.parse(line.slice(5).trim());
}

async function initialize(opts = {}) {
  const res = await rpc(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "day2-http-smoke", version: "1.0.0" },
    },
    1,
    opts,
  );
  const sessionId = res.headers.get("mcp-session-id");
  await readRpcResponse(res); // drain
  // Send notifications/initialized to satisfy the protocol lifecycle.
  await fetch(BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
      ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  return sessionId;
}

// ─── Cases ───────────────────────────────────────────────────────────────────

async function caseToolsListReadOnly(child) {
  const sessionId = await initialize();
  const res = await rpc("tools/list", {}, 2, { sessionId });
  const frame = await readRpcResponse(res);
  const tools = frame.result?.tools ?? [];
  const names = tools.map((t) => t.name).sort();
  const onlyAllowed =
    names.length === 1 && names[0] === "sxt.run_proven_query";
  check(
    "tools/list exposes ONLY sxt.run_proven_query",
    onlyAllowed,
    onlyAllowed ? "" : `got: ${names.join(", ")}`,
  );

  const hidden = ["sxt.publish_dataset", "sxt.audit_contract", "sxt.deploy_contract"];
  for (const h of hidden) {
    const present = names.includes(h);
    check(`tools/list hides ${h}`, !present, present ? "tool leaked into HTTP" : "");
  }
}

async function caseHiddenToolRejected(child) {
  const sessionId = await initialize();
  // Try to invoke audit_contract — it's a real handler in buildServer's union
  // but not registered in the HTTP-filtered tools. Must return "Unknown tool".
  const res = await rpc(
    "tools/call",
    { name: "sxt.audit_contract", arguments: { sourcePath: "/etc/hosts" } },
    3,
    { sessionId },
  );
  const frame = await readRpcResponse(res);
  const text = frame.result?.content?.[0]?.text ?? "";
  const rejected = frame.result?.isError && /unknown tool/i.test(text);
  check(
    "hidden tool sxt.audit_contract is unreachable over HTTP",
    rejected,
    rejected ? "" : text || JSON.stringify(frame),
  );
}

async function caseBadHostRejected(child) {
  // Custom Host header points at a non-loopback name. The fetch API in Node
  // forbids setting Host directly on some Node versions — use undici via a
  // raw socket instead. Simpler: hit the server with a Host header through
  // the request init `headers` field (Node 20+ allows this).
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      // Setting `host` here may be silently overridden by Node's HTTP client
      // on some versions. Use a header name that the server reads from
      // `req.headers.host` reliably: send via http.request directly.
      host: "evil.example.com",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "1" } },
    }),
  });
  // Node's fetch silently rewrites Host. So this case actually verifies the
  // server doesn't *crash* on a manipulated header — meaningful rejection
  // requires a raw socket. We do that below in caseBadHostRawSocket.
  const ok = res.status === 200 || res.status === 403;
  check(
    "fetch-with-Host-override doesn't crash server",
    ok,
    `status=${res.status}`,
  );
}

async function caseBadHostRawSocket(child) {
  const { connect } = await import("node:net");
  return new Promise((resolveCase) => {
    const sock = connect({ host: "127.0.0.1", port: PORT }, () => {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "x", version: "1" },
        },
      });
      const req =
        "POST /mcp HTTP/1.1\r\n" +
        "Host: evil.example.com\r\n" +
        "Content-Type: application/json\r\n" +
        "Accept: application/json, text/event-stream\r\n" +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        "\r\n" +
        body;
      sock.write(req);
    });
    let chunks = "";
    sock.on("data", (d) => (chunks += d.toString("utf8")));
    sock.on("end", () => {
      const rejected =
        /HTTP\/1\.1 403/.test(chunks) && /host not allowed/.test(chunks);
      check(
        "raw socket with bad Host header → 403",
        rejected,
        rejected ? "" : chunks.split("\r\n").slice(0, 2).join(" | "),
      );
      resolveCase();
    });
    sock.on("error", (e) => {
      check("raw socket with bad Host header → 403", false, e.message);
      resolveCase();
    });
  });
}

async function caseCrossOriginRejected(child) {
  const res = await rpc(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "day2-http-smoke", version: "1.0.0" },
    },
    1,
    { origin: "https://malicious.example" },
  );
  const rejected = res.status === 403;
  check(
    "cross-origin POST without allowlist → 403",
    rejected,
    rejected ? "" : `status=${res.status}`,
  );
}

async function caseBearerEnforced(child) {
  // Missing bearer
  const noBearer = await rpc(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "x", version: "1" },
    },
    1,
  );
  check(
    "bearer set + no Authorization header → 401",
    noBearer.status === 401,
    `status=${noBearer.status}`,
  );
  const wwwAuth = noBearer.headers.get("www-authenticate") ?? "";
  check(
    "401 carries WWW-Authenticate: Bearer",
    /Bearer/i.test(wwwAuth),
    wwwAuth || "(missing)",
  );

  // Wrong bearer
  const wrongBearer = await rpc(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "x", version: "1" },
    },
    1,
    { bearer: "totally-wrong-token" },
  );
  check(
    "wrong bearer → 401",
    wrongBearer.status === 401,
    `status=${wrongBearer.status}`,
  );

  // Correct bearer → initialize succeeds → tools/list returns the allowlist
  const sessionId = await initialize({ bearer: BEARER });
  const list = await rpc("tools/list", {}, 2, { sessionId, bearer: BEARER });
  const frame = await readRpcResponse(list);
  const tools = frame.result?.tools ?? [];
  check(
    "correct bearer + tools/list returns 1 tool",
    tools.length === 1 && tools[0].name === "sxt.run_proven_query",
    `got ${tools.length} tools`,
  );
}

// ─── Run ─────────────────────────────────────────────────────────────────────

async function runGroup(envExtras, fn) {
  const child = await startServer(envExtras);
  try {
    await fn(child);
  } finally {
    child.kill();
    // brief drain so spawn output flushes
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function main() {
  // Group A: no bearer (loopback-only)
  await runGroup({}, async (child) => {
    await caseToolsListReadOnly(child);
    await caseHiddenToolRejected(child);
    await caseBadHostRejected(child);
    await caseBadHostRawSocket(child);
    await caseCrossOriginRejected(child);
  });

  // Group B: with bearer
  await runGroup({ SXT_MCP_HTTP_BEARER: BEARER }, async (child) => {
    await caseBearerEnforced(child);
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
