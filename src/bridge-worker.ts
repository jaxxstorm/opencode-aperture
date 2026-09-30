import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { ApertureSetupError, apertureHost, fetchApertureProviders, selectOpenAISubscriptionProvider, type ProviderInfo } from "./aperture-codex-plugin";
import { validBridgeStart, validBridgeProviders, type BridgeStart, type BRIDGE_FAILURE_CODES } from "./bridge-client";
import { resolveGatewayPath } from "./gateway-path";
import { prepareAndClaimBridgeState } from "./bridge-settings";

type Bridge = { httpProxyURL(): string; close(): Promise<void> };
type FailureCode = typeof BRIDGE_FAILURE_CODES[number];
const upstreamFailureCodes: ReadonlySet<string> = new Set<FailureCode>([
  "AUTH_REQUIRED", "AUTH_FAILED", "STATE_UNSAFE", "STATE_LOCKED", "HELPER_UNAVAILABLE",
  "UNSUPPORTED_PLATFORM", "HELPER_FAILED", "CALLBACK_FAILED", "INVALID_OPTIONS", "CANCELLED", "CLOSED",
  "STARTUP_TIMEOUT", "PROTOCOL_ERROR",
]);
const write = process.stdout.write.bind(process.stdout);
// Dependencies must not accidentally publish diagnostic output on the control pipe.
console.log = console.info = console.debug = console.warn = console.error = () => {};
function send(message: unknown) {
  const line = JSON.stringify(message);
  if (Buffer.byteLength(line) > 64 * 1024) throw new Error("PROTOCOL_ERROR");
  write(line + "\n");
}
let bridge: Bridge | undefined;
let server: Server | undefined;
let started = false;
let failed = false;
let closing: Promise<void> | undefined;
let stoppingBridge: Promise<void> | undefined;
let releaseLease: (() => Promise<void>) | undefined;
let bridgeStopped = false;
let poll: ReturnType<typeof setInterval> | undefined;
const startupAbort = new AbortController();
const active = new Set<AbortController>();
let startupTask: Promise<void> | undefined;
let discover: (() => Promise<{ models: string[]; providers?: ProviderInfo[] }>) | undefined;
let ready = false;
let discovering = false;
let lastId = 0;
let deadline = setTimeout(() => { failure("STARTUP_TIMEOUT"); void close(); }, 300_000);

function stopBridge(): Promise<void> {
  if (!bridge) return Promise.resolve();
  return stoppingBridge ??= Promise.resolve().then(() => bridge!.close()).then(() => { bridgeStopped = true; }).catch(() => {});
}
function failure(code: FailureCode) {
  if (failed || closing) return;
  failed = true;
  clearTimeout(deadline);
  clearInterval(poll);
  startupAbort.abort();
  for (const request of active) request.abort();
  send({ type: "failure", code });
  void stopBridge();
}
function close(): Promise<void> {
  if (closing) return closing;
  clearTimeout(deadline);
  clearInterval(poll);
  startupAbort.abort();
  for (const request of active) request.abort();
  closing = Promise.resolve().then(async () => {
    const force = setTimeout(() => process.exit(1), 6500);
    const stopped = server ? new Promise<void>(resolve => {
      server!.close(() => resolve());
      server!.closeAllConnections();
    }) : Promise.resolve();
    await startupTask?.catch(() => {});
    await Promise.all([stopped, stopBridge()]);
    if (!bridge || bridgeStopped) await releaseLease?.().catch(() => {});
    clearTimeout(force);
    process.exit(0);
  });
  return closing;
}

