import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startBridgeWorker, type BridgeStart, type BridgeSession, type BridgeWorkerInput } from "../src/bridge-client";
import { resolveGatewayPath } from "../src/gateway-path";
import type { ProviderInfo } from "../src/aperture-codex-plugin";

const directory = await mkdtemp(join(tmpdir(), "aperture-bridge-"));
// Keep profiles outside the fixture/worker cwd, with a private parent for leases.
const stateRoot = await mkdtemp(join(tmpdir(), "aperture-bridge-state-"));
const workerPath = resolve(import.meta.dir, "../src/bridge-worker.ts");
const runtime = { mode: process.env.BUN_BE_BUN === "1" ? "opencode" : "external", executable: process.execPath } as const;
const capability = `aperture-worker-${"a".repeat(64)}`;
let sequence = 0;
afterAll(() => Promise.all([directory, stateRoot].map(path => rm(path, { recursive: true, force: true }))));
async function fixture(source: string) {
  const path = join(directory, `fixture-${sequence++}.js`);
  await writeFile(path, source);
  return path;
}
function options(extra: Partial<BridgeStart> = {}): BridgeStart {
  return { action: "enroll", gateway: "https://gateway.invalid", hostname: "test-worker", stateDir: directory,
    socketPath: join(directory, `worker-${sequence++}.sock`), timeoutMs: 2000, ...extra };
}
async function realOptions(extra: Partial<BridgeStart> = {}): Promise<BridgeStart> {
  return options({ stateDir: await mkdtemp(join(stateRoot, "profile-")), ...extra });
}
const prelude = `
const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
const ready = (extra = {}) => send({type:"ready", protocol:1, bun:"1.4.2", models:[], capability:${JSON.stringify(capability)}, ...extra});
setInterval(() => {}, 1000);
`;
async function protocol(source: string, extra: Partial<BridgeWorkerInput> = {}) {
  return startBridgeWorker({ runtime, workerPath: await fixture(prelude + source), start: options(), ...extra });
}
const hello = 'send({type:"hello",protocol:1,bun:"1.4.2"});';
const normal = `${hello} process.stdin.once("data", () => { ready(); });`;

test("catalog handshake requires complete providers and consistent flat models", async () => {
  for (const extra of [
    { models: [] },
    { models: [], providers: [{id:"p",models:[],compatibility:{bad:"secret"}}] },
    { models: [], providers: [{id:"p",models:["m"],compatibility:{}}] },
    { models: [], providers: [{id:"p",models:[],compatibility:{},requires_client_auth:"secret"}] },
  ]) await expect(protocol(`${hello} process.stdin.once("data", () => ready(${JSON.stringify(extra)}));`,
    {start:options({action:"connect",catalog:true})})).rejects.toThrow("PROTOCOL_ERROR");
  const session = await protocol(`${hello} process.stdin.once("data", () => ready({providers:[]}));`,
    {start:options({action:"connect",catalog:true})});
  expect(session.providers).toEqual([]);
  await session.close();
});

test("gateway path allowlist rejects traversal, arbitrary queries and absolute targets", () => {
  for (const path of ["https://evil.invalid/v1/responses", "//evil.invalid/v1/responses", "/gateway/v1/responses?",
    "/gateway/v1/responses?key=secret", "/gateway/v1/models", "/gateway/../codex/responses",
    "/gateway/v1beta/models/%2e%2e:generateContent", "/gateway/v1beta/models/a%252fb:generateContent",
    "/gateway/v1beta/models/a:streamGenerateContent?alt=json", "/gateway/v1beta/models/a:streamGenerateContent?alt=sse&alt=sse",
    "/forward/v1beta/models/a:generateContent?key=secret", "/gateway/bedrock/model/a/converse?x=1"])
    expect(resolveGatewayPath(path)).toBeUndefined();
});

test("real catalog worker retains all providers and atomically refreshes even an empty catalog", async () => {
  const providers: ProviderInfo[] = [{id:"managed",models:["a","shared"],compatibility:{anthropic:true}},
    {id:"explicit",models:["shared","b"],requires_client_auth:true,compatibility:{openai_responses:true}}];
  const modulePath = await fixture(`
    let n = 0;
    globalThis.fetch = async () => {
      n++;
      return Response.json(n === 1 ? ${JSON.stringify(providers.map(p => ({ ...p, description: "Gateway metadata not in the control protocol" })))} : n === 2 ? [{id:"bad"}] : []);
    };
    export async function createBridge() { return {httpProxyURL(){return "http://127.0.0.1:1";},async close(){}}; }
  `);
  const session = await startBridgeWorker({runtime,workerPath,start:await realOptions({modulePath,action:"connect",catalog:true})});
  try {
    expect(session.providers).toEqual(providers);
    expect(session.models).toEqual(["a","shared","b"]);
    await expect(session.refreshModels()).rejects.toThrow("DISCOVERY_FAILED");
    expect(session.providers).toEqual(providers);
    expect(session.models).toEqual(["a","shared","b"]);
    expect(await session.refreshModels()).toEqual([]);
    expect(session.providers).toEqual([]);
  } finally { await session.close(); }
});

