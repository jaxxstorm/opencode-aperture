import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createForwardProxy } from "./fixtures/forward-proxy";

// Synthetic transport differential only; this does not exercise native integration.
const emit = console.log.bind(console);
// The shared fixture logs successful tunnels. Never expose its logs or raw errors.
console.log = console.info = console.warn = console.error = console.debug = () => {};
let failures = 0;
function report(name: string, pass: boolean) {
  if (!pass) failures++;
  emit(JSON.stringify({ case: name, status: pass ? "pass" : "fail" }));
}
emit(JSON.stringify({ bun: Bun.version, revision: Bun.revision }));

const deadline = 3_000;
const expired = Symbol("deadline");
async function bounded<T>(operation: Promise<T>, ms = deadline): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(expired), ms); }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const hash = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
const chunks = ["synthetic-first\n", "synthetic-second\n", "synthetic-last\n"].map(s => Buffer.from(s));
const payload = Buffer.concat(chunks);
const expectedHash = hash(payload);
type Certificate = { key: Buffer; cert: Buffer };
type Case = "discovery" | "fixed-post" | "stream-post" | "stream-producer-abort" | "untrusted" | "wrong-hostname" | "redirect-error" | "sse-cancel";

async function certificate(root: string, name: string, san: string): Promise<Certificate> {
  const key = join(root, `${name}.key`);
  const cert = join(root, `${name}.crt`);
  const process = Bun.spawn([
    "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=synthetic-probe", "-addext", `subjectAltName=${san}`,
    "-keyout", key, "-out", cert,
  ], { stdout: "ignore", stderr: "ignore" });
  try {
    if (await bounded(process.exited) !== 0) throw new Error("certificate");
  } finally {
    if (process.exitCode === null) {
      process.kill("SIGKILL");
      await bounded(process.exited);
    }
  }
  return { key: await readFile(key), cert: await readFile(cert) };
}

async function portClosed(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: "127.0.0.1", port });
    const timer = setTimeout(() => finish(false), 250);
    function finish(pass: boolean) {
      clearTimeout(timer);
      socket.destroy();
      resolve(pass);
    }
    socket.once("connect", () => finish(false));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED"));
  });
}

