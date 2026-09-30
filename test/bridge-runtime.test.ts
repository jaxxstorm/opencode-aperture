import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "aperture-pool-"));
const workerPath = join(directory, "worker.js");
const runnerPath = join(directory, "runner.ts");
afterAll(() => rm(directory, { recursive: true, force: true }));

// Only the isolated test process redirects the worker path. The real supervisor,
// private socket directories, and ingress remain in use; no live bridge is needed.
await writeFile(workerPath, `
import { createServer } from "node:http";
const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
const providers = models => [{id:"openai",models,requires_client_auth:true,compatibility:{openai_responses:true}}];
send({ type: "hello", protocol: 1, bun: "1.4.2" });
let catalogError = false;
let pending = "";
process.stdin.on("data", chunk => {
  pending += chunk;
  let end;
  while ((end = pending.indexOf("\\n")) >= 0) {
    const m = JSON.parse(pending.slice(0,end)); pending = pending.slice(end+1);
    if (m.type === "discover") send(catalogError ? {type:"models-error",id:m.id,code:"DISCOVERY_FAILED"}
      : {type:"models",id:m.id,models:["model-a", "model-" + m.id],providers:providers(["model-a", "model-" + m.id])});
  }
});
process.stdin.once("data", chunk => {
  const start = JSON.parse(chunk);
  if (start.catalog !== true) process.exit(2);
  if (start.hostname === "startup-fail") { send({type:"failure",code:"BRIDGE_FAILED"}); return; }
  if (start.hostname === "pending") { setInterval(() => {}, 1000); return; }
  const server = createServer((req, res) => {
    catalogError = req.headers["x-catalog-error"] === "1";
    if (req.headers["x-break"]) send({type:"failure",code:"TRANSPORT_FAILED"});
    res.end("ok");
  });
  setTimeout(() => server.listen(start.socketPath, () => send({ type:"ready", protocol:1,
    bun:"1.4.2", models:["model-a"], providers:providers(["model-a"]), capability:"aperture-worker-" + "a".repeat(64) })), 100);
});
`);

