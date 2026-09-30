// Private fixture worker. No OpenCode auth handling and no real Tailscale enrollment.
import { randomBytes } from "node:crypto";
import { createRelay } from "./relay-core";
import { createForwardProxy } from "./forward-proxy";

const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
let reportProxy = false;
console.log = (...args: unknown[]) => {
  if (!reportProxy || args.length !== 1 || typeof args[0] !== "string") return;
  const value = args[0];
  const names: Record<string, string> = {
    "[aperture-proxy-fixture] http accepted": "http-accepted",
    "[aperture-proxy-fixture] connect accepted": "connect-accepted",
    "[aperture-relay-fixture] proxied discovery complete": "discovery-complete",
  };
  if (names[value]) send({ type: "event", name: names[value] });
  const port = /^\[aperture-proxy-fixture\] (tunnel-peer-port|listening-port)=(\d+)$/.exec(value);
  if (port) send({ type: "event", name: port[1] === "listening-port" ? "proxy-listening-port" : port[1], port: Number(port[2]) });
};
console.error = console.warn = console.info = console.debug = () => {};
let relay: Awaited<ReturnType<typeof createRelay>> | undefined;
let closing = false;
let started = false;
const deadline = setTimeout(() => void close(1), 15_000);

async function close(code = 0) {
  if (closing) return;
  closing = true;
  clearTimeout(deadline);
  const force = setTimeout(() => process.exit(1), 1000);
  await relay?.close().catch(() => {});
  clearTimeout(force);
  process.exit(code);
}
process.stdin.on("end", () => void close());
process.stdin.on("error", () => void close(1));
process.stdout.on("error", () => void close(1));
process.on("SIGTERM", () => void close());

async function smoke(ca: string, key: string) {
  let producerClosed = false;
  let firstBeforeClose = false;
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, tls: { cert: ca, key }, async fetch(request) {
    if (request.method === "GET") {
      const stop = () => { cancelled = true; clearInterval(heartbeat); };
      request.signal.addEventListener("abort", stop, { once: true });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        heartbeat = setInterval(() => {
          try { controller.enqueue(new TextEncoder().encode("data: synthetic\n\n")); } catch { stop(); }
        }, 25);
      }, cancel: stop }), { headers: { "content-type": "text/event-stream" } });
    }
    const reader = request.body!.getReader();
    let text = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!text) firstBeforeClose = !producerClosed;
      text += new TextDecoder().decode(chunk.value);
    }
    return new Response(text);
  }, error() { return new Response(null, { status: 500 }); } });
  let proxy: Awaited<ReturnType<typeof createForwardProxy>> | undefined;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const target = new URL(`https://127.0.0.1:${server.port}`);
    proxy = await createForwardProxy(target);
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode("synthetic-first"));
      timer = setTimeout(() => {
        controller.enqueue(new TextEncoder().encode("-last"));
        producerClosed = true;
        controller.close();
      }, 100);
    }, cancel() { clearTimeout(timer); } });
    const response = await fetch(new URL("/codex/responses", target), {
      method: "POST", body, proxy: proxy.url, tls: { ca }, redirect: "error",
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]),
    });
    if (await response.text() !== "synthetic-first-last" || !firstBeforeClose) throw new Error("Transport smoke failed");
    const stream = await fetch(new URL("/api/providers", target), {
      proxy: proxy.url, tls: { ca }, redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]),
    });
    const reader = stream.body!.getReader();
    await reader.read();
    await reader.cancel();
    const until = Date.now() + 2500;
    while (!cancelled && Date.now() < until) await Bun.sleep(20);
    if (!cancelled) throw new Error("Transport cancellation smoke failed");
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    abort.abort();
    await proxy?.close();
    await server.stop(true);
  }
}

send({ type: "hello", protocol: 1, bun: Bun.version });
let pending = Buffer.alloc(0);
let total = 0;
try {
  for await (const chunk of process.stdin) {
    if (closing) break;
    total += chunk.length;
    pending = Buffer.concat([pending, chunk]);
    if (total > 128 * 1024 || pending.length > 64 * 1024 + 1) throw new Error("Input limit");
    let newline: number;
    while ((newline = pending.indexOf(10)) >= 0) {
      const message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(pending.subarray(0, newline)));
      pending = pending.subarray(newline + 1);
      if (!message || typeof message !== "object" || Array.isArray(message) || message.protocol !== 1) throw new Error("Invalid input");
      if (message.type === "close" && Object.keys(message).length === 2) { await close(); break; }
      if (started || message.type !== "start" || Object.keys(message).sort().join() !== "ca,key,protocol,target,type"
        || typeof message.target !== "string" || typeof message.ca !== "string" || typeof message.key !== "string") throw new Error("Invalid startup");
      started = true;
      const target = new URL(message.target);
      if (target.protocol !== "https:" || target.hostname !== "127.0.0.1" || target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw new Error("Invalid target");
      await smoke(message.ca, message.key);
      message.key = "";
      if (closing) break;
      send({ type: "event", name: "transport-smoke-complete" });
      reportProxy = true;
      const capability = `worker-fixture-${randomBytes(32).toString("hex")}`;
      relay = await createRelay(target, capability, message.ca, true);
      if (closing) { await relay.close(); break; }
      clearTimeout(deadline);
      send({ type: "ready", protocol: 1, bun: Bun.version, origin: relay.origin, capability });
    }
  }
  await close();
} catch {
  await close(1);
}
