import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, createServer as createTCPServer, type Socket } from "node:net";
import { gzipSync } from "node:zlib";
import type { BridgeSession } from "../src/bridge-client";
import { attachBridgeIngress, shutdownBridgeIngress } from "../src/bridge-ingress";

const capHeader = "x-aperture-relay-capability";
const workerHeader = "x-aperture-worker-capability";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await shutdownBridgeIngress();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const directory = await mkdtemp("/tmp/ap-ingress-");
  await chmod(directory, 0o700);
  const socketPath = `${directory}/w.sock`;
  const server = createServer(handler);
  const sockets = new Set<Socket>();
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  const stop = async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  };
  cleanups.push(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const controller = new AbortController();
  let live = true;
  let closed = 0;
  const session: BridgeSession = { models: ["test"], capability: `aperture-worker-${"a".repeat(64)}`, socketPath,
    bun: "1.4.2", signal: controller.signal, alive: () => live, async refreshModels() { return ["test"]; }, async close() { closed++; } };
  const ingress = await attachBridgeIngress(session);
  return { ingress, session, stop, controller, dead() { live = false; }, closed: () => closed };
}
function send(ingress: { origin: string; capability: string }, extra: Record<string, string> = {}, body = "body") {
  return new Promise<{ status: number; headers: IncomingMessage["headers"]; body: Buffer }>((resolve, reject) => {
    const req = request(`${ingress.origin}/codex/responses`, { method: "POST", agent: false, headers: { [capHeader]: ingress.capability, ...extra } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
async function raw(origin: string, target: string, fields: string[], method = "POST") {
  const url = new URL(origin);
  return new Promise<number>((resolve, reject) => {
    const socket = connect(Number(url.port), "127.0.0.1");
    socket.on("error", reject);
    socket.on("data", data => { resolve(Number(data.toString().split(" ")[1])); socket.destroy(); });
    socket.on("connect", () => socket.write(`${method} ${target} HTTP/1.1\r\n${fields.join("\r\n")}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`));
  });
}
async function bound(origin: string) {
  const server = createTCPServer();
  const code = await new Promise<string>(resolve => {
    server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code!));
    server.listen(Number(new URL(origin).port), "127.0.0.1", () => { server.close(); resolve("BOUND"); });
  });
  expect(code).toBe("EADDRINUSE");
}

test("ingress forwards validated gateway and forward paths without rewriting them", async () => {
  const observed: string[] = [];
  const f = await fixture((req,res) => { observed.push(req.url!); req.resume(); res.end("ok"); });
  const host = `Host: ${new URL(f.ingress.origin).host}`;
  const cap = `${capHeader}: ${f.ingress.capability}`;
  for (const prefix of ["gateway","forward"]) for (const path of ["/v1/responses","/v1/chat/completions","/v1/messages",
    "/bedrock/model/a%3Ab/converse-stream", "/v1beta/models/gemini:streamGenerateContent?alt=sse"]) {
    const target = `/${prefix}${path}`;
    expect(await raw(f.ingress.origin,target,[host,cap])).toBe(200);
    expect(observed.at(-1)).toBe(target);
    expect(await raw(f.ingress.origin,target,[host,cap],"GET")).toBe(404);
  }
  for (const name of ["x-api-key","x-goog-api-key","cookie","x-amz-security-token"])
    expect(await raw(f.ingress.origin,"/gateway/v1/messages",[host,cap,`Connection: ${name}`])).toBe(403);
  expect(await raw(f.ingress.origin,"/gateway/v1/responses?url=https://evil.invalid",[host,cap])).toBe(404);
});
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++) await Bun.sleep(10);
  expect(predicate()).toBe(true);
}

test("transfers native opaque headers to the fixed Unix target and preserves compressed 500 bytes", async () => {
  const compressed = gzipSync("upstream failure");
  let observed: IncomingMessage | undefined;
  const f = await fixture((req, res) => {
    observed = req;
    req.resume();
    res.writeHead(500, { "content-encoding": "gzip", "content-length": compressed.length, "content-type": "application/octet-stream",
      connection: "x-response-hop", "x-response-hop": "secret", "proxy-authorization": "secret", [capHeader]: "secret", [workerHeader]: "secret" });
    res.end(compressed);
  });
  const native = { authorization: "Bearer opaque", "chatgpt-account-id": "account", "user-agent": "native-client", "session-id": "session",
    originator: "opencode", "content-type": "application/json", accept: "text/event-stream" };
  const result = await send(f.ingress, { ...native, connection: "x-hop", "x-hop": "secret", "proxy-authorization": "secret", [workerHeader]: "untrusted" });
  expect(result.status).toBe(500);
  expect(result.body).toEqual(compressed);
  expect(result.headers["content-encoding"]).toBe("gzip");
  expect(result.headers["content-length"]).toBe(String(compressed.length));
  expect(observed!.url).toBe("/codex/responses");
  expect(observed!.method).toBe("POST");
  for (const [name, value] of Object.entries(native)) expect(observed!.headers[name]).toBe(value);
  expect(observed!.headers.host).toBe("worker.internal");
  expect(observed!.headers[workerHeader]).toBe(f.session.capability);
  for (const name of [capHeader, "x-hop", "proxy-authorization"]) expect(observed!.headers[name]).toBeUndefined();
  for (const name of [capHeader, workerHeader, "x-response-hop", "proxy-authorization"]) expect(result.headers[name]).toBeUndefined();
});

test("raw target, Host, Origin and capability validation with a valid capability", async () => {
  let calls = 0;
  const f = await fixture((req, res) => { calls++; req.resume(); res.end(); });
  const host = `Host: ${new URL(f.ingress.origin).host}`;
  const cap = `${capHeader}: ${f.ingress.capability}`;
  for (const target of ["/codex/responses?", "/codex/responses?x=1", "/other", `${f.ingress.origin}/codex/responses`]) {
    expect(await raw(f.ingress.origin, target, [host, cap])).toBe(404);
  }
  expect(await raw(f.ingress.origin, "/codex/responses", [host, cap], "GET")).toBe(404);
  for (const fields of [[host, host, cap], ["Host: localhost:123", cap], [cap], [host, cap, "Origin:"],
    [host, cap, "Origin: https://example.com"], [host, cap, cap], [host], [host, `${capHeader}: wrong`]]) {
    expect([400, 403]).toContain(await raw(f.ingress.origin, "/codex/responses", fields));
  }
  for (const name of ["Authorization", "ChatGPT-Account-Id", "User-Agent", "session-id", "originator", "Content-Type", "Accept", capHeader, workerHeader]) {
    expect(await raw(f.ingress.origin, "/codex/responses", [host, cap, `Connection: ${name}`])).toBe(403);
  }
  expect(calls).toBe(0);
  expect(await raw(f.ingress.origin, "/codex/responses", [host, cap])).toBe(200);
});

test.each(["/codex/responses", "/gateway/v1/messages", "/forward/v1/chat/completions"])("streams request chunks before the producer finishes: %s", async path => {
  let first = "";
  let body = "";
  const f = await fixture((req, res) => {
    req.on("data", chunk => { first ||= chunk.toString(); body += chunk; });
    req.on("end", () => res.end(body));
  });
  const response = new Promise<string>((resolve, reject) => {
    const req = request(`${f.ingress.origin}${path}`, { method: "POST", agent: false, headers: { [capHeader]: f.ingress.capability } }, res => {
      let result = ""; res.on("data", chunk => { result += chunk; }); res.on("end", () => resolve(result));
    });
    req.on("error", reject);
    req.write("first");
    void until(() => first === "first").then(() => req.end("last"), reject);
  });
  expect(await response).toBe("firstlast");
});

test("one shared listener retains failed and detached capabilities without closing sessions", async () => {
  const a = await fixture((req, res) => { req.resume(); res.end("a"); });
  const b = await fixture((req, res) => { req.resume(); res.end("b"); });
  expect(a.ingress.origin).toBe(b.ingress.origin);
  expect(a.ingress.capability).toMatch(/^aperture-relay-[a-f0-9]{64}$/);
  expect(a.ingress.capability).not.toBe(b.ingress.capability);
  await a.stop();
  a.controller.abort();
  expect((await send(a.ingress)).status).toBe(503);
  await bound(a.ingress.origin);
  expect((await send(b.ingress)).body.toString()).toBe("b");
  await a.ingress.close(); await a.ingress.close();
  expect((await send(a.ingress)).status).toBe(403);
  await b.ingress.close();
  await bound(a.ingress.origin);
  expect(a.closed() + b.closed()).toBe(0);
});

test("liveness failure latches and all redirect statuses are blocked", async () => {
  let status = 300;
  const f = await fixture((req, res) => { req.resume(); res.writeHead(status, { location: "http://example.invalid/" }); res.end(); });
  for (status of [300, 301, 302, 304, 307, 308, 399]) expect((await send(f.ingress)).status).toBe(502);
  f.dead();
  expect((await send(f.ingress)).status).toBe(503);
  f.session.alive = () => true;
  expect((await send(f.ingress)).status).toBe(503);
});

test("concurrent streams cancel independently; session abort and detach cancel all remaining Unix requests", async () => {
  // Use Node for this fake peer: Bun 1.3 also omits server-side Unix close events.
  const directory = await mkdtemp("/tmp/ap-cancel-");
  await chmod(directory, 0o700);
  const socketPath = `${directory}/w.sock`;
  const peer = spawn("node", ["--input-type=module", "-e", `
    import { createServer } from 'node:http';
    let id = 0;
    createServer((req, res) => {
      const current = id++;
      req.socket.on('close', () => process.stdout.write('closed:' + current + '\\n'));
      req.resume();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\\n\\n');
    }).listen(${JSON.stringify(socketPath)}, () => process.stdout.write('ready\\n'));
  `], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  peer.stdout.on("data", chunk => { output += chunk; });
  const exited = new Promise<void>(resolve => peer.once("exit", () => resolve()));
  cleanups.push(async () => { peer.kill(); await exited; await rm(directory, { recursive: true, force: true }); });
  await until(() => output.includes("ready\n"));
  const controller = new AbortController();
  const session: BridgeSession = { models: [], capability: `aperture-worker-${"b".repeat(64)}`, socketPath,
    bun: "1.4.2", signal: controller.signal, alive: () => !controller.signal.aborted, async refreshModels() { return []; }, async close() {} };
  const f = { ingress: await attachBridgeIngress(session), controller };
  const start = () => new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(`${f.ingress.origin}/codex/responses`, { method: "POST", agent: false, headers: { [capHeader]: f.ingress.capability } }, res => {
      res.on("error", () => {}); res.once("data", () => resolve(res));
    });
    req.on("error", reject); req.end();
  });
  const a = await start();
  const b = await start();
  a.destroy();
  await until(() => output.includes("closed:0\n"));
  expect(b.destroyed).toBe(false);
  expect(output).not.toContain("closed:1\n");
  const c = await start();
  f.controller.abort();
  await until(() => b.destroyed && c.destroyed);
  await until(() => output.includes("closed:1\n") && output.includes("closed:2\n"));
  expect((await send(f.ingress)).status).toBe(503);
  const g = await fixture((req, res) => { req.resume(); res.write("stream"); });
  const active = request(`${g.ingress.origin}/codex/responses`, { method: "POST", headers: { [capHeader]: g.ingress.capability } });
  active.on("error", () => {});
  const reply = new Promise<IncomingMessage>(resolve => active.on("response", res => { res.on("error", () => {}); res.once("data", () => resolve(res)); }));
  active.end();
  const detached = await reply;
  await g.ingress.close();
  await until(() => detached.destroyed);
});

test("route limit is shared and detachment releases capacity", async () => {
  const f = await fixture((req, res) => { req.resume(); res.end(); });
  const attached = await Promise.all(Array.from({ length: 63 }, () => attachBridgeIngress(f.session)));
  await expect(attachBridgeIngress(f.session)).rejects.toThrow("ROUTE_LIMIT");
  await attached[0]!.close();
  const replacement = await attachBridgeIngress(f.session);
  expect(replacement.origin).toBe(f.ingress.origin);
});

test("the shared listener does not keep the parent process alive", async () => {
  const child = spawn(process.execPath, ["--eval", `
    const { attachBridgeIngress } = await import(${JSON.stringify(new URL("../src/bridge-ingress.ts", import.meta.url).pathname)});
    const route = await attachBridgeIngress({ models: [], capability: 'unused', socketPath: '/unused',
      bun: '1.4.2', signal: new AbortController().signal, alive: () => true, async close() {} });
    console.log(route.origin);
  `], { env: { ...process.env, BUN_BE_BUN: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 2000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    expect(timedOut).toBe(false);
    expect(code).toBe(0);
    expect(output).toMatch(/^http:\/\/127\.0\.0\.1:\d+\n$/);
  } finally { clearTimeout(timeout); child.kill(); }
});