test("gateway routes strip managed credentials, preserve forward auth and stream responses", async () => {
  const auth = {authorization:"Bearer synthetic", "x-api-key":"synthetic", "x-goog-api-key":"synthetic",
    "chatgpt-account-id":"synthetic",cookie:"synthetic", "x-amz-date":"synthetic", "x-amz-security-token":"synthetic"};
  const modulePath = await fixture(`
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/api/providers")) return Response.json([]);
      const body = await new Response(init.body).text();
      const expected = JSON.parse(body);
      if (String(url) !== "https://gateway.invalid" + expected.path) throw Error("path mismatch");
      for (const name of ${JSON.stringify(Object.keys(auth))}) {
        if (init.headers.has(name) !== expected.auth) throw Error("credential mismatch");
      }
      return new Response(new ReadableStream({start(c){
        c.enqueue(new TextEncoder().encode("data: first\\n\\n"));
        setTimeout(() => {c.enqueue(new TextEncoder().encode("data: last\\n\\n"));c.close();},20);
      }}),{headers:{"content-type":"text/event-stream"}});
    };
    export async function createBridge() { return {httpProxyURL(){return "http://127.0.0.1:1";},async close(){}}; }
  `);
  const session = await startBridgeWorker({runtime,workerPath,start:await realOptions({modulePath,action:"connect",catalog:true})});
  try {
    for (const prefix of ["gateway","forward"]) for (const path of ["/v1/responses","/v1/chat/completions","/v1/messages",
      "/bedrock/model/arn%3Aaws%3Abedrock%3Aus%3A123%3Amodel%2Ftest/converse", "/bedrock/model/test/converse-stream",
      "/v1beta/models/gemini:generateContent", "/v1beta/models/gemini:streamGenerateContent?alt=sse"]) {
      const reply = await unix(session,auth,`/${prefix}${path}`,JSON.stringify({path,auth:prefix === "forward"}));
      expect(reply.status).toBe(200);
      expect(reply.body).toBe("data: first\n\ndata: last\n\n");
    }
    expect((await unix(session,auth,"/gateway/v1beta/models/gemini:streamGenerateContent?key=synthetic&alt=sse",
      JSON.stringify({path:"/v1beta/models/gemini:streamGenerateContent?alt=sse",auth:false}))).status).toBe(200);
    for (const name of Object.keys(auth)) expect((await unix(session,{...auth,connection:name},"/gateway/v1/messages")).status).toBe(400);
    expect((await unix(session,{},"/gateway/v1/models")).status).toBe(404);
  } finally { await session.close(); }
});
async function dead(session: BridgeSession) {
  for (let i = 0; i < 200 && session.alive(); i++) await Bun.sleep(10);
  expect(session.alive()).toBe(false);
  expect(session.signal.aborted).toBe(true);
}

test("private handshake, fixed socket, exact session API and idempotent close", async () => {
  const start = options({ authKey: "synthetic-secret" });
  const session = await protocol(`${hello} process.stdin.once("data", chunk => {
    const start = JSON.parse(chunk);
    if (start.authKey !== "synthetic-secret" || start.socketPath !== ${JSON.stringify(start.socketPath)}) process.exit(2);
    ready();
  });`, { start });
  expect(Object.keys(session).sort()).toEqual(["alive", "bun", "capability", "close", "models", "refreshModels", "signal", "socketPath"]);
  expect(session.socketPath).toBe(start.socketPath);
  expect(session.capability).toBe(capability);
  expect(session.alive()).toBe(true);
  const closed = session.close();
  expect(session.close()).toBe(closed);
  expect(session.signal.aborted).toBe(true);
  await closed;
});

