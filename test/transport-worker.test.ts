import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { startTransportProcess, type TransportEvent, type TransportProcess } from "../src/transport-process";

const temporaryRoot = process.env.APERTURE_TEST_TMPDIR ?? tmpdir();
const capabilityHeader = "x-aperture-relay-capability";
const executable = process.execPath;
const workerPath = new URL("../scripts/fixtures/transport-worker.ts", import.meta.url).pathname;
const realTest = test.skipIf(Bun.version !== "1.4.2");

async function withWorker(run: (fixture: {
  worker: TransportProcess;
  gateway: ReturnType<typeof Bun.serve>;
  tls: { cert: string; key: string };
  events: TransportEvent[];
  observed: { discoveries: number; posts: number; privateHeaders: boolean; marker: string | null; firstChunk?: () => void };
}) => Promise<void>) {
  const directory = await mkdtemp(join(temporaryRoot, "transport-worker-"));
  let gateway: ReturnType<typeof Bun.serve> | undefined;
  let worker: TransportProcess | undefined;
  try {
    const certPath = join(directory, "cert.pem");
    const keyPath = join(directory, "key.pem");
    try {
      await promisify(execFile)(Bun.which("openssl") ?? "/usr/bin/openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
        "-keyout", keyPath, "-out", certPath,
      ], { timeout: 2_000, env: {}, maxBuffer: 64 * 1024 });
    } catch {
      // Do not expose openssl output or key material in test failures.
      throw new Error("Synthetic TLS certificate generation failed");
    }
    const tls = { cert: await readFile(certPath, "utf8"), key: await readFile(keyPath, "utf8") };
    const observed = { discoveries: 0, posts: 0, privateHeaders: false, marker: null as string | null,
      firstChunk: undefined as (() => void) | undefined };
    gateway = Bun.serve({ hostname: "127.0.0.1", port: 0, tls, async fetch(request) {
      observed.privateHeaders ||= [capabilityHeader, "proxy-authorization", "proxy-authenticate", "authorization"]
        .some(header => request.headers.has(header));
      const path = new URL(request.url).pathname;
      if (path === "/api/providers") {
        observed.discoveries++;
        return Response.json({ providers: [{ id: "synthetic", models: [] }] });
      }
      if (path !== "/codex/responses" || request.method !== "POST") return new Response(null, { status: 404 });
      observed.posts++;
      observed.marker = request.headers.get("x-aperture-relay-fixture");
      const reader = request.body!.getReader();
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          chunks.push(chunk.value);
          observed.firstChunk?.();
          observed.firstChunk = undefined;
        }
        const body = Buffer.concat(chunks);
        if (request.headers.get("x-fixture-gzip") === "1") {
          return new Response(Bun.gzipSync(body), { headers: {
            "content-type": "text/plain", "content-encoding": "gzip",
          } });
        }
        return new Response(body, { headers: { "content-type": "text/plain" } });
      } finally {
        reader.releaseLock();
      }
    }, error() { return new Response(null, { status: 500 }); } });
    const events: TransportEvent[] = [];
    worker = await startTransportProcess({
      runtime: { mode: "external", executable },
      workerPath,
      startup: { target: `https://127.0.0.1:${gateway.port}`, ca: tls.cert, key: tls.key },
      timeoutMs: 3_000,
      onEvent: event => events.push(event),
    });
    await run({ worker, gateway, tls, events, observed });
  } finally {
    try { await worker?.close(); } finally {
      try { await gateway?.stop(true); } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}

async function tcpRefused(origin: string) {
  const url = new URL(origin);
  const code = await new Promise<string | undefined>(resolve => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    const finish = (result?: string) => { socket.destroy(); resolve(result); };
    socket.setTimeout(1_000, () => finish("timeout"));
    socket.once("connect", () => finish("connected"));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code));
  });
  expect(code).toBe("ECONNREFUSED");
}

