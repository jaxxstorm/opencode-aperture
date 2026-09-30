// Loopback test transport shared by in-host and separate-worker proofs.
import { createForwardProxy } from "./forward-proxy";

export const capabilityHeader = "x-aperture-relay-capability";

export async function createRelay(target: URL, capability: string, ca?: string, useProxy = false) {
  if (!["http:", "https:"].includes(target.protocol) || target.hostname !== "127.0.0.1"
    || target.pathname !== "/" || target.username || target.password || target.search || target.hash) {
    throw new Error("Relay fixture requires a numeric loopback origin");
  }
  let proxy: Awaited<ReturnType<typeof createForwardProxy>> | undefined;
  let relay: ReturnType<typeof Bun.serve> | undefined;
  let failed = false;
  const requests = new Set<AbortController>();
  const clean = (input: Headers) => {
    const result = new Headers(input);
    const nominated = (result.get("connection") ?? "").split(",").map(value => value.trim()).filter(Boolean);
    for (const name of [...nominated, capabilityHeader, "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "content-length"]) result.delete(name);
    return result;
  };
  try {
    if (useProxy) {
      proxy = await createForwardProxy(target);
      const discovery = await fetch(new URL("/api/providers", target), {
        proxy: proxy.url, ...(ca ? { tls: { ca } } : {}), redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      if (!discovery.ok) { await discovery.body?.cancel(); throw new Error("Proxied fixture discovery failed"); }
      await discovery.json();
      console.log("[aperture-relay-fixture] proxied discovery complete");
    }
    relay = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 60, async fetch(request) {
      const local = new URL(request.url);
      if (request.headers.get("host") !== `127.0.0.1:${relay!.port}` || request.headers.has("origin")) return new Response(null, { status: 403 });
      if (local.pathname !== "/codex/responses" || local.search || request.method !== "POST") return new Response(null, { status: 404 });
      if (request.headers.get(capabilityHeader) !== capability) return new Response(null, { status: 403 });
      if (failed) return new Response(null, { status: 503 });
      const controller = new AbortController();
      requests.add(controller);
      const abort = () => controller.abort();
      request.signal.addEventListener("abort", abort, { once: true });
      try {
        const headers = clean(request.headers);
        headers.set("x-aperture-relay-fixture", "forwarded");
        const response = await fetch(new URL("/codex/responses", target), {
          method: "POST", headers, body: request.body, redirect: "error",
          signal: AbortSignal.any([request.signal, controller.signal]),
          ...(proxy ? { proxy: proxy.url } : {}), ...(ca ? { tls: { ca } } : {}),
        });
        const responseHeaders = clean(response.headers);
        // Bun fetch decodes compressed upstream bodies before exposing the stream.
        responseHeaders.delete("content-encoding");
        // Pipe rather than buffer, and retain cancellation through response consumption.
        const reader = response.body?.getReader();
        const finish = () => { requests.delete(controller); request.signal.removeEventListener("abort", abort); };
        if (!reader) { finish(); return new Response(null, { status: response.status, headers: responseHeaders }); }
        const body = new ReadableStream<Uint8Array>({
          async pull(output) {
            try {
              const chunk = await reader.read();
              if (chunk.done) { finish(); output.close(); } else output.enqueue(chunk.value);
            } catch { finish(); output.error(new Error("Relay stream failed")); }
          },
          async cancel() { controller.abort(); finish(); await reader.cancel().catch(() => {}); },
        });
        return new Response(body, { status: response.status, headers: responseHeaders });
      } catch {
        requests.delete(controller);
        request.signal.removeEventListener("abort", abort);
        if (!request.signal.aborted) {
          failed = true;
          for (const active of requests) active.abort();
          await proxy?.close();
          proxy = undefined;
        }
        return new Response(null, { status: 502 });
      }
    } });
    return {
      origin: `http://127.0.0.1:${relay.port}`,
      async close() {
        failed = true;
        for (const active of requests) active.abort();
        await relay?.stop(true);
        await proxy?.close();
      },
    };
  } catch {
    await relay?.stop(true);
    await proxy?.close();
    throw new Error("Relay fixture setup failed");
  }
}