for (const version of ["1.3.14", "1.4.3", "1.5.0"]) test(`rejects ${version} before sending any input`, async () => {
  const observed = join(directory, `input-${version}`);
  await expect(protocol(`
    import { writeFileSync } from "node:fs";
    writeFileSync(${JSON.stringify(observed)}, "");
    process.stdin.on("data", chunk => writeFileSync(${JSON.stringify(observed)}, chunk));
    process.on("SIGTERM", () => setTimeout(() => process.exit(0), 50));
    send({type:"hello",protocol:1,bun:${JSON.stringify(version)}});
  `)).rejects.toThrow("UNSUPPORTED_RUNTIME");
  expect(await readFile(observed, "utf8")).toBe("");
});

for (const [name, source, code] of [
  ["malformed", 'process.stdout.write("private-secret\\n");', "PROTOCOL_ERROR"],
  ["line limit", 'process.stdout.write("x".repeat(65537));', "PROTOCOL_ERROR"],
  ["stderr limit", 'process.stderr.write("x".repeat(524289));', "OUTPUT_LIMIT"],
  ["wrong protocol", 'send({type:"hello",protocol:2,bun:"1.4.2"});', "PROTOCOL_ERROR"],
  ["early ready", "ready();", "PROTOCOL_ERROR"],
  ["unknown failure", `${hello} process.stdin.once("data", () => send({type:"failure",code:"secret"}));`, "PROTOCOL_ERROR"],
  ["worker supplied socket", `${hello} process.stdin.once("data", () => ready({socketPath:"/tmp/other"}));`, "PROTOCOL_ERROR"],
  ["fixture capability", `${hello} process.stdin.once("data", () => ready({capability:"worker-fixture-${"a".repeat(64)}"}));`, "PROTOCOL_ERROR"],
  ["non-browser auth", `${hello} process.stdin.once("data", () => send({type:"auth-required",url:"https://example.invalid"}));`, "PROTOCOL_ERROR"],
] as const) test(`sanitizes ${name}`, async () => {
  await expect(protocol(source)).rejects.toThrow(`Aperture bridge: ${code}`);
});

const refreshWorker = (response: string) => `${hello}
  let pending = "";
  process.stdin.on("data", chunk => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf("\\n")) >= 0) {
      const m = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
      if (m.type === "start") ready();
      if (m.type === "discover") { ${response} }
    }
  });`;

test("catalog refresh correlates replies and rejects partial catalog updates", async () => {
  const source = refreshWorker(`
    if (m.id === 1) send({type:"models",id:m.id,models:["fresh"],providers:[{id:"p",models:["fresh"],compatibility:{}}]});
    else {
      send({type:"models",id:1,models:["stale"],providers:[{id:"old",models:["stale"],compatibility:{}}]});
      send({type:"models",id:m.id,models:["partial"],providers:[{id:"p",models:["different"],compatibility:{}}]});
    }
  `).replace('if (m.type === "start") ready();', 'if (m.type === "start") ready({providers:[]});');
  const session = await protocol(source,{start:options({action:"connect",catalog:true})});
  try {
    expect(await session.refreshModels()).toEqual(["fresh"]);
    expect(session.providers?.[0]?.models).toEqual(["fresh"]);
    await expect(session.refreshModels()).rejects.toThrow("PROTOCOL_ERROR");
    expect(session.models).toEqual(["fresh"]);
    expect(session.providers?.[0]?.models).toEqual(["fresh"]);
  } finally { await session.close(); }
});

test("catalog control output remains bounded to 64 KiB", async () => {
  await expect(protocol(`${hello} process.stdin.once("data", () => ready({models:[],providers:[
    {id:"p",name:"x".repeat(65536),models:[],compatibility:{}}
  ]}));`,{start:options({action:"connect",catalog:true})})).rejects.toThrow("PROTOCOL_ERROR");
});

test("refresh coalesces, updates array contents, and preserves catalog on discovery error", async () => {
  const session = await protocol(refreshWorker(`setTimeout(() => send(m.id === 2
    ? {type:"models-error",id:m.id,code:"DISCOVERY_FAILED"}
    : {type:"models",id:m.id,models:["model-" + m.id]}), 20);`));
  try {
    const models = session.models;
    const first = session.refreshModels();
    expect(session.refreshModels()).toBe(first);
    expect(await first).toEqual(["model-1"]);
    expect(session.models).toBe(models);
    await expect(session.refreshModels()).rejects.toThrow("Aperture bridge: DISCOVERY_FAILED");
    expect(models).toEqual(["model-1"]);
    expect(session.alive()).toBe(true);
    expect(await session.refreshModels()).toEqual(["model-3"]);
  } finally { await session.close(); }
});