await writeFile(runnerPath, `
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { request } from "node:http";
const clientPath = ${JSON.stringify(resolve(import.meta.dir, "../src/bridge-client.ts"))};
const settingsPath = ${JSON.stringify(resolve(import.meta.dir, "../src/bridge-settings.ts"))};
const client = { ...await import(clientPath) };
const settings = { ...await import(settingsPath) };
let starts = 0;
let settingsError;
const sockets = [];
let current = {version:1, bridge:{enabled:true, gateway:"https://settings.invalid", hostname:"test",
  stateDir:${JSON.stringify(directory)}, runtime:{mode:"external",executable:process.execPath},
  authKeyEnv:"POOL_TEST_AUTH", startupTimeoutMs:2000}};
mock.module(clientPath, () => ({...client, startBridgeWorker: input => {
  starts++;
  assert.equal(input.workerPath, ${JSON.stringify(resolve(import.meta.dir, "../src/bridge-worker.js"))});
  return client.startBridgeWorker({...input, workerPath:${JSON.stringify(workerPath)}});
}}));
mock.module(settingsPath, () => ({...settings, loadBridgeSettings:async () => {if(settingsError) throw settingsError; return current;},
  createBridgeSocketDir:async () => {const socket = await settings.createBridgeSocketDir(); sockets.push(socket); return socket;}}));
const {acquireBridgeRuntime: acquire, bridgeRuntimeKey:key} = await import(${JSON.stringify(resolve(import.meta.dir, "../src/bridge-runtime.ts"))});
const gateway = "https://override.invalid";
const b = current.bridge;
const gone = async () => {for (const socket of sockets) await assert.rejects(stat(socket.directory), {code:"ENOENT"});};
const scenario = process.argv[2];
if (scenario === "shared") {
  const first = acquire(b, gateway);
  process.env.POOL_TEST_AUTH = "synthetic-secret";
  const second = acquire({...b, gateway:"https://ignored.invalid"}, gateway);
  const [a,c] = await Promise.all([first,second]);
  assert.equal(starts,1); assert.equal(sockets.length,1); assert.equal(a.session,c.session);
  assert(!key(b,gateway).includes("synthetic-secret"));
  assert.equal(key({...b,runtime:{mode:"external"}},gateway),
    key({...b,runtime:{mode:"external",executable:Bun.which("bun")}},gateway));
  assert.notEqual(key(b,gateway),key({...b,runtime:{mode:"external",executable:"/other/bun"}},gateway));
  await a.release(); await a.release(); assert(c.session.alive());
  await stat(dirname(c.session.socketPath));
  await c.release(); assert(!c.session.alive()); await gone();
  const next = await acquire(b,gateway); assert.equal(starts,2); await next.release(); await gone();
} else if (scenario === "refresh") {
  const a = await acquire(b,gateway);
  assert.deepEqual(a.session.models,["model-a"]);
  const c = await acquire(b,gateway);
  assert.equal(a.session,c.session); assert.equal(starts,1);
  assert.deepEqual(c.session.models,["model-a","model-1"]);
  assert.deepEqual(c.session.providers[0].models,c.session.models);
  const call = headers => new Promise((yes,no) => {
    const req = request({socketPath:a.session.socketPath,headers},res => {res.resume();res.on("end",yes);});
    req.on("error",no); req.end();
  });
  await call({"x-catalog-error":"1"});
  await assert.rejects(acquire(b,gateway),/DISCOVERY_FAILED/);
  assert(a.session.alive()); assert.equal(starts,1);
  assert.deepEqual(a.session.models,["model-a","model-1"]);
  assert.deepEqual(a.session.providers[0].models,a.session.models);
  await call({});
  await c.release();
  const d = await acquire(b,gateway);
  assert.deepEqual(d.session.models,["model-a","model-3"]);
  await d.release(); assert(a.session.alive()); await a.release(); await gone();
} else if (scenario === "distinct") {
  const variants = [b, {...b,hostname:"other"}, {...b,stateDir:b.stateDir+"-other"},
    {...b,modulePath:"/tmp/other.js"}, {...b,authKeyEnv:"OTHER_AUTH"},
    {...b,startupTimeoutMs:2100}, {...b,runtime:{...b.runtime,mode:"opencode"}}];
  const leases = await Promise.all(variants.map(v => acquire(v,gateway)));
  leases.push(await acquire(b,"https://other.invalid"));
  assert.equal(starts,8); assert.equal(new Set(leases.map(l => l.session)).size,8);
  await Promise.all(leases.map(l => l.release())); await gone();
} else if (scenario === "cancel") {
  const abort = new AbortController();
  const first = acquire(b,gateway,abort.signal);
  const second = acquire(b,gateway);
  const rejected = assert.rejects(first,/CANCELLED/);
  abort.abort("private-secret"); await rejected;
  const lease = await second; assert.equal(starts,1); assert(lease.session.alive());
  await lease.release(); await gone();
  await assert.rejects(acquire(b,gateway,AbortSignal.abort()),/CANCELLED/); assert.equal(starts,1);
} else if (scenario === "pending-cancel") {
  const abort = new AbortController();
  const pending = acquire({...b,hostname:"pending"},gateway,abort.signal);
  const rejected = assert.rejects(pending,/CANCELLED/);
  await Bun.sleep(150); abort.abort(); await rejected; await gone();
} else if (scenario === "startup-fail") {
  await Promise.all([assert.rejects(acquire({...b,hostname:"startup-fail"},gateway),/BRIDGE_FAILED/),
    assert.rejects(acquire({...b,hostname:"startup-fail"},gateway),/BRIDGE_FAILED/)]);
  assert.equal(starts,1); await gone();
} else if (scenario === "live-fail") {
  const a = await acquire(b,gateway), c = await acquire(b,gateway);
  await new Promise((yes,no) => {
    const req = request({socketPath:a.session.socketPath,headers:{"x-break":"1"}}, res => {res.resume(); res.on("end",yes);});
    req.on("error",no); req.end();
  });
  for(let i=0;i<100 && a.session.alive();i++) await Bun.sleep(10);
  assert(!a.session.alive());
  await assert.rejects(acquire(b,gateway),/RESTART_REQUIRED/); assert.equal(starts,1);
  await a.release(); await assert.rejects(acquire(b,gateway),/RESTART_REQUIRED/);
  assert.equal(starts,1); await c.release(); await gone();
} else if (scenario === "plugin") {
  process.env.OPENCODE_APERTURE_ENABLE = "1";
  process.env.APERTURE_HOST = gateway;
  const {default:plugin} = await import(${JSON.stringify(resolve(import.meta.dir, "../src/index.ts"))});
  const {shutdownBridgeIngress} = await import(${JSON.stringify(resolve(import.meta.dir, "../src/bridge-ingress.ts"))});
  const a = await plugin({}), c = await plugin({});
  const configA = {}, configC = {};
  const firstConfig = a.config(configA);
  await Bun.sleep(20);
  current = {...current,bridge:{...b,hostname:"changed-during-start"}};
  const untouched = {sentinel:true}; await a.config(untouched); assert.deepEqual(untouched,{sentinel:true});
  current = {version:1,bridge:b};
   await Promise.all([firstConfig,c.config(configC)]); assert.equal(starts,1);
   assert.equal(configA.provider.openai.name,"Aperture (openai)");
   assert.deepEqual(Object.keys(configA.provider.openai.models),["model-a"]);
   const unrelated = {headers:{}};
   await a["chat.headers"]({model:{providerID:"fixture-other"}},unrelated);
   assert.deepEqual(unrelated.headers,{});
  const headers = async hooks => {const out={headers:{}}; await hooks["chat.headers"]({model:{providerID:"openai"}},out); return out.headers;};
  const ha = await headers(a), hc = await headers(c);
  assert.notEqual(ha["x-aperture-relay-capability"],hc["x-aperture-relay-capability"]);
  assert(ha["x-aperture-relay-capability"]);
  const again = {}; await a.config(again); assert.deepEqual(again,configA); assert.equal(starts,1);
  current = {...current,bridge:{...b,hostname:"changed"}};
  const unchanged = {sentinel:true}; await a.config(unchanged); assert.deepEqual(unchanged,{sentinel:true}); assert.equal(starts,1);
  current = {...current,bridge:{...b,enabled:false}};
  await a.config(unchanged); assert.deepEqual(unchanged,{sentinel:true});
  const origin = configA.provider.openai.options.baseURL.replace(/\\/codex\\/?$/,"");
  await a.dispose();
  assert.equal((await fetch(origin+"/codex/responses",{method:"POST",headers:ha})).status,403);
  assert.equal((await fetch(origin+"/codex/responses",{method:"POST",headers:hc})).status,200);
  await c.dispose(); await gone();
  current = {...current,bridge:{...b,enabled:false,runtime:{mode:"external",executable:"relative"}}};
  const disabled = await plugin({}); globalThis.fetch = async () => Response.json([]);
  await disabled.config({}); assert.equal(starts,1); await disabled.dispose();
  const messages = []; const originalError = console.error;
  console.error = (...args) => messages.push(args.join(" "));
  try {
    const sanitized = await plugin({});
    for (const message of ["Aperture bridge: PRIVATE_AUTH_SECRET", "Aperture bridge: BRIDGE_FAILED", "Invalid or unsafe Aperture bridge settings"]) {
      settingsError = new Error(message); await sanitized.config({});
    }
    await sanitized.dispose();
  } finally {settingsError = undefined; console.error = originalError;}
  assert(!messages.join(" ").includes("PRIVATE_AUTH_SECRET"));
  assert(messages[0].endsWith("Aperture setup failed"));
  assert(messages[1].endsWith("Aperture bridge: BRIDGE_FAILED"));
  assert(messages[2].endsWith("Invalid or unsafe Aperture bridge settings"));
  current = {...current,bridge:{...b,hostname:"pending"}};
  const pending = await plugin({}); const configuring = pending.config({});
  await Bun.sleep(150); await pending.dispose(); await configuring; await gone();
  await shutdownBridgeIngress();
}
`);

for (const scenario of ["shared", "refresh", "distinct", "cancel", "pending-cancel", "startup-fail", "live-fail", "plugin"]) {
  test(`bridge runtime ownership: ${scenario}`, async () => {
    const child = Bun.spawn([process.execPath, runnerPath, scenario], {
      env: { ...process.env, BUN_BE_BUN: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect({ code, output: code === 0 ? "" : stdout + stderr }).toEqual({ code: 0, output: "" });
  }, 15000);
}