const capabilityHeader = "x-aperture-worker-capability";
const hopHeaders = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", capabilityHeader, "x-aperture-relay-capability"];
function cleanHeaders(input: Headers): Headers {
  const headers = new Headers(input);
  const nominated = (headers.get("connection") ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  for (const name of [...hopHeaders, ...nominated]) headers.delete(name);
  return headers;
}

async function start(s: BridgeStart) {
  let code: FailureCode = "MODULE_UNAVAILABLE";
  try {
    const module = s.modulePath ? await import(pathToFileURL(s.modulePath).href)
      // Optional deployment dependency; publication must externalize this import.
      // @ts-ignore -- the optional bridge package is not a development dependency.
      : await import("@jaxxstorm/bun-tailscale-bridge");
    if (closing || failed) return;
    if (typeof module.createBridge !== "function") throw 0;
    code = "BRIDGE_FAILED";
    try {
      releaseLease = await prepareAndClaimBridgeState(s.stateDir);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.startsWith("Aperture profile is locked")) code = "STATE_LOCKED";
        else if (error.message === "Invalid or unsafe Aperture bridge settings") code = "STATE_UNSAFE";
      }
      throw error;
    }
    if (closing || failed) return;
    bridge = await module.createBridge({ hostname: s.hostname, stateDir: s.stateDir,
      authKey: s.authKey, startupTimeoutMs: s.timeoutMs, signal: startupAbort.signal,
      ...(s.browser ? { onAuthRequired: ({ url }: { url: string }) => {
        if (closing || failed) return;
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || /[\s\0]/.test(url)) throw 0;
        send({ type: "auth-required", url });
      } } : {}),
    });
    s.authKey = undefined;
    if (!bridge || typeof bridge.httpProxyURL !== "function" || typeof bridge.close !== "function") throw 0;
    if (closing || failed) { await stopBridge(); return; }
    const capability = `aperture-worker-${randomBytes(32).toString("hex")}`;
    let models: string[] = [];
    let providers: ProviderInfo[] | undefined = s.catalog === true ? [] : undefined;
    if (s.action === "connect") {
      const gateway = apertureHost({ APERTURE_HOST: s.gateway });
      poll = setInterval(() => {
        try { bridge!.httpProxyURL(); } catch { failure("TRANSPORT_FAILED"); }
      }, 100);
      code = "DISCOVERY_FAILED";
      discover = async () => {
        const providers = await fetchApertureProviders(gateway, (url: string | URL | Request, init?: RequestInit) => fetch(url, {
          ...init, proxy: bridge!.httpProxyURL(), redirect: "error",
          signal: AbortSignal.any([startupAbort.signal, ...(init?.signal ? [init.signal] : [])]),
        }));
        if (s.catalog === true) {
          // Project public discovery records onto the private wire schema. Gateway
          // metadata such as descriptions must not invalidate or enter control frames.
          const catalog = providers.map(({ id, name, models, compatibility, requires_client_auth }) => ({
            id, ...(name !== undefined ? { name } : {}), models, compatibility,
            ...(requires_client_auth !== undefined ? { requires_client_auth } : {}),
          }));
          if (!validBridgeProviders(catalog)) throw new ApertureSetupError("provider discovery returned an invalid catalog");
          return { providers: catalog, models: [...new Set(catalog.flatMap(p => p.models))] };
        }
        const models = selectOpenAISubscriptionProvider(providers).models;
        if (!Array.isArray(models) || !models.length || !models.every(v => typeof v === "string" && !!v.trim())
          || new Set(models).size !== models.length) throw 0;
        return { models };
      };
      ({ models, providers } = await discover());
      if (closing || failed) return;
      code = "LISTEN_FAILED";
      server = createServer(async (req, res) => {
        const deny = (status: number) => { res.writeHead(status, { "content-length": "0" }); res.end(); };
        const raw = new Headers();
        for (let i = 0; i < req.rawHeaders.length; i += 2) raw.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
        const route = resolveGatewayPath(req.url ?? "");
        if (req.method !== "POST" || !route) { deny(404); return; }
        const supplied = Buffer.from(raw.get(capabilityHeader) ?? "");
        const expected = Buffer.from(capability);
        if (raw.get("host") !== "worker.internal" || raw.has("origin") || supplied.length !== expected.length
          || !timingSafeEqual(supplied, expected)) { deny(403); return; }
        const nominated = (raw.get("connection") ?? "").split(",").map(v => v.trim().toLowerCase());
        if (nominated.some(v => v.startsWith("x-amz-") || ["authorization", "x-api-key", "x-goog-api-key", "cookie", "chatgpt-account-id", "user-agent", "session-id", "content-type", "accept", "openai-beta", "originator", "session_id", "x-aperture-relay-capability", capabilityHeader].includes(v))) { deny(400); return; }
        if (failed || closing) { deny(503); return; }
        const controller = new AbortController();
        active.add(controller);
        let disconnected = false;
        const abort = () => { disconnected = true; controller.abort(); };
        req.once("aborted", abort);
        res.once("close", abort);
        try {
          const forwarded = cleanHeaders(raw);
          if (route.managed) {
            for (const name of [...forwarded.keys()]) {
              if (name.startsWith("x-amz-") || ["authorization", "x-api-key", "x-goog-api-key", "chatgpt-account-id", "cookie"].includes(name)) forwarded.delete(name);
            }
          }
          const response = await fetch(new URL(route.pathname, gateway), {
            method: "POST", headers: forwarded,
            body: Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>,
            proxy: bridge!.httpProxyURL(), redirect: "error", signal: controller.signal,
          });
          const headers = cleanHeaders(response.headers);
          // Bun transparently decodes upstream content, including streamed bodies.
          headers.delete("content-encoding");
          res.writeHead(response.status, Object.fromEntries(headers));
          if (response.body) {
            const body = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
            body.on("error", () => {
              if (!controller.signal.aborted && !disconnected) failure("TRANSPORT_FAILED");
            });
            await pipeline(body, res, { signal: controller.signal });
          }
          else res.end();
        } catch {
          if (!disconnected && !failed && !closing) failure("TRANSPORT_FAILED");
          if (!res.headersSent && !res.destroyed) deny(503);
          else res.destroy();
        } finally {
          active.delete(controller);
          req.removeListener("aborted", abort);
          res.removeListener("close", abort);
        }
      });
      server.on("clientError", (_error, socket) => socket.destroy());
      server.on("checkContinue", (_req, res) => { res.writeHead(417); res.end(); });
      server.on("upgrade", (_req, socket) => socket.destroy());
      server.on("connect", (_req, socket) => socket.destroy());
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(s.socketPath, () => { server!.removeListener("error", reject); resolve(); });
      });
      server.on("error", () => failure("TRANSPORT_FAILED"));
    }
    if (closing || failed) return;
    clearTimeout(deadline);
    send({ type: "ready", protocol: 1, bun: Bun.version, models, capability, ...(s.catalog === true ? { providers } : {}) });
    ready = true;
  } catch (error) {
    if (code === "DISCOVERY_FAILED" && error instanceof ApertureSetupError) {
      const reasons: Record<string, FailureCode> = {
        "provider discovery failed: check gateway connectivity and redirects": "DISCOVERY_CONNECTIVITY",
        "provider discovery timed out after 10 seconds": "DISCOVERY_TIMEOUT",
        "provider discovery returned HTTP 401": "DISCOVERY_UNAUTHORIZED",
        "provider discovery returned HTTP 403": "DISCOVERY_FORBIDDEN",
        "provider discovery returned HTTP 404": "DISCOVERY_NOT_FOUND",
        "provider discovery returned invalid JSON": "DISCOVERY_INVALID_JSON",
        "provider discovery returned an invalid catalog": "DISCOVERY_INVALID_CATALOG",
        "no Aperture subscription Responses provider with models was found": "DISCOVERY_NO_PROVIDER",
        "multiple Aperture subscription Responses providers found: configure exactly one eligible provider": "DISCOVERY_MULTIPLE_PROVIDERS",
      };
      code = reasons[error.message] ?? (/^provider discovery returned HTTP [1-5][0-9]{2}$/.test(error.message) ? "DISCOVERY_HTTP_ERROR" : code);
    }
    if (error && typeof error === "object") {
      const upstreamCode = (error as Record<string, unknown>).code;
      if (typeof upstreamCode === "string" && upstreamFailureCodes.has(upstreamCode)) code = upstreamCode as FailureCode;
    }
    failure(code);
  }
}

