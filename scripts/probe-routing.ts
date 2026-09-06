// Synthetic credentials only. Build first; run `bun scripts/probe-routing.ts`.
import assert from "node:assert/strict";
import { mkdir, rm, readFile, cp, access as exists } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { consumer, command, isolatedEnv } from "./integration-support";
import { catalog, model, responseStream, toolName, callId, toolResult } from "./fixtures/responses";

const access = "synthetic-aperture-access-NOT-A-CREDENTIAL";
const account = "synthetic-aperture-account";
const refresh = "synthetic-aperture-refresh-NOT-A-CREDENTIAL";
let interrupted = false;
const interrupt = () => { interrupted = true; };
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
let root: string | undefined;
let child: ChildProcess | undefined;
let childExit: Promise<void> | undefined;
let gateway: ReturnType<typeof Bun.serve> | undefined;
let logs = "";
let phase = "prepare";
let checkpoint = "package";
let injected = false;
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
  kill("SIGKILL");
  clearTimeout(timer);
  child = undefined;
}

try {
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
  const cases = ["text", "tool", "concurrency", "cancel", "other-provider"];
  for (const scenario of cases) {
    phase = scenario;
    checkpoint = "fixture-start";
    assert(!interrupted);
    logs = "";
    const requests: { session: string | null; body: any; path: string }[] = [];
    let discovery = 0;
    let aborted = false;
    let fixtureError = false;
    gateway = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 60, async fetch(request, server) {
      const path = new URL(request.url).pathname;
      if (path === "/api/providers") {
        discovery++;
        return Response.json(catalog);
      }
      try {
        const body = await request.json() as any;
        requests.push({ session: request.headers.get("session-id"), body, path });
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
    } });
    listeners.push(`http://127.0.0.1:${gateway.port}/global/health`);
    const work = join(root, `work-${scenario}`);
    await mkdir(work);
    await mkdir(join(work, ".opencode/tools"), { recursive: true });
    await seed(join(work, ".opencode"));
    await Bun.write(join(work, ".opencode/tools/aperture_fixture.ts"), `export default { description: 'Deterministic harmless integration fixture', args: {}, async execute() { return '${toolResult}' } }`);
    const providerID = scenario === "other-provider" ? "fixture-other" : "openai";
    const config = {
      plugin: [artifact.installed], model: `openai/${model}`,
      small_model: `openai/${model}`, share: "disabled", autoupdate: false,
      permission: { "*": "deny", [toolName]: "allow" },
      provider: {
        openai: { models: { [model]: { name: model, limit: { context: 128000, output: 4096 } } } },
        ...(scenario === "other-provider" ? { "fixture-other": { npm: "@ai-sdk/openai", options: { baseURL: `http://127.0.0.1:${gateway.port}/other`, apiKey: "synthetic-other-provider-key" }, models: { [model]: { name: model, limit: { context: 128000, output: 4096 } } } } } : {}),
      },
    };
    await Bun.write(join(work, "opencode.json"), JSON.stringify(config));
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = reservation.port!;
    reservation.stop(true);
    const env = { ...isolatedEnv(root), APERTURE_HOST: `http://127.0.0.1:${gateway.port}`, OPENCODE_APERTURE_DEBUG: "1" };
    const args = [executable, "serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "DEBUG"];
    if (process.platform === "darwin") args.unshift("sandbox-exec", "-p", '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))');
    child = spawn(args[0]!, args.slice(1), { cwd: work, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let spawnFailed = false;
    childExit = new Promise(resolve => { child!.once("exit", () => resolve()); child!.once("error", () => { spawnFailed = true; resolve(); }); });
    const drains = [child.stdout!, child.stderr!].map(async stream => {
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
    assert.equal((await api("/auth/openai", "PUT", { type: "oauth", access, refresh, expires: Date.now() + 3600000, accountId: account })).status, 200);
    async function session() { const result = await api("/session", "POST", { title: "Synthetic integration" }); assert.equal(result.status, 200); return result.data.id as string; }
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
    checkpoint = "inference";
    if (scenario === "concurrency") {
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
    assert.equal(discovery, 1, "Discovery must run exactly once");
    assert.equal(logs.split("\n").some(line => line.includes("[opencode-aperture]") && /chat|headers/.test(line)), scenario !== "other-provider", "Debug chat diagnostics must be scoped to OpenAI");
    assert.equal(requests.length, scenario === "tool" || scenario === "concurrency" ? 2 : 1);
    await waitFor(async () => {
      const status = await api("/session/status");
      return status.status === 200 && (!status.data[id] || status.data[id].type === "idle");
    });
    checkpoint = "cleanup";
    await stopChild();
    await Promise.all(drains);
    for (const secret of [access, account, refresh, "synthetic-other-provider-key"]) assert(!logs.includes(secret), "Sensitive fixture leaked to logs");
    await gateway.stop(true); gateway = undefined;
    results.push(scenario);
    console.log(JSON.stringify({ scenario, status: "pass", gatewayRequests: requests.length }));
  }
  console.log(JSON.stringify({ status: "pass", opencode: version, bun: Bun.version, platform: `${process.platform}-${process.arch}`, scenarios: results, egress: "loopback-only mock gateway; synthetic auth never leaves localhost" }));
} catch {
  // Never dump native logs, assertion values, request bodies, or raw errors.
  console.error(JSON.stringify({ status: "fail", phase, checkpoint, interrupted, injected, completed: results, diagnostics: "Raw errors and native logs withheld; check fixture assertions and prerequisites" }));
  process.exitCode = interrupted ? 130 : 1;
} finally {
  await stopChild();
  await gateway?.stop(true);
  if (root) await rm(root, { recursive: true, force: true });
  const listenersStopped = (await Promise.all(listeners.map(url => fetch(url, { signal: AbortSignal.timeout(1000) }).then(() => false, () => true)))).every(Boolean);
  console.log(JSON.stringify({ cleanup: "complete", storageRemoved: root ? await exists(root).then(() => false, () => true) : true, childStopped: !child, listenersStopped }));
  if (!listenersStopped) process.exitCode = 1;
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