for (const response of [
  '{type:"models",id:m.id,models:["private", "private"]}',
  '{type:"models",id:m.id,models:[" "]}',
  '{type:"models",id:m.id,models:[]}',
  '{type:"models",id:m.id+1,models:["private"]}',
  '{type:"models-error",id:m.id,code:"private"}',
]) test(`refresh rejects malformed responses safely: ${response}`, async () => {
  const session = await protocol(refreshWorker(`send(${response});`));
  try {
    await expect(session.refreshModels()).rejects.toThrow("Aperture bridge: PROTOCOL_ERROR");
    expect(session.models).toEqual([]);
  } finally { await session.close(); }
});

test("refresh timeout ignores late known IDs without satisfying the next request", async () => {
  const session = await protocol(refreshWorker(`if (m.id === 2) {
    send({type:"models",id:1,models:["stale"]});
    setTimeout(() => send({type:"models",id:2,models:["fresh"]}), 20);
  }`));
  try {
    await expect(session.refreshModels()).rejects.toThrow("Aperture bridge: DISCOVERY_FAILED");
    expect(session.alive()).toBe(true);
    expect(await session.refreshModels()).toEqual(["fresh"]);
  } finally { await session.close(); }
}, 15000);

for (const eof of [false, true]) test(`pending refresh settles on ${eof ? "EOF" : "close"}`, async () => {
  const session = await protocol(refreshWorker(eof ? "process.exit(0);" : ""));
  const result = session.refreshModels().catch(error => error.message);
  if (!eof) await session.close();
  expect(await result).toMatch(eof ? /^Aperture bridge: WORKER_(EOF|EXITED)$/ : /^Aperture bridge: CLOSED$/);
  await session.close();
});

test("invalid inputs and upfront cancellation never spawn", async () => {
  for (const extra of [
    { socketPath: "relative.sock" }, { modulePath: "relative.js" }, { modulePath: "/tmp/module.ts" },
    { gateway: "http://gateway.invalid" }, { gateway: "https://user:secret@gateway.invalid" },
    { gateway: "https://gateway.invalid/path" }, { timeoutMs: 300001 }, { timeoutMs: 0 },
  ]) await expect(startBridgeWorker({ runtime, workerPath: "/does-not-exist", start: options(extra) })).rejects.toThrow("INVALID_START");
  await expect(startBridgeWorker({ runtime, workerPath: "/does-not-exist", start: options(), signal: AbortSignal.abort("secret") }))
    .rejects.toThrow("CANCELLED");
  await expect(protocol("", { start: options({ timeoutMs: 50 }) })).rejects.toThrow("STARTUP_TIMEOUT");
});

test("ambient environment, dotenv and bunfig preloads do not enter worker", async () => {
  const old = process.env.APERTURE_TEST_SECRET;
  process.env.APERTURE_TEST_SECRET = "secret";
  await writeFile(join(directory, ".env"), "DOTENV_SECRET=secret\n");
  await writeFile(join(directory, "bunfig.toml"), 'preload = ["./absent.js"]\n');
  try {
    const session = await protocol(`${hello} process.stdin.once("data", () => {
      if (Object.keys(process.env).some(key => !["PATH", "BUN_BE_BUN"].includes(key))) process.exit(2);
      ready();
    });`);
    await session.close();
  } finally {
    if (old === undefined) delete process.env.APERTURE_TEST_SECRET; else process.env.APERTURE_TEST_SECRET = old;
    await rm(join(directory, ".env")); await rm(join(directory, "bunfig.toml"));
  }
});

test("failure after ready aborts session but retains process until owner closes", async () => {
  const marker = join(directory, "retained");
  const session = await protocol(`import { writeFileSync } from "node:fs";
    ${hello} process.stdin.once("data", () => {
      ready(); setTimeout(() => send({type:"failure",code:"TRANSPORT_FAILED"}), 20);
      setTimeout(() => writeFileSync(${JSON.stringify(marker)}, "alive"), 100);
    });`);
  try { await dead(session); await Bun.sleep(150); expect(await readFile(marker, "utf8")).toBe("alive"); }
  finally { await session.close(); }
});

test("exit and cancellation latch a safe abort reason", async () => {
  const session = await protocol(`${hello} process.stdin.once("data", () => { ready(); setTimeout(() => process.exit(3), 20); });`);
  await dead(session); await session.close();
  expect(session.signal.reason.message).toMatch(/^Aperture bridge: WORKER_(EXITED|EOF)$/);
  const abort = new AbortController();
  const other = await protocol(normal, { signal: abort.signal });
  abort.abort("private-secret"); await dead(other); await other.close();
  expect(other.signal.reason.message).toBe("Aperture bridge: CANCELLED");
});

