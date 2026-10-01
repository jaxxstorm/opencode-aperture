// Synthetic credentials only. Build first; run `bun scripts/probe-routing.ts`.
import assert from "node:assert/strict";
import { mkdir, rm, readFile, cp, writeFile, realpath, access as exists } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { connect } from "node:net";
import { consumer, command, isolatedEnv } from "./integration-support";
import { catalog, model, responseStream, toolName, callId, toolResult } from "./fixtures/responses";
import { gatewayCatalog, gatewayModels, gatewayStream } from "./fixtures/gateway-responses";

const access = "synthetic-aperture-access-NOT-A-CREDENTIAL";
const account = "synthetic-aperture-account";
const refresh = "synthetic-aperture-refresh-NOT-A-CREDENTIAL";
const workerMode = process.argv.includes("--relay-worker-embedded") ? "opencode" : process.argv.includes("--relay-worker-https") ? "external" : undefined;
const productionErrors = process.argv.includes("--bridge-production-errors");
const productionRefresh = process.argv.includes("--bridge-production-refresh");
const productionGateway = process.argv.includes("--bridge-production-gateway");
const productionMode = process.argv.includes("--bridge-production") || productionErrors || productionRefresh || productionGateway;
const expectWorkerRejection = process.argv.includes("--expect-worker-rejection");
const proxyMode = productionMode || workerMode || process.argv.includes("--relay-proxy-https") ? "https" : process.argv.includes("--relay-proxy-http") ? "http" : undefined;
const relayMode = process.argv.includes("--relay") || !!proxyMode;
let interrupted = false;
const interrupt = () => { interrupted = true; };
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
let root: string | undefined;
let child: ChildProcess | undefined;
let childExit: Promise<void> | undefined;
let drains: Promise<void>[] = [];
let gateway: ReturnType<typeof Bun.serve> | undefined;
let secureGateway: ReturnType<typeof Bun.serve> | undefined;
let logs = "";
let phase = "prepare";
let checkpoint = "package";
let injected = false;
let tracePath: string | undefined;
let gatewayBodyCount = 0;
let gatewayHeaderCount = 0;
const results: string[] = [];
const listeners: string[] = [];

async function waitFor(test: () => Promise<boolean> | boolean, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    assert(!interrupted, "Handled interruption");
    if (await test()) return;
    await Bun.sleep(100);
  }
  throw new Error("Bounded wait expired");
}

