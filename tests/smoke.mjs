/**
 * Smoke test: spawn the server over stdio, run the MCP handshake,
 * list tools, call every tool, assert deterministic behavior.
 *
 *   npm test
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SERVER = path.join(ROOT, "src", "index.js");

let nextId = 1;
const proc = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });

const pending = new Map();
let buf = "";

proc.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

proc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

function request(method, params) {
  const id = nextId++;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 10000);
    pending.set(id, (resp) => {
      clearTimeout(timer);
      resolve(resp);
    });
    proc.stdin.write(msg);
  });
}

function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function callTool(name, args) {
  const resp = await request("tools/call", { name, arguments: args });
  if (resp.error) throw new Error(`${name} -> ${JSON.stringify(resp.error)}`);
  const out = resp.result;
  if (out.isError) throw new Error(`${name} returned isError: ${JSON.stringify(out.content)}`);
  return out.structuredContent || JSON.parse(out.content[0].text);
}

let passed = 0;
function check(label, cond, extra) {
  if (!cond) {
    console.error(`FAIL  ${label}${extra ? " :: " + JSON.stringify(extra) : ""}`);
    proc.kill();
    process.exit(1);
  }
  console.log(`PASS  ${label}`);
  passed++;
}

/* ------------------------------------------------------------- run */

// 1. handshake
const init = await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke-test", version: "0.0.1" }
});
check("initialize returns server info", init.result?.serverInfo?.name === "getoolkit-mcp", init.result);
notify("notifications/initialized", {});

// 2. list tools
const list = await request("tools/list", {});
const names = list.result.tools.map(t => t.name);
check("5 tools listed",
  ["hash_text", "timestamp_convert", "generate_uuid", "base64", "url_encode"]
    .every(n => names.includes(n)), names);

// 3. hash_text — cross-checked against Node crypto itself (same engine as site)
const sha = await callTool("hash_text", { algorithm: "sha256", text: "abc" });
const expectSha = crypto.createHash("sha256").update("abc").digest("hex");
check("hash_text sha256('abc') matches Node crypto", sha.digest === expectSha, sha);
check("sha256 digest is 64 hex chars", /^[0-9a-f]{64}$/.test(sha.digest), sha.digest);
const md5 = await callTool("hash_text", { algorithm: "md5", text: "abc" });
check("hash_text md5 is 32 hex chars", /^[0-9a-f]{32}$/.test(md5.digest), md5.digest);

// 4. timestamp_convert — number in (auto-detect ms vs s)
const tsMs = await callTool("timestamp_convert", { value: 1774848000000 });
check("epoch ms -> iso8601", tsMs.iso8601 === new Date(1774848000000).toISOString(), tsMs);
check("epoch ms -> utc_string", tsMs.utc_string === new Date(1774848000000).toUTCString(), tsMs);
const tsS = await callTool("timestamp_convert", { value: 1774848000 });
check("epoch s auto-detected (same instant as ms form)", tsS.iso8601 === tsMs.iso8601, { tsS: tsS.iso8601, tsMs: tsMs.iso8601 });
// string in -> epoch out (expected value derived from Date.parse, never hand-computed)
const tsStr = await callTool("timestamp_convert", { value: "2026-03-27T00:00:00.000Z" });
check("date string -> epoch seconds", tsStr.epoch_seconds === Math.floor(Date.parse("2026-03-27T00:00:00.000Z") / 1000), tsStr);

// 5. generate_uuid
const uuids = await callTool("generate_uuid", { count: 3 });
const v4re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
check("uuid v4 format + version/variant bits", uuids.uuids.length === 3 && uuids.uuids.every(u => v4re.test(u)), uuids);
check("uuids are distinct", new Set(uuids.uuids).size === 3);

// 6. base64 round-trip + URL-safe
const enc = await callTool("base64", { mode: "encode", text: "hello world" });
check("base64 encode", enc.result === Buffer.from("hello world").toString("base64"), enc);
const dec = await callTool("base64", { mode: "decode", text: enc.result });
check("base64 round-trip", dec.result === "hello world", dec);
const encU = await callTool("base64", { mode: "encode", text: "subjects?b", url_safe: true });
check("base64url uses -_ alphabet and no padding", !/[+/=]/.test(encU.result), encU.result);
const decU = await callTool("base64", { mode: "decode", text: encU.result });
check("base64url round-trip", decU.result === "subjects?b", decU);

// 7. url_encode
const ue = await callTool("url_encode", { mode: "encode", text: "a b&c=d?" });
check("url_encode component mode escapes reserved chars", ue.result === "a%20b%26c%3Dd%3F", ue);
const ud = await callTool("url_encode", { mode: "decode", text: ue.result });
check("url_decode round-trip", ud.result === "a b&c=d?", ud);

// 8. error path: bad date
const bad = await request("tools/call", { name: "timestamp_convert", arguments: { value: "not-a-date" } });
check("unparseable date returns isError", bad.result?.isError === true, bad.result);

proc.kill();
console.log(`\nAll ${passed} checks passed.`);
process.exit(0);