test("TERM gives the helper its graceful shutdown window", async () => {
  const marker = join(directory, "graceful");
  const session = await protocol(`import { writeFileSync } from "node:fs";
    process.on("SIGTERM", () => setTimeout(() => { writeFileSync(${JSON.stringify(marker)}, "closed"); process.exit(0); }, 250));
    ${normal}`);
  await session.close();
  expect(await readFile(marker, "utf8")).toBe("closed");
});

test("uncooperative worker is killed after seven-second grace, with bounded close", async () => {
  const session = await protocol(`process.on("SIGTERM", () => {}); ${normal}`);
  const before = Date.now();
  await session.close();
  expect(Date.now() - before).toBeGreaterThanOrEqual(6900);
  expect(Date.now() - before).toBeLessThan(9000);
}, 12000);

test("startup cancellation reaches bridge signal and closes a late factory result", async () => {
  const entered = join(directory, "factory-entered");
  const closed = join(directory, "late-factory-closed");
  const modulePath = await fixture(`import { writeFileSync } from "node:fs";
    export async function createBridge(options) {
      writeFileSync(${JSON.stringify(entered)}, "entered");
      await new Promise(resolve => options.signal.addEventListener("abort", () => setTimeout(resolve, 50), {once:true}));
      return { httpProxyURL() { throw Error("unused"); }, async close() { writeFileSync(${JSON.stringify(closed)}, "closed"); } };
    }`);
  const abort = new AbortController();
  const start = await realOptions({ modulePath });
  const starting = startBridgeWorker({ runtime, workerPath, start, signal: abort.signal });
  const rejected = starting.then(() => undefined, (error: Error) => error);
  try {
    for (let i = 0; i < 100 && !await Bun.file(entered).exists(); i++) await Bun.sleep(10);
    expect(await Bun.file(entered).exists()).toBe(true);
  } finally { abort.abort(); }
  expect((await rejected)?.message).toBe("Aperture bridge: CANCELLED");
  expect(await readFile(closed, "utf8")).toBe("closed");
  await expect(stat(start.stateDir + ".aperture-lock")).rejects.toHaveProperty("code", "ENOENT");
});

test("real worker imports explicit JS factory for enroll, forwards options and closes without listening", async () => {
  const closed = join(directory, "bridge-closed");
  const start = await realOptions({ browser: true, authKey: "synthetic-secret" });
  const modulePath = await fixture(`import { writeFileSync } from "node:fs";
    export async function createBridge(options) {
      if (options.hostname !== "test-worker" || options.stateDir !== ${JSON.stringify(start.stateDir)}
        || options.authKey !== "synthetic-secret" || options.startupTimeoutMs !== 2000 || !(options.signal instanceof AbortSignal)) throw Error("private");
      options.onAuthRequired({url:"https://login.invalid/private"});
      console.log("private dependency output");
      return { httpProxyURL() { throw Error("enroll must not use proxy"); },
        async close() { writeFileSync(${JSON.stringify(closed)}, "closed"); } };
    }`);
  const urls: string[] = [];
  const session = await startBridgeWorker({ runtime, workerPath, start: { ...start, modulePath }, onAuthRequired: url => urls.push(url) });
  try {
    expect(urls).toEqual(["https://login.invalid/private"]);
    expect(session.models).toEqual([]);
    expect(session.capability).toMatch(/^aperture-worker-[a-f0-9]{64}$/);
    expect(await stat(session.socketPath).catch(() => undefined)).toBeUndefined();
    expect((await stat(start.stateDir)).mode & 0o777).toBe(0o700);
    const marker = join(start.stateDir, ".opencode-aperture-profile");
    expect((await stat(marker)).mode & 0o777).toBe(0o600);
    expect(await readFile(marker, "utf8")).toBe("opencode-aperture local bridge profile v1\n");
    expect((await stat(start.stateDir + ".aperture-lock")).mode & 0o777).toBe(0o700);
  } finally { await session.close(); }
  expect(await readFile(closed, "utf8")).toBe("closed");
  await expect(stat(start.stateDir + ".aperture-lock")).rejects.toHaveProperty("code", "ENOENT");
});