async function stopChild() {
  if (!child) return;
  const pid = child.pid;
  function kill(signal: NodeJS.Signals) {
    if (pid) try { process.kill(-pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
  kill("SIGTERM");
  const timer = setTimeout(() => kill("SIGKILL"), 3000);
  await childExit;
  await Promise.all(drains);
  drains = [];
  for (const match of logs.matchAll(/\[aperture-proxy-fixture\] listening-port=(\d+)/g)) listeners.push(`http://127.0.0.1:${match[1]}`);
  kill("SIGKILL");
  clearTimeout(timer);
  child = undefined;
}

try {
  assert(!relayMode || process.platform === "darwin", "Relay proof requires the verified localhost-only macOS sandbox");
  assert(!expectWorkerRejection || workerMode === "opencode", "Expected rejection applies only to explicit embedded worker mode");
  const artifact = await consumer();
  root = artifact.root;
  const executable = process.env.OPENCODE_BIN ?? "opencode";
  const version = (await command([executable, "--version"], join(root, "work"), isolatedEnv(root))).trim();
  assert.equal(version, process.env.OPENCODE_EXPECT_VERSION ?? "1.18.29", "Unexpected stock OpenCode version");
  phase = "public-dependency-cache";
  let cache = process.env.APERTURE_PUBLIC_CACHE;
  if (!cache) {
    cache = join(root, "public-dependencies");
    await mkdir(cache);
    await Bun.write(join(cache, "package.json"), JSON.stringify({ private: true, dependencies: { "@opencode-ai/plugin": version } }));
    await command(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"], cache, isolatedEnv(root));
  }
  async function seed(directory: string) {
    for (const name of ["package.json", "package-lock.json", "node_modules"]) await cp(join(cache!, name), join(directory, name), { recursive: true });
  }
  await seed(join(root, "config"));
  // OpenCode also discovers XDG_CONFIG_HOME/opencode independently of CONFIG_DIR.
  await mkdir(join(root, "config/opencode"), { recursive: true });
  await seed(join(root, "config/opencode"));
  const cert = join(root, "fixture-cert.pem");
  const key = join(root, "fixture-key.pem");
  if (proxyMode === "https") {
    await command(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", cert], root, isolatedEnv(root));
  }
  const wrongCert = join(root, "wrong-cert.pem");
  if (productionErrors) await command(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=untrusted-fixture", "-keyout", join(root, "wrong-key.pem"), "-out", wrongCert], root, isolatedEnv(root));
  const cases = productionGateway ? ["gateway-catalog"] : expectWorkerRejection ? ["runtime-rejection"] : productionRefresh ? ["model-refresh"] : productionErrors ? ["retry", "redirect", "tls-reject"] : ["text", "tool", "concurrency", "cancel", "other-provider"];
  for (const scenario of cases) {
    phase = scenario;
    checkpoint = "fixture-start";
    assert(!interrupted);
    logs = "";
    gatewayBodyCount = 0;
    gatewayHeaderCount = 0;
    const requests: { session: string | null; body: any; path: string; peerPort?: number }[] = [];
    let discovery = 0;
    let discoveryModels = [model];
    let aborted = false;
    let fixtureError = false;
    let redirectHits = 0;
    const handleGateway = async (request: Request, peerPort?: number) => {
      const path = new URL(request.url).pathname;
      if (path === "/unexpected-redirect") { redirectHits++; return new Response("must not be contacted"); }
      if (path === "/api/providers") {
        discovery++;
        return Response.json(productionGateway ? gatewayCatalog : catalog.map(provider => ({ ...provider, models: discoveryModels })));
      }
      try {
        gatewayHeaderCount++;
        const body = await request.json() as any;
        gatewayBodyCount++;
        assert.equal(request.headers.get("x-aperture-relay-capability"), null);
        assert.equal(request.headers.get("proxy-authorization"), null);
        assert.equal(request.headers.get("x-aperture-worker-capability"), null);
        assert.equal(request.headers.get("x-aperture-relay-fixture"), relayMode && scenario !== "other-provider" ? "forwarded" : null, "Inference must traverse the authenticated relay, not bypass it");
        requests.push({ session: request.headers.get("session-id"), body, path, peerPort });
        if (productionGateway) {
          const selected = gatewayModels.find(entry => decodeURIComponent(entry.path) === decodeURIComponent(path));
          assert(selected, "Unexpected gateway route");
          assert.equal(request.method, "POST");
          assert.equal(request.headers.get("x-aperture-opencode-plugin"), "1");
          for (const [name, value] of request.headers) {
            assert(!/^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-goog-api-key|chatgpt-account-id|x-amz-.*)$/i.test(name));
            assert(!/aperture-managed|aperture-worker-|aperture-relay-|proxy-fixture-/.test(value));
          }
          assert.equal(new URL(request.url).search, "");
          if ("wire" in selected) assert.equal(body.model, selected.wire);
          else assert.equal(body.model, undefined);
          return gatewayStream(selected.protocol, `GATEWAY_${selected.protocol}_OK`);
        }
        if (scenario === "other-provider") {
          assert.equal(path, "/other/responses");
          assert.equal(request.headers.get("x-aperture-opencode-plugin"), null);
          assert.equal(request.headers.get("authorization"), "Bearer synthetic-other-provider-key");
          return responseStream("OTHER_PROVIDER_OK");
        }
        assert.equal(path, "/codex/responses");
        assert.equal(request.method, "POST");
        assert.equal(request.headers.get("authorization"), `Bearer ${access}`);
        assert.equal(request.headers.get("chatgpt-account-id"), account);
        assert.equal(request.headers.get("x-aperture-opencode-plugin"), "1");
        assert(request.headers.get("session-id"));
        assert.equal(request.headers.get("originator"), "opencode");
        assert(request.headers.get("user-agent")?.includes("opencode/"));
        assert(request.headers.get("content-type")?.includes("application/json"));
        assert.equal(body.model, model);
        assert.equal(body.stream, true);
        if (scenario === "retry" && requests.length === 1) return Response.json({ error: { message: "Synthetic rate limit", type: "rate_limit_error" } }, { status: 429, headers: { "retry-after": "0" } });
        if (scenario === "redirect") return Response.redirect(new URL("/unexpected-redirect", request.url), 307);
        if (scenario === "cancel") {
          request.signal.addEventListener("abort", () => { aborted = true; });
          return new Response(new ReadableStream({
            start(controller) { controller.enqueue(new TextEncoder().encode(": waiting\n\n")); },
            cancel() { aborted = true; },
          }), { headers: { "content-type": "text/event-stream" } });
        }
        if (scenario === "tool") {
          const output = body.input?.find((item: any) => item.type === "function_call_output");
          if (!output) {
            assert(body.tools.some((tool: any) => tool.name === toolName));
            assert(body.tools.every((tool: any) => tool.name === toolName));
            return responseStream("", true);
          }
          assert.equal(output.call_id, callId);
          assert.equal(output.output, toolResult);
          return responseStream("TOOL_COMPLETE");
        }
        const text = JSON.stringify(body.input).includes("CONCURRENT_B") ? "REPLY_B" : scenario === "concurrency" ? "REPLY_A" : "APERTURE_TEXT_OK";
        return responseStream(text);
      } catch { fixtureError = true; return new Response("Fixture assertion failed", { status: 400 }); }
    };
    gateway = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 60, fetch: request => handleGateway(request) });
    if (proxyMode === "https") {
      secureGateway = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 60, tls: { cert: Bun.file(cert), key: Bun.file(key) }, fetch: request => handleGateway(request, secureGateway!.requestIP(request)?.port) });
      listeners.push(`https://127.0.0.1:${secureGateway.port}`);
    }
    listeners.push(`http://127.0.0.1:${gateway.port}/global/health`);
    const work = join(root, `work-${scenario}`);
    await mkdir(work);
    await mkdir(join(work, ".opencode/tools"), { recursive: true });
    await seed(join(work, ".opencode"));
    await Bun.write(join(work, ".opencode/tools/aperture_fixture.ts"), `export default { description: 'Deterministic harmless integration fixture', args: {}, async execute() { return '${toolResult}' } }`);
    const relayPlugin = join(work, "scripts/fixtures/relay-plugin.ts");
    if (relayMode && !productionMode) {
      await mkdir(join(work, "scripts/fixtures"), { recursive: true });
      await mkdir(join(work, "src"));
      for (const name of ["relay-plugin.ts", "relay-core.ts", "forward-proxy.ts", "transport-worker.ts"]) await cp(join(import.meta.dir, "fixtures", name), join(work, "scripts/fixtures", name));
      await cp(join(import.meta.dir, "../src/transport-process.ts"), join(work, "src/transport-process.ts"));
    }
    const providerID = scenario === "other-provider" ? "fixture-other" : "openai";
    const config = {
      plugin: [artifact.installed, ...(relayMode && !productionMode ? [relayPlugin] : [])],
      ...(productionGateway ? { model: `${gatewayModels[0].providerID}/${gatewayModels[0].modelID}`, small_model: `${gatewayModels[0].providerID}/${gatewayModels[0].modelID}` } : productionRefresh ? {} : { model: `openai/${model}`, small_model: `openai/${model}` }), share: "disabled", autoupdate: false,
      permission: { "*": "deny", [toolName]: "allow" },
      provider: {
        ...(productionRefresh || productionGateway ? {} : { openai: { models: { [model]: { name: model, limit: { context: 128000, output: 4096 } } } } }),
        ...(scenario === "other-provider" ? { "fixture-other": { npm: "@ai-sdk/openai", options: { baseURL: `http://127.0.0.1:${gateway.port}/other`, apiKey: "synthetic-other-provider-key" }, models: { [model]: { name: model, limit: { context: 128000, output: 4096 } } } } } : {}),
      },
    };
    await Bun.write(join(work, "opencode.json"), JSON.stringify(config));
    const productionTrace = join(work, "bridge-trace.jsonl");
    tracePath = productionTrace;
    if (productionMode) {
      const modulePath = join(work, "bridge-substitute.js");
      const target = `https://127.0.0.1:${secureGateway!.port}`;
      const certificate = await readFile(cert, "utf8");
      const inferenceCertificate = scenario === "tls-reject" ? await readFile(wrongCert, "utf8") : certificate;
      // Only the bridge dependency is substituted. The installed server, ingress,
      // worker, control protocol, and discovery policy are the shipped code.
      await writeFile(modulePath, `
import { appendFileSync } from "node:fs";
import { createForwardProxy } from ${JSON.stringify(join(import.meta.dir, "fixtures/forward-proxy.ts"))};
const trace = value => appendFileSync(${JSON.stringify(productionTrace)}, JSON.stringify(value) + "\\n");
console.log = value => {
  const peer = /^\\[aperture-proxy-fixture\\] tunnel-peer-port=(\\d+)$/.exec(value);
  if (peer) trace({event:"peer", port:Number(peer[1])});
};
export async function createBridge() {
  const proxy = await createForwardProxy(new URL(${JSON.stringify(target)}));
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== ${JSON.stringify(target)} || init?.proxy !== proxy.url) throw new Error("Fixture proxy bypass");
    trace({event:"request", path:url.pathname});
    const headers = new Headers(init.headers);
    if (url.pathname !== "/api/providers") headers.set("x-aperture-relay-fixture", "forwarded");
    return original(input, {...init, headers, tls:{ca:url.pathname === "/codex/responses" ? ${JSON.stringify(inferenceCertificate)} : ${JSON.stringify(certificate)}}});
  };
  trace({event:"created", pid:process.pid});
  return {httpProxyURL:()=>proxy.url, close:()=>proxy.close()};
}
`, { mode: 0o600 });
      const settingsDirectory = join(root, "config/opencode-aperture");
      await mkdir(settingsDirectory, { recursive: true, mode: 0o700 });
      await writeFile(join(settingsDirectory, "settings.json"), JSON.stringify({ version: 1, bridge: {
        enabled: true, gateway: target, hostname: "aperture-fixture", stateDir: join(root, `state/opencode-aperture/node-${scenario}`),
        runtime: { mode: "external", executable: process.execPath }, modulePath, startupTimeoutMs: 10_000,
      } }), { mode: 0o600 });
    }
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = reservation.port!;
    reservation.stop(true);
    const env: Record<string, string> = { ...isolatedEnv(root), NPM_CONFIG_OFFLINE: "true", APERTURE_HOST: productionMode ? `https://127.0.0.1:${secureGateway!.port}` : `http://127.0.0.1:${gateway.port}`, OPENCODE_APERTURE_DEBUG: "1",
      ...(productionMode && process.env.APERTURE_TEST_TMPDIR ? { TMPDIR: process.env.APERTURE_TEST_TMPDIR } : {}),
      ...(proxyMode ? { APERTURE_RELAY_FIXTURE_PROXY: "1" } : {}),
      ...(secureGateway ? { APERTURE_RELAY_FIXTURE_TARGET: `https://127.0.0.1:${secureGateway.port}`, APERTURE_RELAY_FIXTURE_CA: cert } : {}),
      ...(workerMode ? { APERTURE_RELAY_RUNTIME_MODE: workerMode, APERTURE_RELAY_RUNTIME_EXECUTABLE: process.execPath, APERTURE_RELAY_FIXTURE_KEY: key } : {}),
    };
    const args = [executable, "serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "DEBUG"];
    if (process.platform === "darwin") {
      const privateSocketRoot = (await realpath(env.TMPDIR!)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const unixRule = productionMode ? `(allow network-outbound (remote unix-socket (regex ${JSON.stringify(`^${privateSocketRoot}/apb-[A-Za-z0-9]+/s$`)})))` : "";
      args.unshift("sandbox-exec", "-p", `(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))${unixRule}`);
    }
    child = spawn(args[0]!, args.slice(1), { cwd: work, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let spawnFailed = false;
    childExit = new Promise(resolve => { child!.once("exit", () => resolve()); child!.once("error", () => { spawnFailed = true; resolve(); }); });
    drains = [child.stdout!, child.stderr!].map(async stream => {
      for await (const chunk of stream) {
        logs += chunk.toString();
        if (logs.length > 2_000_000) { child?.kill("SIGTERM"); break; }
      }
    });
    const base = `http://127.0.0.1:${port}`;
    listeners.push(`${base}/global/health`);
    async function api(path: string, method = "GET", body?: unknown): Promise<any> {
      const result = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45_000) });
      const data = await result.json();
      return { status: result.status, data };
    }
    checkpoint = "stock-startup";
    await waitFor(async () => {
      assert(!spawnFailed && child?.exitCode === null, "OpenCode exited during startup");
      return fetch(`${base}/global/health`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok).catch(() => false);
    }, 60_000);
    if (process.argv.includes("--fail-after-start")) { injected = true; throw new Error("Intentional cleanup test failure"); }
    if (process.argv.includes("--interrupt-after-start")) { injected = true; process.kill(process.pid, "SIGTERM"); await Bun.sleep(10); }
    assert(!interrupted);
    checkpoint = "synthetic-auth";
    if (!productionRefresh && !productionGateway) assert.equal((await api("/auth/openai", "PUT", { type: "oauth", access, refresh, expires: Date.now() + 3600000, accountId: account })).status, 200);
    async function session() { const result = await api("/session", "POST", { title: "Synthetic integration" }); checkpoint = `session-create-http-${result.status}`; assert.equal(result.status, 200); return result.data.id as string; }
    async function prompt(id: string, text: string) { return api(`/session/${id}/message`, "POST", { model: { providerID, modelID: model }, parts: [{ type: "text", text }] }); }
    function complete(result: any, text: string) {
      assert.equal(result.status, 200);
      assert(!result.data.info.error);
      assert(result.data.info.time.completed);
      assert.equal(result.data.info.finish, "stop");
      assert.equal(result.data.parts.filter((part: any) => part.type === "text").map((part: any) => part.text).join(""), text);
    }
    checkpoint = "session-create";
    const id = await session();
    if (productionGateway) {
      checkpoint = "gateway-native-catalog";
      const configured = await api("/config");
      const available = await api("/config/providers");
      assert.equal(configured.status, 200); assert.equal(available.status, 200);
      for (const [path, result] of [["/config", configured], ["/config/providers", available]] as const) {
        checkpoint = `gateway-config-secrecy-${path}`;
        const serialized = JSON.stringify(result.data);
        const environmentSecrets = Object.entries(env).filter(([name]) => /(?:API_KEY|ACCESS_TOKEN|SECRET|PASSWORD|AUTH_KEY)$/.test(name)).map(([, value]) => value);
        for (const secret of [access, account, refresh, "synthetic-other-provider-key", "relay-fixture-", "proxy-fixture-", "worker-fixture-", "aperture-worker-", "aperture-relay-", ...environmentSecrets]) {
          if (secret) assert(!serialized.includes(secret), "Credential exposed through gateway config API");
        }
      }
      checkpoint = "gateway-native-catalog";
      const providers = available.data.providers.filter((provider: any) => provider.id.startsWith("aperture-"));
      assert.equal(providers.length, 4);
      assert.equal(providers.reduce((count: number, provider: any) => count + Object.keys(provider.models).length, 0), 4);
      assert.deepEqual(providers.flatMap((provider: any) => Object.keys(provider.models).map(key => `${provider.id}/${key}`)).sort(), gatewayModels.map(entry => `${entry.providerID}/${entry.modelID}`).sort());
      assert.equal(configured.data.provider.openai, undefined);
      for (const entry of gatewayModels) {
        const provider = configured.data.provider[entry.providerID];
        assert.equal(provider.name, `Aperture (${entry.protocol === "bedrock" ? "aws" : "mixed"})`);
        assert.equal(provider.models[entry.modelID].id, entry.modelID);
        assert(new URL(provider.options.baseURL).pathname.startsWith("/gateway/"));
        const origin = new URL(provider.options.baseURL).origin;
        listeners.push(`${origin}/global/health`);
        assert.equal((await fetch(`${origin}/gateway${entry.path}`, { method: "POST", body: "{}" })).status, 403);
      }
      assert.equal(requests.length, 0);
      for (const entry of gatewayModels) {
        checkpoint = `gateway-inference-${entry.protocol}`;
        const sid = await session();
        checkpoint = `gateway-inference-${entry.protocol}`;
        complete(await api(`/session/${sid}/message`, "POST", { model: { providerID: entry.providerID, modelID: entry.modelID }, parts: [{ type: "text", text: "Synthetic gateway request" }] }), `GATEWAY_${entry.protocol}_OK`);
      }
      checkpoint = "gateway-proxy-traversal";
      assert(!fixtureError); assert.equal(requests.length, 4); assert.equal(discovery, 1);
      assert.deepEqual(requests.map(request => decodeURIComponent(request.path)).sort(), gatewayModels.map(entry => decodeURIComponent(entry.path)).sort());
      const trace = (await readFile(productionTrace, "utf8")).trim().split("\n").map(line => JSON.parse(line));
      assert.equal(trace.filter(event => event.event === "created").length, 1);
      assert.equal(trace.filter(event => event.event === "request").length, 5);
      const peers = new Set(trace.filter(event => event.event === "peer").map(event => event.port));
      assert(requests.every(request => peers.has(request.peerPort)));
      await stopChild();
      for (const secret of [access, refresh, "aperture-worker-", "aperture-relay-", "proxy-fixture-"]) assert(!logs.includes(secret));
      await gateway.stop(true); gateway = undefined;
      await secureGateway?.stop(true); secureGateway = undefined;
      results.push(scenario);
      console.log(JSON.stringify({ scenario, status: "pass", providers: 4, models: 4, gatewayRequests: 4, nativeAuthRequired: false, protocols: gatewayModels.map(entry => entry.protocol) }));
      continue;
    }
    if (productionRefresh) {
      checkpoint = "initial-model-catalog";
      const initial = await api("/config/providers");
      assert.equal(initial.status, 200);
      const initialProvider = initial.data.providers.find((provider: any) => provider.id === "openai");
      assert.equal(initialProvider?.name, "Aperture (synthetic-subscription)");
      assert.deepEqual(Object.keys(initialProvider.models), [model]);
      // Hold the same worker from another instance while reloading the first.
      const secondWork = join(root, "second-model-project");
      await mkdir(secondWork);
      await mkdir(join(secondWork, ".opencode"));
      await seed(join(secondWork, ".opencode"));
      await writeFile(join(secondWork, "opencode.json"), JSON.stringify(config));
      const second = await api(`/config/providers?directory=${encodeURIComponent(secondWork)}`);
      assert.equal(second.status, 200);
      assert(second.data.providers.some((provider: any) => provider.id === "openai"));
      const beforeRefresh = discovery;
      const addedModel = "gpt-5.5-refresh-fixture";
      discoveryModels = [model, addedModel];
      const eventAbort = new AbortController();
      let events: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        checkpoint = "model-disposal-event";
        const response = await fetch(`${base}/global/event`, { keepalive: false, signal: AbortSignal.any([eventAbort.signal, AbortSignal.timeout(30_000)]) });
        assert(response.ok);
        events = response.body!.getReader();
        const disposed = (async () => {
          let pending = "";
          const decoder = new TextDecoder();
          while (true) {
            const chunk: { done: boolean; value?: Uint8Array } = await events!.read();
            assert(!chunk.done, "Global event stream closed before disposal");
            pending += decoder.decode(chunk.value, { stream: true });
            assert(pending.length < 1_000_000, "Bounded event observation");
            let boundary: number;
            while ((boundary = pending.indexOf("\n\n")) >= 0) {
              const frame = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              const data = frame.split("\n").find(line => line.startsWith("data:"));
              if (!data) continue;
              const envelope = JSON.parse(data.slice(5));
              const event = envelope.payload ?? envelope;
              if (event.type === "server.instance.disposed" && event.properties.directory === work) return;
            }
          }
        })();
        // Attach rejection handling immediately while the request is in flight.
        const result = await Promise.all([api(`/instance/dispose?directory=${encodeURIComponent(work)}`, "POST"), disposed]);
        assert.equal(result[0].status, 200);
        checkpoint = "refreshed-model-catalog";
        const refreshed = await api(`/config/providers?directory=${encodeURIComponent(work)}`);
        assert.equal(refreshed.status, 200);
        const provider = refreshed.data.providers.find((provider: any) => provider.id === "openai");
        assert.equal(provider?.name, "Aperture (synthetic-subscription)");
        assert.deepEqual(Object.keys(provider.models).sort(), [...discoveryModels].sort());
        assert(discovery > beforeRefresh, "Instance reload must rediscover even while another owner keeps the worker alive");
        const trace = (await readFile(productionTrace, "utf8")).trim().split("\n").map(line => JSON.parse(line));
        assert.equal(trace.filter(event => event.event === "created").length, 1, "Refresh must preserve the shared worker");
        assert.equal(requests.length, 0, "Selector population does not need native auth or inference");
      } finally {
        checkpoint = "refresh-event-cleanup";
        eventAbort.abort();
        await events?.cancel().catch(() => {});
      }
      checkpoint = "refresh-process-cleanup";
      await stopChild();
      checkpoint = "refresh-diagnostic-secrecy";
      for (const prefix of ["aperture-worker-", "aperture-relay-", "proxy-fixture-"]) assert(!logs.includes(prefix));
      await gateway.stop(true); gateway = undefined;
      await secureGateway?.stop(true); secureGateway = undefined;
      results.push(scenario);
      console.log(JSON.stringify({ scenario, status: "pass", modelsBefore: 1, modelsAfter: 2, discoveryRequests: discovery, sharedWorkerStarts: 1, nativeAuthRequired: false }));
      continue;
    }
    if (expectWorkerRejection) {
      checkpoint = "embedded-runtime-rejection";
      const configured = await api("/config");
      assert.equal(configured.data.provider.openai.options.baseURL, `http://127.0.0.1:${gateway.port}/codex`);
      assert.equal(discovery, 1, "Incompatible worker must not perform proxied discovery");
      assert.equal(requests.length, 0);
      assert(logs.includes("[aperture-worker-fixture] unsupported runtime"));
      assert(!logs.includes("[aperture-worker-fixture] ready"));
      assert(!logs.includes("[aperture-worker-fixture] transport smoke complete"));
      for (const path of ["/config", "/config/providers"]) {
        const result = await api(path);
        assert.equal(result.status, 200);
        assert(!JSON.stringify(result.data).includes("worker-fixture-"));
      }
      await stopChild();
      await gateway.stop(true); gateway = undefined;
      await secureGateway?.stop(true); secureGateway = undefined;
      results.push(scenario);
      console.log(JSON.stringify({ scenario, status: "pass", rejected: "unsupported embedded runtime", runtimeFallback: false, existingGatewayRoutePreserved: true, inferenceAttempted: false }));
      continue;
    }
    if (relayMode) {
      checkpoint = "relay-boundary";
      const configured = await api("/config");
      assert.equal(configured.status, 200);
      const relayURL = configured.data.provider.openai.options.baseURL as string;
      const relayOrigin = new URL(relayURL).origin;
      assert.equal(new URL(relayOrigin).hostname, "127.0.0.1");
      assert.notEqual(relayOrigin, `http://127.0.0.1:${gateway.port}`);
      listeners.push(`${relayOrigin}/global/health`);
      for (const path of ["/config", "/config/providers"]) {
        checkpoint = `relay-config-secrecy-${path}`;
        const exposed = await api(path);
        assert.equal(exposed.status, 200);
        for (const prefix of ["relay-fixture-", "proxy-fixture-", "worker-fixture-", "aperture-worker-", "aperture-relay-"]) assert(!JSON.stringify(exposed.data).includes(prefix), "Fixture credential exposed through config API");
      }
      const rejectedHeaders: Record<string, string>[] = [{}, { "x-aperture-relay-capability": "incorrect" }, { origin: "https://untrusted.invalid" }, { host: "untrusted.invalid" }];
      checkpoint = "relay-unauthenticated-rejection";
      for (const headers of rejectedHeaders) {
        const denied = await fetch(`${relayURL}/responses`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(1000) });
        assert.equal(denied.status, 403);
        await denied.body?.cancel();
      }
      assert.equal(requests.length, 0, "Unauthenticated relay request reached upstream");
    }
    checkpoint = "inference";
    if (scenario === "redirect" || scenario === "tls-reject") {
      const pending = prompt(id, "Synthetic transport rejection");
      await waitFor(async () => {
        const trace = (await readFile(productionTrace, "utf8")).trim().split("\n").map(line => JSON.parse(line));
        return trace.some(event => event.event === "request" && event.path === "/codex/responses");
      });
      await Bun.sleep(500);
      assert.equal((await api(`/session/${id}/abort`, "POST")).status, 200);
      await pending;
      assert.equal(redirectHits, 0);
      assert.equal(requests.length, scenario === "redirect" ? 1 : 0);
    } else if (scenario === "concurrency") {
      const second = await session();
      const [a, b] = await Promise.all([prompt(id, "CONCURRENT_A"), prompt(second, "CONCURRENT_B")]);
      complete(a, "REPLY_A"); complete(b, "REPLY_B");
      assert.equal(new Set(requests.map(request => request.session)).size, 2);
      assert(requests.some(request => request.session === id));
      assert(requests.some(request => request.session === second));
    } else if (scenario === "cancel") {
      const pending = prompt(id, "Delayed response");
      await waitFor(() => requests.length > 0);
      assert.equal((await api(`/session/${id}/abort`, "POST")).status, 200);
      await pending;
      await waitFor(() => aborted, 5000);
      assert.equal(requests.length, 1);
    } else {
      const result = await prompt(id, "Synthetic integration request");
      complete(result, scenario === "tool" ? "TOOL_COMPLETE" : scenario === "other-provider" ? "OTHER_PROVIDER_OK" : "APERTURE_TEXT_OK");
    }
    checkpoint = "gateway-assertions";
    assert(!fixtureError, "Gateway protocol/header assertion failed");
    if (workerMode) {
      checkpoint = "worker-readiness-observation";
      await waitFor(() => logs.includes("[aperture-worker-fixture] transport smoke complete") && logs.includes("[aperture-worker-fixture] ready bun=1.4.2"));
    }
    checkpoint = `discovery-count-${discovery}`;
    assert.equal(discovery, proxyMode && !productionMode ? 2 : 1, "Expected exactly one production discovery, or fixture's additional proxied discovery");
    if (productionMode) {
      checkpoint = "production-proxy-traversal";
      const trace = (await readFile(productionTrace, "utf8")).trim().split("\n").map(line => JSON.parse(line));
      assert.equal(trace.filter(event => event.event === "created").length, 1);
      assert.equal(trace.filter(event => event.event === "request" && event.path === "/api/providers").length, 1);
      assert.equal(trace.filter(event => event.event === "request" && event.path === "/codex/responses").length, scenario === "other-provider" ? 0 : scenario === "tls-reject" ? 1 : requests.length);
      const peers = new Set<number>(trace.filter(event => event.event === "peer").map(event => event.port));
      if (scenario !== "other-provider") assert(requests.every(request => request.peerPort !== undefined && peers.has(request.peerPort)));
    } else if (proxyMode) {
      checkpoint = "proxy-discovery-observation";
      await waitFor(() => logs.includes("[aperture-relay-fixture] proxied discovery complete"));
      const traversals = logs.split(`[aperture-proxy-fixture] ${proxyMode === "https" ? "connect" : "http"} accepted`).length - 1;
      assert(traversals >= 1, "Authenticated proxy traversal must be observed");
      if (proxyMode === "http") assert.equal(traversals, 1 + (scenario === "other-provider" ? 0 : requests.length));
      if (proxyMode === "https" && scenario !== "other-provider") {
        checkpoint = "tls-inference-tunnel-observation";
        await waitFor(() => {
          const peers = new Set([...logs.matchAll(/\[aperture-proxy-fixture\] tunnel-peer-port=(\d+)/g)].map(match => Number(match[1])));
          return requests.every(request => request.peerPort !== undefined && peers.has(request.peerPort));
        });
      }
    }
    checkpoint = "scoped-debug-observation";
    assert.equal(logs.split("\n").some(line => line.includes("[opencode-aperture]") && /chat|headers/.test(line)), scenario !== "other-provider", "Debug chat diagnostics must be scoped to OpenAI");
    checkpoint = `inference-count-${requests.length}`;
    assert.equal(requests.length, scenario === "tls-reject" ? 0 : ["tool", "concurrency", "retry"].includes(scenario) ? 2 : 1);
    await waitFor(async () => {
      const status = await api("/session/status");
      return status.status === 200 && (!status.data[id] || status.data[id].type === "idle");
    });
    checkpoint = "cleanup";
    await stopChild();
    for (const secret of [access, account, refresh, "synthetic-other-provider-key", "relay-fixture-", "proxy-fixture-", "worker-fixture-", "aperture-worker-", "aperture-relay-"]) assert(!logs.includes(secret), "Sensitive fixture leaked to logs");
    await gateway.stop(true); gateway = undefined;
    await secureGateway?.stop(true); secureGateway = undefined;
    results.push(scenario);
    console.log(JSON.stringify({ scenario, status: "pass", production: productionMode, relay: relayMode, proxy: proxyMode, worker: workerMode, gatewayRequests: requests.length }));
  }
  console.log(JSON.stringify({ status: "pass", opencode: version, bun: Bun.version, bunScope: "harness", platform: `${process.platform}-${process.arch}`, scenarios: results, egress: process.platform === "darwin" ? "localhost-only child sandbox; synthetic auth restricted to loopback" : "loopback fixtures; child network egress is not sandboxed" }));
} catch (error) {
  let tracedRequests: number | undefined;
  if (productionMode && tracePath) {
    try { tracedRequests = (await readFile(tracePath, "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(event => event.event === "request" && event.path === "/codex/responses").length; } catch {}
  }
  // Never dump native logs, assertion values, request bodies, or raw errors.
  console.error(JSON.stringify({ status: "fail", phase, checkpoint, interrupted, injected, completed: results, gatewayHeaderCount, gatewayBodyCount, tracedRequests, timeout: error instanceof Error && error.name === "TimeoutError", syntax: error instanceof SyntaxError, bridgeSettingsInvalid: logs.includes("Invalid or unsafe Aperture bridge settings"), bridgeFailed: logs.includes("Aperture bridge: BRIDGE_FAILED"), bridgeDiscoveryFailed: logs.includes("Aperture bridge: DISCOVERY_FAILED"), bridgeModuleUnavailable: logs.includes("Aperture bridge: MODULE_UNAVAILABLE"), relayConfigurationMissing: logs.includes("Run the packaged Aperture plugin before the relay fixture"), relayTargetInvalid: logs.includes("Relay fixture requires a numeric loopback origin"), moduleMissing: logs.includes("Cannot find module"), installFailed: logs.includes("install failed"), diagnostics: "Raw errors and native logs withheld; check fixture assertions and prerequisites" }));
  process.exitCode = interrupted ? 130 : 1;
} finally {
  await stopChild();
  await gateway?.stop(true);
  await secureGateway?.stop(true);
  if (root) await rm(root, { recursive: true, force: true });
  const listenersStopped = (await Promise.all(listeners.map(url => new Promise<boolean>(resolve => {
    const socket = connect({ host: "127.0.0.1", port: Number(new URL(url).port) });
    const finish = (closed: boolean) => { clearTimeout(timer); socket.destroy(); resolve(closed); };
    const timer = setTimeout(() => finish(false), 1000);
    socket.once("connect", () => finish(false));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED"));
  })))).every(Boolean);
  console.log(JSON.stringify({ cleanup: "complete", storageRemoved: root ? await exists(root).then(() => false, () => true) : true, childStopped: !child, listenersStopped }));
  if (!listenersStopped) process.exitCode = 1;
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