async function stdinEOF(startup?: { target: string; ca: string; key: string }) {
  const child = Bun.spawn([executable, "--no-env-file", "--config=/dev/null", workerPath], {
    cwd: dirname(workerPath), env: {}, stdin: "pipe", stdout: "pipe", stderr: "ignore",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reader = child.stdout.getReader();
  let origin: string | undefined;
  const ports: number[] = [];
  let hello = false;
  try {
    if (!startup) child.stdin.end();
    const consume = async () => {
      let pending = Buffer.alloc(0);
      let total = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.length;
        if (total > 64 * 1024) throw new Error("Worker stdout limit");
        pending = Buffer.concat([pending, chunk.value]);
        let newline: number;
        while ((newline = pending.indexOf(10)) !== -1) {
          // Never include raw protocol data (including capability or PEMs) in failures.
          let frame: Record<string, unknown>;
          try {
            frame = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(pending.subarray(0, newline)));
            if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw new Error();
          } catch { throw new Error("Invalid worker JSON frame"); }
          pending = pending.subarray(newline + 1);
          const keys = Object.keys(frame).sort().join();
          if (!hello && frame.type === "hello" && frame.protocol === 1 && frame.bun === "1.4.2"
            && keys === "bun,protocol,type") {
            hello = true;
            if (startup) {
              child.stdin.write(JSON.stringify({ ...startup, type: "start", protocol: 1 }) + "\n");
              await child.stdin.flush();
            }
          } else if (hello && startup && !origin && frame.type === "event"
            && ["name,type", "name,port,type"].includes(keys)
            && typeof frame.name === "string" && ["http-accepted", "connect-accepted", "tunnel-peer-port",
              "proxy-listening-port", "discovery-complete", "transport-smoke-complete"].includes(frame.name)
            && (!Object.hasOwn(frame, "port") || (Number.isInteger(frame.port)
              && Number(frame.port) > 0 && Number(frame.port) <= 65535))) {
            if (frame.name === "proxy-listening-port" && typeof frame.port === "number") ports.push(frame.port);
          } else if (hello && startup && !origin && frame.type === "ready" && frame.protocol === 1
            && frame.bun === "1.4.2" && keys === "bun,capability,origin,protocol,type"
            && typeof frame.capability === "string" && /^worker-fixture-[a-f0-9]{64}$/.test(frame.capability)
            && typeof frame.origin === "string" && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(frame.origin)
            && Number(new URL(frame.origin).port) <= 65535) {
            origin = frame.origin;
            child.stdin.end();
          } else { throw new Error("Unexpected worker protocol frame"); }
        }
      }
      if (pending.length) throw new Error("Incomplete worker frame");
      return await child.exited;
    };
    const code = await Promise.race([consume(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Worker stdin EOF timeout")), 4_000);
    })]);
    expect(code).toBe(0);
    expect(hello).toBe(true);
    expect(Boolean(origin)).toBe(Boolean(startup));
    expect(() => process.kill(child.pid, 0)).toThrow();
    if (origin) {
      await tcpRefused(origin);
      expect(ports.length).toBeGreaterThan(0);
      for (const port of ports) await tcpRefused(`http://127.0.0.1:${port}`);
    }
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
    await reader.cancel();
    reader.releaseLock();
    await child.exited;
  }
}

realTest("actual worker exits on parent stdin EOF before startup", async () => {
  await stdinEOF();
}, 6_000);

realTest("actual worker closes relay and proxy on parent stdin EOF after ready", async () => {
  await withWorker(async ({ gateway, tls }) => {
    await stdinEOF({ target: `https://127.0.0.1:${gateway.port}`, ca: tls.cert, key: tls.key });
  });
}, 10_000);