test("real worker missing and throwing modules report only allowlisted errors", async () => {
  for (const [modulePath, code] of [
    [join(directory, "absent.js"), "MODULE_UNAVAILABLE"],
    [await fixture('throw {code:"synthetic-secret", message:"synthetic-secret"};'), "MODULE_UNAVAILABLE"],
    [await fixture('export function createBridge() { throw Error("private-secret"); }'), "BRIDGE_FAILED"],
  ]) {
    const start = await realOptions({ modulePath });
    const error = await startBridgeWorker({ runtime, workerPath, start }).then(() => undefined, error => error);
    expect(error.message).toBe(`Aperture bridge: ${code}`);
    await expect(stat(start.stateDir + ".aperture-lock")).rejects.toHaveProperty("code", "ENOENT");
  }
});

for (const code of [
  "AUTH_REQUIRED", "AUTH_FAILED", "STATE_UNSAFE", "STATE_LOCKED", "HELPER_UNAVAILABLE",
  "UNSUPPORTED_PLATFORM", "HELPER_FAILED", "CALLBACK_FAILED", "INVALID_OPTIONS", "CANCELLED", "CLOSED",
  "STARTUP_TIMEOUT", "PROTOCOL_ERROR", "synthetic-secret", "DISCOVERY_FAILED", "auth_failed", 123, null,
]) test(`real worker sanitizes factory rejection code ${code} and releases its lease`, async () => {
  const modulePath = await fixture(`export async function createBridge() {
    throw {code:${JSON.stringify(code)}, message:"synthetic-secret"};
  }`);
  const start = await realOptions({ modulePath, browser: true });
  const expected = typeof code === "string" && !["synthetic-secret", "DISCOVERY_FAILED", "auth_failed"].includes(code)
    ? code : "BRIDGE_FAILED";
  const error = await startBridgeWorker({ runtime, workerPath, start }).then(() => undefined, error => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe(`Aperture bridge: ${expected}`);
  expect(String(error)).not.toContain("synthetic-secret");
  await expect(stat(start.stateDir + ".aperture-lock")).rejects.toHaveProperty("code", "ENOENT");
});

test("real worker maps unsafe settings without exposing their details", async () => {
  const modulePath = await fixture('export function createBridge() { throw Error("must not run"); }');
  const start = await realOptions({ modulePath });
  await writeFile(join(start.stateDir, "foreign-state"), "synthetic-secret");
  const error = await startBridgeWorker({ runtime, workerPath, start }).then(() => undefined, error => error);
  expect(error.message).toBe("Aperture bridge: STATE_UNSAFE");
  await expect(stat(start.stateDir + ".aperture-lock")).rejects.toHaveProperty("code", "ENOENT");
});

test("real worker sanitizes connectivity errors and releases its lease", async () => {
  const modulePath = await fixture(`
    globalThis.fetch = async () => { throw {code:"synthetic-secret", message:"synthetic-secret"}; };
    export async function createBridge() { return {
      httpProxyURL() { return "http://127.0.0.1:1"; }, async close() {},
    }; }
  `);
  const start = await realOptions({ modulePath, action: "connect" });
  const error = await startBridgeWorker({ runtime, workerPath, start }).then(() => undefined, error => error);
  expect(error.message).toBe("Aperture bridge: DISCOVERY_CONNECTIVITY");
  await expect(stat(start.stateDir + ".aperture-lock")).rejects.toHaveProperty("code", "ENOENT");
});

test.each([
  [401, [], "DISCOVERY_UNAUTHORIZED"],
  [403, [], "DISCOVERY_FORBIDDEN"],
  [404, [], "DISCOVERY_NOT_FOUND"],
  [503, [], "DISCOVERY_HTTP_ERROR"],
  [200, {}, "DISCOVERY_INVALID_CATALOG"],
  [200, [{ id: "fixture", models: ["test"], compatibility: { openai_responses: true } }], "DISCOVERY_NO_PROVIDER"],
])("real worker reports sanitized discovery classification %s %j", async (status, catalog, code) => {
  const modulePath = await fixture(`
    globalThis.fetch = async () => Response.json(${JSON.stringify(catalog)}, {status:${status}});
    export async function createBridge() { return {
      httpProxyURL() { return "http://127.0.0.1:1"; }, async close() {},
    }; }
  `);
  const start = await realOptions({ modulePath, action: "connect" });
  await expect(startBridgeWorker({ runtime, workerPath, start })).rejects.toThrow(`Aperture bridge: ${code}`);
  await expect(stat(start.stateDir + ".aperture-lock")).rejects.toHaveProperty("code", "ENOENT");
});

test("real worker holds its profile lease until bridge close completes", async () => {
  const closing = join(directory, "lease-closing");
  const finish = join(directory, "lease-finish");
  const modulePath = await fixture(`import { existsSync, writeFileSync } from "node:fs";
    export async function createBridge() { return {
      httpProxyURL() { throw Error("unused"); },
      async close() {
        writeFileSync(${JSON.stringify(closing)}, "closing");
        while (!existsSync(${JSON.stringify(finish)})) await Bun.sleep(10);
      },
    }; }`);
  const start = await realOptions({ modulePath });
  const session = await startBridgeWorker({ runtime, workerPath, start });
  const contender = () => startBridgeWorker({ runtime, workerPath, start: options({ modulePath, stateDir: start.stateDir }) });
  try {
    await expect(contender()).rejects.toThrow("Aperture bridge: STATE_LOCKED");
    const closed = session.close();
    for (let i = 0; i < 100 && !await Bun.file(closing).exists(); i++) await Bun.sleep(10);
    expect(await Bun.file(closing).exists()).toBe(true);
    expect((await stat(start.stateDir + ".aperture-lock")).isDirectory()).toBe(true);
    await expect(contender()).rejects.toThrow("Aperture bridge: STATE_LOCKED");
    await writeFile(finish, "finish");
    await closed;
    await expect(stat(start.stateDir + ".aperture-lock")).rejects.toHaveProperty("code", "ENOENT");
    const next = await contender();
    await next.close();
    await expect(stat(start.stateDir + ".aperture-lock")).rejects.toHaveProperty("code", "ENOENT");
  } finally {
    await writeFile(finish, "finish");
    await session.close();
  }
});

test("real worker refreshes discovery and catalog errors leave inference usable", async () => {
  const modulePath = await fixture(`
    let discoveries = 0;
    globalThis.fetch = async url => {
      if (!String(url).endsWith("/api/providers")) return new Response("still usable");
      discoveries++;
      if (discoveries === 3) return new Response("private upstream body", {status:503});
      if (discoveries === 4) return Response.json([{id:"openai",models:[" "],requires_client_auth:true,compatibility:{openai_responses:true}}]);
      return Response.json([{id:"openai",models:["model-" + discoveries],requires_client_auth:true,compatibility:{openai_responses:true}}]);
    };
    export async function createBridge() { return {
      httpProxyURL() { return "http://127.0.0.1:1"; }, async close() {},
    }; }
  `);
  const session = await startBridgeWorker({ runtime, workerPath, start: await realOptions({modulePath, action:"connect"}) });
  try {
    expect(session.models).toEqual(["model-1"]);
    expect(await session.refreshModels()).toEqual(["model-2"]);
    for (let i = 0; i < 2; i++) {
      await expect(session.refreshModels()).rejects.toThrow("Aperture bridge: DISCOVERY_FAILED");
      expect(session.models).toEqual(["model-2"]);
      expect(session.alive()).toBe(true);
      expect((await unix(session)).body).toBe("still usable");
    }
    expect(await session.refreshModels()).toEqual(["model-5"]);
  } finally { await session.close(); }
});

test("repeated real-worker discovery has per-frame rather than lifetime control limits", async () => {
  const modulePath = await fixture(`
    globalThis.fetch = async () => Response.json([{id:"openai",models:["m".repeat(200)],
      requires_client_auth:true,compatibility:{openai_responses:true}}]);
    export async function createBridge() { return {
      httpProxyURL() { return "http://127.0.0.1:1"; }, async close() {},
    }; }
  `);
  const session = await startBridgeWorker({ runtime, workerPath, start: await realOptions({modulePath, action:"connect"}) });
  try {
    // Cross both the former 128 KiB input and 512 KiB output lifetime budgets.
    for (let i = 0; i < 3500; i++) await session.refreshModels();
    expect(session.models).toEqual(["m".repeat(200)]);
    expect(session.alive()).toBe(true);
  } finally { await session.close(); }
}, 15000);

function unix(session: BridgeSession, headers: Record<string, string> = {}, path = "/codex/responses", body = "synthetic-body") {
  return new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ socketPath: session.socketPath, method: "POST", path,
      headers: { host: "worker.internal", "x-aperture-worker-capability": session.capability, ...headers } }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      res.on("error", reject);
    });
    req.on("error", reject); req.end(body);
  });
}