process.stdin.on("end", () => void close());
process.stdin.on("error", () => void close());
process.stdout.on("error", () => void close());
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
process.on("uncaughtException", () => { failure("BRIDGE_FAILED"); void close(); });
process.on("unhandledRejection", () => { failure("BRIDGE_FAILED"); void close(); });
send({ type: "hello", protocol: 1, bun: Bun.version });
let pending = Buffer.alloc(0);
let total = 0;
process.stdin.on("data", (chunk: Buffer) => {
  if (closing) return;
  try {
    if (!ready) total += chunk.length;
    if (total > 128 * 1024) throw 0;
    pending = Buffer.concat([pending, chunk]);
    let newline: number;
    while ((newline = pending.indexOf(10)) !== -1) {
      if (newline > 64 * 1024) throw 0;
      const message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(pending.subarray(0, newline)));
      pending = pending.subarray(newline + 1);
      if (!message || typeof message !== "object" || Array.isArray(message) || message.protocol !== 1) throw 0;
      if (message.type === "close" && Object.keys(message).length === 2) { void close(); return; }
      if (message.type === "discover") {
        if (!ready || failed || Object.keys(message).sort().join(",") !== "id,protocol,type"
          || !Number.isSafeInteger(message.id) || message.id !== lastId + 1) throw 0;
        const id = lastId = message.id;
        if (discovering || !discover) { send({ type: "models-error", id, code: "DISCOVERY_FAILED" }); continue; }
        discovering = true;
        void (async () => {
          try {
            const catalog = await discover!();
            if (!closing && !failed) send({ type: "models", id, ...catalog });
          } catch {
            if (!closing && !failed) send({ type: "models-error", id, code: "DISCOVERY_FAILED" });
          } finally { discovering = false; }
        })();
        continue;
      }
      const { type, protocol: _protocol, ...options } = message;
      if (started || type !== "start" || !validBridgeStart(options)) throw 0;
      if (Bun.version !== "1.4.2") { failure("UNSUPPORTED_RUNTIME"); void close(); return; }
      started = true;
      clearTimeout(deadline);
      deadline = setTimeout(() => { failure("STARTUP_TIMEOUT"); void close(); }, options.timeoutMs);
      startupTask = start(options);
    }
    if (pending.length > 64 * 1024) throw 0;
  } catch { failure("PROTOCOL_ERROR"); void close(); }
});
