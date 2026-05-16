#!/usr/bin/env node
/**
 * Day 1 verification smoke test.
 *
 * Spawns the compiled stdio MCP server and sends real JSON-RPC frames to
 * verify the Day 1 hardening landed without breaking existing behavior:
 *
 *   1. tools/list emits the four `annotations` blocks (readOnlyHint etc).
 *   2. sxt.audit_contract with a path inside the sandbox succeeds.
 *   3. sxt.audit_contract with a path outside the sandbox is refused.
 *   4. sxt.audit_contract with an unknown key (zod.strict) is refused.
 *
 * Zero network calls, zero API quota tick. Pure stdio protocol exercise.
 * Reusable on Day 2 to prove HTTP transport responds identically to stdio.
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_INDEX = resolve(HERE, "..", "dist", "index.js");

// ─── Tiny stdio JSON-RPC client ──────────────────────────────────────────────

function startServer(extraEnv = {}) {
  const child = spawn("node", [MCP_INDEX], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });

  let buffer = "";
  const queue = [];
  const waiters = [];

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (waiters.length) waiters.shift()(msg);
      else queue.push(msg);
    }
  });

  function send(payload) {
    child.stdin.write(JSON.stringify(payload) + "\n");
  }
  function recv() {
    return new Promise((res) => {
      if (queue.length) res(queue.shift());
      else waiters.push(res);
    });
  }
  async function request(method, params, id) {
    send({ jsonrpc: "2.0", id, method, params });
    while (true) {
      const msg = await recv();
      if (msg.id === id) return msg;
    }
  }

  return { child, send, request };
}

async function initialize(client) {
  await client.request(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "day1-smoke", version: "1.0.0" },
    },
    1,
  );
  client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
}

// ─── Cases ───────────────────────────────────────────────────────────────────

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const mark = pass ? "✓" : "✗";
  console.log(`${mark} ${name}${detail ? `  — ${detail}` : ""}`);
}

async function caseAnnotationsEmitted() {
  const client = startServer();
  try {
    await initialize(client);
    const res = await client.request("tools/list", {}, 2);
    const tools = res.result?.tools ?? [];
    const required = [
      "sxt.publish_dataset",
      "sxt.run_proven_query",
      "sxt.audit_contract",
      "sxt.deploy_contract",
    ];
    for (const name of required) {
      const t = tools.find((x) => x.name === name);
      if (!t) return check(`tools/list emits ${name}`, false, "tool missing");
      if (!t.annotations) return check(`${name} has annotations`, false, "annotations missing");
      const a = t.annotations;
      if (
        typeof a.readOnlyHint !== "boolean" ||
        typeof a.destructiveHint !== "boolean" ||
        typeof a.openWorldHint !== "boolean" ||
        typeof a.idempotentHint !== "boolean"
      ) {
        return check(`${name} annotation hints complete`, false, JSON.stringify(a));
      }
    }
    check("tools/list emits all 4 annotation blocks", true);
  } finally {
    client.child.kill();
  }
}

async function caseSandboxAcceptsInRoot(sandboxRoot, solPath) {
  const client = startServer({ SXT_MCP_AUDIT_ROOT: sandboxRoot });
  try {
    await initialize(client);
    const res = await client.request(
      "tools/call",
      {
        name: "sxt.audit_contract",
        arguments: { sourcePath: solPath, slither: false },
      },
      3,
    );
    if (res.result?.isError) {
      const text = res.result.content?.[0]?.text ?? "";
      check("audit_contract accepts in-sandbox path", false, text);
    } else {
      check("audit_contract accepts in-sandbox path", true);
    }
  } finally {
    client.child.kill();
  }
}

async function caseSandboxRejectsOutside(sandboxRoot, outsidePath) {
  const client = startServer({ SXT_MCP_AUDIT_ROOT: sandboxRoot });
  try {
    await initialize(client);
    const res = await client.request(
      "tools/call",
      {
        name: "sxt.audit_contract",
        arguments: { sourcePath: outsidePath, slither: false },
      },
      4,
    );
    const text = res.result?.content?.[0]?.text ?? "";
    const rejected = res.result?.isError && /outside the audit sandbox/i.test(text);
    check(
      "audit_contract refuses path outside sandbox",
      rejected,
      rejected ? "" : text || JSON.stringify(res.result),
    );
  } finally {
    client.child.kill();
  }
}

async function caseStrictRejectsUnknownKey(sandboxRoot) {
  const client = startServer({ SXT_MCP_AUDIT_ROOT: sandboxRoot });
  try {
    await initialize(client);
    const res = await client.request(
      "tools/call",
      {
        name: "sxt.audit_contract",
        arguments: { sourcePath: sandboxRoot, slither: false, totallyUnknownKey: "x" },
      },
      5,
    );
    const text = res.result?.content?.[0]?.text ?? "";
    const rejected = res.result?.isError && /unrecognized|unknown/i.test(text);
    check(
      "audit_contract rejects unknown key via zod.strict",
      rejected,
      rejected ? "" : text || JSON.stringify(res.result),
    );
  } finally {
    client.child.kill();
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  const sandboxDir = await mkdtemp(resolve(tmpdir(), "sxt-mcp-day1-"));
  const fooSol = resolve(sandboxDir, "Foo.sol");
  await writeFile(
    fooSol,
    "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\ncontract Foo {}\n",
  );

  try {
    await caseAnnotationsEmitted();
    await caseSandboxAcceptsInRoot(sandboxDir, fooSol);
    await caseSandboxRejectsOutside(sandboxDir, "/etc/hosts");
    await caseStrictRejectsUnknownKey(sandboxDir);
  } finally {
    await rm(sandboxDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