for (const [stubDiscovery, failureMode] of [[false, "poll"], [true, "poll"], [true, "transport"], [true, "stream"]] as const) test(`Unix transport preserves auth and retains failed listener (${stubDiscovery ? "isolated discovery contract" : "production discovery helper"}, ${failureMode})`, async () => {
  // The approved module substitutes fetch inside this isolated worker: no network or real bridge.
  const modulePath = await fixture(`
    ${stubDiscovery ? `
    import { mock } from "bun:test";
    const helperPath = ${JSON.stringify(resolve(import.meta.dir, "../src/aperture-codex-plugin.ts"))};
    const original = { ...await import(helperPath) };
    mock.module(helperPath, () => ({ ...original, async fetchApertureProviders(host, request) {
      return (await request(new URL("/api/providers", host), {redirect:"error"})).json();
    } }));` : ""}
    let calls = 0, broken = false;
    globalThis.fetch = async (url, init) => {
      if (init.proxy !== "http://synthetic:" + calls + "@127.0.0.1:1/" || init.redirect !== "error") throw Error("unproxied");
      if (String(url).endsWith("/api/providers")) return Response.json([{id:"openai",models:["model-a","model-a"],requires_client_auth:true,compatibility:{openai_responses:true}}]);
      if (init.headers.get("authorization") !== "Bearer opaque-native" || init.headers.get("chatgpt-account-id") !== "opaque-account") throw Error("lost auth");
      if (init.headers.has("x-aperture-worker-capability") || init.headers.has("x-aperture-relay-capability") || init.headers.has("x-remove")) throw Error("leaked internal header");
      const text = await new Response(init.body).text();
      if (text === "break") { broken = true; throw Error("private-transport-error"); }
      if (text === "poll") broken = true;
      if (text === "stream" || text === "stream-error") {
        let timer;
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode("data: first\\n\\n"));
          timer = setTimeout(() => {
            if (text === "stream-error") controller.error(Error("private-stream-error"));
            else { controller.enqueue(new TextEncoder().encode("data: last\\n\\n")); controller.close(); }
          }, 250);
        }, cancel() { clearTimeout(timer); } }), {headers:{"content-type":"text/event-stream"}});
      }
      return new Response("data: " + text + "\\n\\n", { status: 429, headers: {"content-type":"text/event-stream","content-encoding":"gzip","content-length":"999"} });
    };
    export async function createBridge() { return {
      httpProxyURL() { if (broken) throw Error("dead helper"); return "http://synthetic:" + (++calls) + "@127.0.0.1:1/"; },
      async close() {},
    }; }
  `);
  const start = await realOptions({ modulePath, action: "connect" });
  const session = await startBridgeWorker({ runtime, workerPath, start });
  const auth = { authorization: "Bearer opaque-native", "chatgpt-account-id": "opaque-account" };
  try {
    expect(session.models).toEqual(["model-a"]);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await unix(session, { origin: "https://evil.invalid" })).status).toBe(403);
    expect((await unix(session, { host: "wrong" })).status).toBe(403);
    expect((await unix(session, { "x-aperture-worker-capability": "wrong" })).status).toBe(403);
    expect((await unix(session, {}, "/codex/responses?query")).status).toBe(404);
    expect((await unix(session, { ...auth, connection: "authorization" })).status).toBe(400);
    const response = await unix(session, { ...auth, connection: "x-remove", "x-remove": "secret", "x-aperture-relay-capability": "private" });
    expect(response.status).toBe(429);
    expect(response.body).toBe("data: synthetic-body\n\n");
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["content-length"]).toBeUndefined();
    expect(session.alive()).toBe(true);
    const first = await new Promise<string>((resolve, reject) => {
      const req = request({ socketPath: session.socketPath, method: "POST", path: "/codex/responses",
        headers: { host: "worker.internal", "x-aperture-worker-capability": session.capability, ...auth } }, res => {
        res.once("data", chunk => { resolve(chunk.toString()); res.destroy(); req.destroy(); });
        res.on("error", reject);
      });
      req.on("error", reject); req.end("stream");
    });
    expect(first).toBe("data: first\n\n");
    await Bun.sleep(30);
    expect(session.alive()).toBe(true);
    expect((await unix(session, auth)).status).toBe(429);
    if (failureMode === "poll") expect((await unix(session, auth, "/codex/responses", "poll")).status).toBe(429);
    else if (failureMode === "transport") expect((await unix(session, auth, "/codex/responses", "break")).status).toBe(503);
    else await expect(unix(session, auth, "/codex/responses", "stream-error")).rejects.toThrow();
    await dead(session);
    expect((await unix(session, auth)).status).toBe(503);
  } finally { await session.close(); }
  await expect(stat(start.stateDir + ".aperture-lock")).rejects.toHaveProperty("code", "ENOENT");
});