realTest("actual worker reports smoke/readiness and streams authenticated POST through HTTPS; close is idempotent", async () => {
  await withWorker(async ({ worker, events, observed }) => {
    expect(worker.bun).toBe("1.4.2");
    expect(worker.alive()).toBe(true);
    expect(events.filter(event => event.name === "transport-smoke-complete")).toHaveLength(1);
    expect(events.some(event => event.name === "discovery-complete")).toBe(true);
    expect(events.some(event => event.name === "connect-accepted")).toBe(true);
    expect(observed.discoveries).toBe(1);
    const url = `${worker.origin}/codex/responses`;
    for (const capability of [undefined, `worker-fixture-${randomBytes(32).toString("hex")}`]) {
      const response = await fetch(url, { method: "POST", body: "synthetic-denied",
        headers: capability ? { [capabilityHeader]: capability } : {}, signal: AbortSignal.timeout(1_500) });
      expect(response.status).toBe(403);
      await response.text();
    }
    expect(observed.posts).toBe(0);
    for (const [name, value] of [["host", "invalid.example"], ["origin", worker.origin]] as const) {
      const response = await fetch(url, { method: "POST", body: "synthetic-denied",
        headers: { [capabilityHeader]: worker.capability, [name]: value }, signal: AbortSignal.timeout(1_500) });
      expect(response.status).toBe(403);
      await response.text();
    }
    expect(observed.posts).toBe(0);
    expect(observed.discoveries).toBe(1);
    let producerClosed = false;
    let firstBeforeClose = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode("synthetic-first"));
      // Only release the final chunk once the HTTPS gateway has received the first.
      observed.firstChunk = () => {
        firstBeforeClose = !producerClosed;
        controller.enqueue(new TextEncoder().encode("-last"));
        producerClosed = true;
        controller.close();
      };
    }, cancel() { observed.firstChunk = undefined; } });
    const abort = new AbortController();
    try {
      const response = await fetch(url, { method: "POST", body,
        headers: { [capabilityHeader]: worker.capability, "proxy-authorization": "Basic synthetic-only" },
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1_500)]) });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("synthetic-first-last");
      expect(firstBeforeClose).toBe(true);
      expect(observed.posts).toBe(1);
      expect(observed.privateHeaders).toBe(false);
      expect(observed.marker).toBe("forwarded");
    } finally {
      observed.firstChunk = undefined;
      abort.abort();
    }
    const compressed = await fetch(url, { method: "POST", body: "synthetic-gzip-response",
      headers: { [capabilityHeader]: worker.capability, "x-fixture-gzip": "1" },
      signal: AbortSignal.timeout(1_500) });
    expect(compressed.status).toBe(200);
    expect(compressed.headers.has("content-encoding")).toBe(false);
    expect(await compressed.text()).toBe("synthetic-gzip-response");
    expect(observed.posts).toBe(2);
    const closing = worker.close();
    expect(worker.close()).toBe(closing);
    await closing;
    await worker.close();
    expect(worker.alive()).toBe(false);
    expect(() => worker.capability).toThrow("not alive");
    expect(() => process.kill(worker.pid, 0)).toThrow();
    await tcpRefused(worker.origin);
  });
}, 10_000);

realTest("gateway loss returns 502 then latches 503 on the bound relay without restart or direct fallback", async () => {
  await withWorker(async ({ worker, gateway, tls, events }) => {
    const origin = worker.origin;
    const pid = worker.pid;
    const port = gateway.port;
    const post = () => fetch(`${origin}/codex/responses`, { method: "POST", body: "synthetic-failure",
      headers: { [capabilityHeader]: worker.capability }, signal: AbortSignal.timeout(1_500) });
    await gateway.stop(true);
    const first = await post();
    expect(first.status).toBe(502);
    await first.text();
    const eventCount = events.length;
    let recoveryHits = 0;
    const recovered = Bun.serve({ hostname: "127.0.0.1", port, tls, fetch() {
      recoveryHits++;
      return Response.json({ synthetic: "must not recover transparently" });
    } });
    try {
      for (let i = 0; i < 2; i++) {
        const response = await post();
        expect(response.status).toBe(503);
        await response.text();
      }
      expect(recoveryHits).toBe(0);
      expect(events).toHaveLength(eventCount);
      expect(worker.alive()).toBe(true);
      expect(worker.origin).toBe(origin);
      expect(worker.pid).toBe(pid);
      await worker.close();
      expect(() => process.kill(pid, 0)).toThrow();
      await tcpRefused(origin);
    } finally {
      await recovered.stop(true);
    }
  });
}, 10_000);

realTest("killing the actual worker invalidates supervisor liveness and capability access", async () => {
  await withWorker(async ({ worker }) => {
    process.kill(worker.pid, "SIGKILL");
    const deadline = Date.now() + 1_500;
    while (worker.alive() && Date.now() < deadline) await Bun.sleep(10);
    expect(worker.alive()).toBe(false);
    expect(() => worker.capability).toThrow("not alive");
    await worker.close();
    expect(() => process.kill(worker.pid, 0)).toThrow();
    await tcpRefused(worker.origin);
    // This does not exercise native retries holding a cached capability/relay port.
  });
}, 10_000);