async function run(mode: "direct" | "connect", name: Case, good: Certificate, wrong: Certificate) {
  const label = `${mode}/${name}`;
  const abort = new AbortController();
  let proxy: Awaited<ReturnType<typeof createForwardProxy>> | undefined;
  let gateway: ReturnType<typeof Bun.serve> | undefined;
  let sink: ReturnType<typeof Bun.serve> | undefined;
  const ports: number[] = [];
  let requests = 0;
  let sinkRequests = 0;
  let receivedChunks = 0;
  let receivedBytes = 0;
  let receivedHash = "";
  let producerClosed = false;
  let producerAborted = false;
  let producerCancelled = false;
  let firstBeforeClose = false;
  let upstreamCancelled = false;
  let stopProducer = () => {};
  let stopSSE = () => {};
  let timedOut = false;
  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const tls = name === "wrong-hostname" ? wrong : good;
    sink = Bun.serve({
      hostname: "127.0.0.1", port: 0, tls: good,
      fetch() { sinkRequests++; return new Response("synthetic-sink"); },
    });
    ports.push(sink.port!);
    const sinkURL = `https://127.0.0.1:${sink.port}/sink`;
    gateway = Bun.serve({
      hostname: "127.0.0.1", port: 0, tls,
      async fetch(request) {
        requests++;
        if (name === "discovery") return Response.json({ synthetic: true });
        if (name === "redirect-error") return Response.redirect(sinkURL, 307);
        if (name === "sse-cancel") {
          request.signal.addEventListener("abort", () => { upstreamCancelled = true; stopSSE(); }, { once: true });
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              let stopped = false;
              const timer = setInterval(() => {
                if (stopped) return;
                try { controller.enqueue(Buffer.from("data: synthetic\n\n")); }
                catch { stopSSE(); }
              }, 25);
              stopSSE = () => { stopped = true; clearInterval(timer); };
            },
            cancel() { upstreamCancelled = true; stopSSE(); },
          }), { headers: { "content-type": "text/event-stream" } });
        }
        try {
          const body = request.body?.getReader();
          if (!body) return new Response("missing", { status: 400 });
          const digest = createHash("sha256");
          while (true) {
            const { done, value } = await body.read();
            if (done) break;
            if (!receivedChunks) firstBeforeClose = !producerClosed;
            receivedChunks++;
            receivedBytes += value.byteLength;
            digest.update(value);
          }
          receivedHash = digest.digest("hex");
          return new Response(request.method === "POST" && receivedHash === expectedHash ? "synthetic-ok" : "mismatch");
        } catch {
          return new Response(null, { status: 499 });
        }
      },
      error() { return new Response(null, { status: 500 }); },
    });
    ports.push(gateway.port!);
    const target = new URL(`https://127.0.0.1:${gateway.port}/`);
    if (mode === "connect") {
      proxy = await bounded(createForwardProxy(target));
      ports.push(Number(new URL(proxy.url).port));
    }
    const options = {
      proxy: proxy?.url,
      tls: { ca: name === "untrusted" ? wrong.cert : tls.cert, rejectUnauthorized: true },
      signal: abort.signal,
      redirect: "error" as const,
      keepalive: false,
    };
    const work = async () => {
      if (name === "untrusted" || name === "wrong-hostname" || name === "redirect-error") {
        let rejected = false;
        try { await fetch(new URL("codex/responses", target), options); }
        catch (error) {
          const code = (error as { code?: string })?.code;
          rejected = !abort.signal.aborted && (name === "redirect-error" || (
            name === "wrong-hostname"
              ? code === "ERR_TLS_CERT_ALTNAME_INVALID"
              : code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
          ));
        }
        await sleep(100);
        return rejected && sinkRequests === 0 && requests === (name === "redirect-error" ? 1 : 0);
      }
      if (name === "sse-cancel") {
        const response = await fetch(new URL("codex/responses", target), options);
        const reader = response.body!.getReader();
        const first = await reader.read();
        if (first.done || !first.value.length) return false;
        await reader.cancel();
        // Do not abort fetch here: prove response-reader cancellation propagates.
        while (!upstreamCancelled && !abort.signal.aborted) await sleep(20);
        return response.ok && upstreamCancelled;
      }
      if (name === "discovery") {
        const response = await fetch(new URL("api/providers", target), options);
        return response.ok && (await response.json()).synthetic === true;
      }
      let body: BodyInit = payload;
      if (name === "stream-post" || name === "stream-producer-abort") {
        body = new ReadableStream<Uint8Array>({
          start(controller) {
            let stopped = false;
            let index = 0;
            let timer: ReturnType<typeof setTimeout>;
            stopProducer = () => { stopped = true; clearTimeout(timer); };
            abort.signal.addEventListener("abort", () => {
              producerAborted = !producerClosed;
              stopProducer();
              if (!producerClosed && !producerCancelled) {
                try { controller.error(new Error("synthetic-abort")); } catch {}
              }
            }, { once: true });
            const produce = () => {
              if (stopped) return;
              try {
                if (index < chunks.length || name === "stream-producer-abort") {
                  controller.enqueue(chunks[index++ % chunks.length]!);
                  timer = setTimeout(produce, 75);
                } else {
                  producerClosed = true;
                  controller.close();
                }
              } catch { stopProducer(); }
            };
            timer = setTimeout(produce, 25);
          },
          cancel() { producerCancelled = true; stopProducer(); },
        });
      }
      if (name === "stream-producer-abort") {
        abortTimer = setTimeout(() => abort.abort(), 175);
        try {
          await fetch(new URL("codex/responses", target), { ...options, method: "POST", body });
          return false;
        } catch {
          return abort.signal.aborted && producerAborted && !producerClosed;
        }
      }
      const response = await fetch(new URL("codex/responses", target), { ...options, method: "POST", body });
      return response.ok && await response.text() === "synthetic-ok" && receivedBytes === payload.length && receivedHash === expectedHash;
    };
    try { report(label, await bounded(work())); }
    catch (error) { timedOut = error === expired; report(label, false); }
    if (timedOut) report(`${label}/deadline`, false);
    if (name === "stream-post") {
      report(`${label}/first-chunk-before-producer-close`, receivedChunks > 0 && firstBeforeClose);
      report(`${label}/producer-completed`, producerClosed && !producerCancelled);
    }
  } catch {
    report(`${label}/setup`, false);
  } finally {
    clearTimeout(abortTimer);
    abort.abort();
    stopProducer();
    stopSSE();
    if (name === "stream-post" && !producerClosed) {
      report(`${label}/producer-abort-captured`, producerAborted || producerCancelled);
    }
    // Detached CONNECT sockets belong to the proxy, so close it before TLS servers.
    let cleaned = true;
    try { if (proxy) await bounded(proxy.close()); } catch { cleaned = false; }
    for (const server of [gateway, sink]) {
      try { if (server) await bounded(Promise.resolve(server.stop(true))); } catch { cleaned = false; }
    }
    await sleep(30);
    report(`${label}/cleanup`, (await Promise.all(ports.map(portClosed))).every(Boolean) && cleaned);
  }
}

let root: string | undefined;
// A last-resort process bound also covers unexpected runtime stalls during cleanup.
const watchdog = setTimeout(() => {
  report("process-deadline", false);
  process.exit(1);
}, 90_000);
try {
  root = await mkdtemp(join(process.env.APERTURE_TEST_TMPDIR || tmpdir(), "aperture-connect-"));
  const good = await certificate(root, "loopback", "IP:127.0.0.1");
  const wrong = await certificate(root, "wrong-host", "DNS:not-loopback.invalid");
  for (const mode of ["direct", "connect"] as const) {
    for (const name of ["discovery", "fixed-post", "stream-post", "stream-producer-abort", "untrusted", "wrong-hostname", "redirect-error", "sse-cancel"] as const) {
      await run(mode, name, good, wrong);
    }
  }
} catch {
  report("setup", false);
} finally {
  try {
    if (root) {
      await bounded(rm(root, { recursive: true, force: true }));
      report("temporary-storage-cleanup", true);
    }
  }
  catch { report("temporary-storage-cleanup", false); }
  clearTimeout(watchdog);
}
// Force exit after bounded cleanup rather than hanging on runtime-owned idle sockets.
process.exit(failures ? 1 : 0);
