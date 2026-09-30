import { randomBytes } from "node:crypto";
import { createServer, request, type IncomingMessage, type OutgoingHttpHeaders, type Server } from "node:http";
import type { Socket } from "node:net";
import type { BridgeSession } from "./bridge-client";
import { resolveGatewayPath } from "./gateway-path";

const nativeCapability = "x-aperture-relay-capability";
const workerCapability = "x-aperture-worker-capability";
const required = new Set(["authorization", "x-api-key", "x-goog-api-key", "cookie", "chatgpt-account-id", "user-agent", "session-id", "session_id", "openai-beta", "originator", "content-type", "accept", nativeCapability, workerCapability]);
const hop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "host", nativeCapability, workerCapability]);
type Route = { session: BridgeSession; failed: boolean; active: Set<() => void>; fail(): void };
const routes = new Map<string, Route>();
const sockets = new Set<Socket>();
let listener: Promise<{ server: Server; origin: string }> | undefined;

function nominations(message: IncomingMessage): string[] {
  const result: string[] = [];
  for (let i = 0; i < message.rawHeaders.length; i += 2) {
    if (message.rawHeaders[i]!.toLowerCase() === "connection") {
      result.push(...message.rawHeaders[i + 1]!.split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
    }
  }
  return result;
}

function headers(message: IncomingMessage): OutgoingHttpHeaders {
  const blocked = new Set([...hop, ...nominations(message)]);
  const result: OutgoingHttpHeaders = Object.create(null);
  for (let i = 0; i < message.rawHeaders.length; i += 2) {
    const name = message.rawHeaders[i]!.toLowerCase();
    if (blocked.has(name) || name.startsWith("proxy-")) continue;
    const value = message.rawHeaders[i + 1]!;
    const previous = result[name];
    result[name] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [String(previous)]), value];
  }
  return result;
}

function listen() {
  if (listener) return listener;
  listener = new Promise((resolve, reject) => {
    let authority = "";
    const server = createServer((incoming, outgoing) => {
      const deny = (status: number) => { outgoing.writeHead(status, { connection: "close" }); outgoing.end(); };
      if (incoming.method !== "POST" || !resolveGatewayPath(incoming.url ?? "")) { deny(404); return; }
      const values = (name: string) => {
        const found: string[] = [];
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
          if (incoming.rawHeaders[i]!.toLowerCase() === name) found.push(incoming.rawHeaders[i + 1]!);
        }
        return found;
      };
      const hosts = values("host");
      const caps = values(nativeCapability);
      if (hosts.length !== 1 || hosts[0] !== authority || values("origin").length || caps.length !== 1
        || nominations(incoming).some(name => required.has(name) || name.startsWith("x-amz-"))) { deny(403); return; }
      const route = routes.get(caps[0]!);
      if (!route) { deny(403); return; }
      if (route.session.signal.aborted || !route.session.alive()) route.fail();
      if (route.failed) { deny(503); return; }

      const forwarded = headers(incoming);
      forwarded.host = "worker.internal";
      forwarded[workerCapability] = route.session.capability;
      let upstream: ReturnType<typeof request>;
      let response: IncomingMessage | undefined;
      let polling: ReturnType<typeof setInterval> | undefined;
      let finished = false;
      const socket = incoming.socket;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearInterval(polling);
        route.active.delete(cancel);
        incoming.removeListener("aborted", cancel);
        incoming.removeListener("error", cancel);
        outgoing.removeListener("close", cancel);
        outgoing.removeListener("error", cancel);
        outgoing.removeListener("finish", complete);
        socket.removeListener("close", cancel);
      };
      const cancel = () => {
        cleanup();
        incoming.unpipe(upstream);
        response?.destroy();
        upstream?.destroy();
        outgoing.destroy();
      };
      const complete = () => { cleanup(); upstream?.destroy(); };
      const failure = () => {
        if (finished) return;
        cleanup();
        incoming.unpipe(upstream);
        response?.destroy();
        upstream?.destroy();
        if (outgoing.headersSent) outgoing.destroy(); else deny(502);
      };
      try {
        upstream = request({ socketPath: route.session.socketPath, path: incoming.url, method: "POST", headers: forwarded, agent: false }, reply => {
          response = reply;
          if (finished) { reply.destroy(); return; }
          if (reply.statusCode! >= 300 && reply.statusCode! < 400) { failure(); return; }
          reply.on("error", failure);
          reply.on("aborted", failure);
          outgoing.writeHead(reply.statusCode!, headers(reply));
          reply.pipe(outgoing);
        });
        upstream.on("error", failure);
        route.active.add(cancel);
        incoming.on("aborted", cancel);
        incoming.on("error", cancel);
        outgoing.on("close", cancel);
        outgoing.on("error", cancel);
        outgoing.on("finish", complete);
        socket.on("close", cancel);
        // Bun 1.3 can omit disconnect events; no deadline on legitimate streams.
        if (process.versions.bun?.startsWith("1.3.") && socket.remoteAddress) {
          polling = setInterval(() => { if (!socket.remoteAddress) cancel(); }, 100);
          polling.unref();
        }
        incoming.pipe(upstream);
      } catch { failure(); }
    });
    server.timeout = 0;
    server.requestTimeout = 0;
    server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    server.on("error", () => reject(new Error("Aperture ingress: LISTEN_FAILED")));
    server.listen(0, "127.0.0.1", () => {
      authority = `127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
      server.unref();
      resolve({ server, origin: `http://${authority}` });
    });
  });
  return listener;
}

export async function attachBridgeIngress(session: BridgeSession): Promise<{ origin: string; capability: string; close(): Promise<void> }> {
  if (routes.size >= 64) throw new Error("Aperture ingress: ROUTE_LIMIT");
  const capability = `aperture-relay-${randomBytes(32).toString("hex")}`;
  const route: Route = { session, failed: false, active: new Set(), fail() {
    route.failed = true;
    for (const cancel of route.active) cancel();
  } };
  routes.set(capability, route);
  session.signal.addEventListener("abort", route.fail, { once: true });
  if (session.signal.aborted || !session.alive()) route.fail();
  const close = async () => {
    routes.delete(capability);
    session.signal.removeEventListener("abort", route.fail);
    route.fail();
  };
  try {
    const { origin } = await listen();
    return { origin, capability, close };
  } catch { await close(); throw new Error("Aperture ingress: LISTEN_FAILED"); }
}

// Test teardown only. Production retains the port until the parent exits.
export async function shutdownBridgeIngress(): Promise<void> {
  for (const route of routes.values()) {
    route.session.signal.removeEventListener("abort", route.fail);
    route.fail();
  }
  routes.clear();
  const pending = listener;
  listener = undefined;
  if (!pending) return;
  const { server } = await pending;
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
