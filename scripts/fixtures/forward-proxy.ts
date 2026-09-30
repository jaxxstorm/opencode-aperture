import { randomBytes } from "node:crypto";
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";

const timeout = 60_000;

export async function createForwardProxy(target: URL): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  // Snapshot the allowlist so callers cannot mutate it after startup.
  const destination = new URL(target.href);
  if (
    !["http:", "https:"].includes(destination.protocol) ||
    destination.hostname !== "127.0.0.1" ||
    destination.username || destination.password ||
    destination.pathname !== "/" || destination.search || destination.hash ||
    destination.href.includes("?") || destination.href.includes("#")
  ) throw new Error("Invalid proxy fixture target");

  const password = `proxy-fixture-${randomBytes(32).toString("hex")}`;
  const authorization = `Basic ${Buffer.from(`tsnet:${password}`).toString("base64")}`;
  const sockets = new Set<Duplex>();
  const cancellations = new Set<() => void>();
  let closing = false;
  let closed: Promise<void> | undefined;

  function track(socket: Socket) {
    if (sockets.has(socket)) return;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(timeout, () => socket.destroy());
    if (closing) socket.destroy();
  }

  function headers(input: IncomingHttpHeaders): IncomingHttpHeaders {
    const result = { ...input };
    const nominated = (input.connection ?? "").split(",").map(name => name.trim().toLowerCase());
    for (const name of [
      ...nominated, "host", "connection", "keep-alive", "proxy-authenticate",
      "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding",
      "upgrade", "x-aperture-relay-capability",
    ]) delete result[name];
    return result;
  }

  const server = createServer((incoming, outgoing) => {
    if (incoming.headers["proxy-authorization"] !== authorization) {
      outgoing.writeHead(407, { "Proxy-Authenticate": 'Basic realm="fixture"', Connection: "close" });
      outgoing.end();
      return;
    }
    let url: URL;
    try {
      url = new URL(incoming.url ?? "");
      if (
        closing || destination.protocol !== "http:" ||
        !incoming.url?.startsWith("http://") || url.origin !== destination.origin ||
        url.username || url.password || url.search || url.hash ||
        incoming.url.includes("?") || incoming.url.includes("#") ||
        !["/api/providers", "/codex/responses"].includes(url.pathname)
      ) throw new Error("Rejected");
    } catch {
      outgoing.writeHead(403, { Connection: "close" });
      outgoing.end();
      return;
    }

    const controller = new AbortController();
    let responseStream: IncomingMessage | undefined;
    const upstream = request({
      signal: controller.signal,
      hostname: destination.hostname,
      port: destination.port || 80,
      path: url.pathname,
      method: incoming.method,
      headers: headers(incoming.headers),
      agent: false,
    }, response => {
      // Bun 1.3's HTTP socket does not reliably emit a connect event.
      console.log("[aperture-proxy-fixture] http accepted");
      responseStream = response;
      outgoing.writeHead(response.statusCode ?? 502, headers(response.headers));
      response.on("error", () => outgoing.destroy());
      response.on("close", () => {
        if (!response.complete) outgoing.destroy();
      });
      response.pipe(outgoing);
    });
    upstream.on("socket", track);
    upstream.setTimeout(timeout, () => upstream.destroy());
    upstream.on("error", () => {
      if (outgoing.destroyed) return;
      if (outgoing.headersSent) outgoing.destroy();
      else {
        outgoing.writeHead(502, { Connection: "close" });
        outgoing.end();
      }
    });
    const client = incoming.socket;
    let cancelled = false;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      clearInterval(watch);
      cancellations.delete(cancel);
      client.removeListener("close", cancel);
      controller.abort();
      upstream.destroy();
      responseStream?.destroy();
      outgoing.destroy();
    };
    // Bun 1.3 can omit close/aborted events after a complete request body.
    // Its public socket address is cleared on disconnect even in that case.
    const started = Date.now();
    const watch = setInterval(() => {
      if (!client.remoteAddress || Date.now() - started >= timeout) cancel();
    }, 100);
    watch.unref();
    cancellations.add(cancel);
    incoming.on("aborted", cancel);
    incoming.socket.once("close", cancel);
    incoming.on("error", cancel);
    outgoing.on("close", cancel);
    outgoing.on("error", cancel);
    incoming.pipe(upstream);
  });

  server.on("connection", track);
  server.on("connect", (incoming, client, head) => {
    track(client as Socket);
    if (incoming.headers["proxy-authorization"] !== authorization) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="fixture"\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (closing || destination.protocol !== "https:" || incoming.url !== destination.host) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    client.pause();
    const upstream = connect({ host: destination.hostname, port: Number(destination.port || 443) });
    track(upstream);
    client.once("close", () => upstream.destroy());
    upstream.once("close", () => {
      // A normal EOF lets pipe flush queued bytes before ending the client.
      if (!upstream.readableEnded) client.destroy();
    });
    upstream.once("error", () => client.destroy());
    upstream.once("connect", () => {
      if (client.destroyed || closing) {
        upstream.destroy();
        return;
      }
      console.log("[aperture-proxy-fixture] connect accepted");
      console.log(`[aperture-proxy-fixture] tunnel-peer-port=${upstream.localPort}`);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      // Queue the parser's already-read bytes before resuming the tunnel.
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.headersTimeout = timeout;
  server.requestTimeout = timeout;
  server.setTimeout(timeout, socket => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new Error("Proxy fixture failed to listen")));
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Proxy fixture failed to listen");
  console.log(`[aperture-proxy-fixture] listening-port=${address.port}`);

  return {
    url: `http://tsnet:${password}@127.0.0.1:${address.port}`,
    close() {
      if (!closed) {
        closing = true;
        closed = new Promise<void>(resolve => {
          for (const cancel of cancellations) cancel();
          // Includes detached CONNECT sockets, which server.close does not own.
          for (const socket of sockets) socket.destroy();
          // Also close clients that have not yet sent a complete request header.
          // Bun 1.3 requires this before close(), which detaches its server handle.
          server.closeAllConnections();
          server.close(() => resolve());
        });
      }
      return closed;
    },
  };
}
