import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, isAbsolute } from "node:path";
import type { ProviderInfo } from "./aperture-codex-plugin";

export type BridgeStart = {
  action: "connect" | "enroll";
  gateway: string;
  hostname: string;
  stateDir: string;
  modulePath?: string;
  authKey?: string;
  browser?: boolean;
  catalog?: boolean;
  timeoutMs: number;
  socketPath: string;
};
export type BridgeRuntime = { mode: "external" | "opencode"; executable: string };
export type BridgeSession = {
  models: string[];
  providers?: ProviderInfo[];
  capability: string;
  socketPath: string;
  bun: string;
  alive(): boolean;
  signal: AbortSignal;
  refreshModels(): Promise<string[]>;
  close(): Promise<void>;
};
export type BridgeWorkerInput = {
  runtime: BridgeRuntime;
  workerPath: string;
  start: BridgeStart;
  signal?: AbortSignal;
  onAuthRequired?: (url: string) => void;
};

export const BRIDGE_FAILURE_CODES = [
  "INVALID_START", "UNSUPPORTED_RUNTIME", "MODULE_UNAVAILABLE", "BRIDGE_FAILED",
  "DISCOVERY_FAILED", "LISTEN_FAILED", "TRANSPORT_FAILED", "PROTOCOL_ERROR", "STARTUP_TIMEOUT",
  "DISCOVERY_CONNECTIVITY", "DISCOVERY_TIMEOUT", "DISCOVERY_HTTP_ERROR", "DISCOVERY_UNAUTHORIZED", "DISCOVERY_FORBIDDEN", "DISCOVERY_NOT_FOUND",
  "DISCOVERY_INVALID_JSON", "DISCOVERY_INVALID_CATALOG", "DISCOVERY_NO_PROVIDER", "DISCOVERY_MULTIPLE_PROVIDERS",
  "AUTH_REQUIRED", "AUTH_FAILED", "STATE_UNSAFE", "STATE_LOCKED", "HELPER_UNAVAILABLE",
  "UNSUPPORTED_PLATFORM", "HELPER_FAILED", "CALLBACK_FAILED", "INVALID_OPTIONS", "CANCELLED", "CLOSED",
] as const;
const MAX_LINE = 64 * 1024;
const MAX_OUTPUT = 512 * 1024;
const safeError = (code: string) => new Error(`Aperture bridge: ${code}`);
const absolute = (value: unknown): value is string =>
  typeof value === "string" && isAbsolute(value) && !value.includes("\0");

export function validBridgeProviders(value: unknown): value is ProviderInfo[] {
  return Array.isArray(value) && value.every(p => p && typeof p === "object" && !Array.isArray(p)
    && Object.keys(p).every(key => ["id", "name", "models", "compatibility", "requires_client_auth"].includes(key))
    && typeof p.id === "string" && !!p.id.trim()
    && (p.name === undefined || typeof p.name === "string")
    && Array.isArray(p.models) && p.models.every((m: unknown) => typeof m === "string" && !!m.trim())
    && p.compatibility && typeof p.compatibility === "object" && !Array.isArray(p.compatibility)
    && Object.values(p.compatibility).every(v => typeof v === "boolean")
    && (p.requires_client_auth === undefined || typeof p.requires_client_auth === "boolean"))
    && new Set(value.map(p => p.id)).size === value.length;
}

function validCatalog(models: unknown, providers: unknown): boolean {
  if (!validBridgeProviders(providers)) return false;
  return JSON.stringify(models) === JSON.stringify([...new Set(providers.flatMap(p => p.models))]);
}

export function validBridgeStart(value: unknown): value is BridgeStart {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as BridgeStart;
  if (Object.keys(s).some(key => !["action", "gateway", "hostname", "stateDir", "modulePath", "authKey", "browser", "catalog", "timeoutMs", "socketPath"].includes(key))
    || !["connect", "enroll"].includes(s.action)
    || typeof s.gateway !== "string" || typeof s.hostname !== "string"
    || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(s.hostname)
    || !absolute(s.stateDir) || !absolute(s.socketPath)
    || (s.modulePath !== undefined && (!absolute(s.modulePath) || !/\.(?:mjs|cjs|js)$/.test(s.modulePath)))
    || (s.authKey !== undefined && (typeof s.authKey !== "string" || !s.authKey || s.authKey.trim() !== s.authKey || /[\r\n\0]/.test(s.authKey)))
    || (s.browser !== undefined && typeof s.browser !== "boolean")
    || (s.catalog !== undefined && typeof s.catalog !== "boolean")
    || !Number.isInteger(s.timeoutMs) || s.timeoutMs < 1 || s.timeoutMs > 300_000) return false;
  try {
    const url = new URL(s.gateway);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password
      && url.pathname === "/" && !/[?#@\s\\]/.test(s.gateway);
  } catch { return false; }
}

export async function startBridgeWorker(input: BridgeWorkerInput): Promise<BridgeSession> {
  const { runtime, workerPath, start, signal, onAuthRequired } = input;
  if (!runtime || !["external", "opencode"].includes(runtime.mode) || !absolute(runtime.executable)
    || !absolute(workerPath) || !validBridgeStart(start)) throw safeError("INVALID_START");
  if (signal?.aborted) throw safeError("CANCELLED");
  let startFrame = JSON.stringify({ type: "start", protocol: 1, ...start });
  if (Buffer.byteLength(startFrame) > MAX_LINE) throw safeError("INVALID_START");
  const socketPath = start.socketPath;
  const browser = start.browser === true;
  const action = start.action;
  const catalog = start.catalog === true;
  const env: NodeJS.ProcessEnv = {};
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  if (runtime.mode === "opencode") env.BUN_BE_BUN = "1";
  let worker: ChildProcessWithoutNullStreams;
  try {
    worker = spawn(runtime.executable, ["--no-env-file", "--config=/dev/null", workerPath], {
      cwd: dirname(workerPath), env, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch { throw safeError("SPAWN_FAILED"); }
  let state: "hello" | "starting" | "running" | "failed" | "closed" = "hello";
  let exited = false;
  let verifiedHello = false;
  let pending = Buffer.alloc(0);
  let output = 0;
  let errors = 0;
  let closing: Promise<void> | undefined;
  let session: BridgeSession;
  let issued = 0;
  let refresh: { id: number; promise: Promise<string[]>; resolve(value: string[]): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | undefined;
  const controller = new AbortController();
  let resolve!: (session: BridgeSession) => void;
  let reject!: (error: Error) => void;
  const ready = new Promise<BridgeSession>((yes, no) => { resolve = yes; reject = no; });
  const timer = setTimeout(() => fail("STARTUP_TIMEOUT"), start.timeoutMs);

  function finishRefresh(error?: Error, models?: string[], providers?: ProviderInfo[]) {
    const current = refresh;
    if (!current) return;
    refresh = undefined;
    clearTimeout(current.timer);
    if (error) current.reject(error);
    else {
      session.models.splice(0, session.models.length, ...models!);
      if (catalog) session.providers = providers!;
      current.resolve([...session.models]);
    }
  }
  function refreshModels(): Promise<string[]> {
    if (state !== "running" || exited) return Promise.reject(safeError("CLOSED"));
    if (refresh) return refresh.promise;
    if (issued === Number.MAX_SAFE_INTEGER) return Promise.reject(safeError("DISCOVERY_FAILED"));
    const id = ++issued;
    let yes!: (models: string[]) => void;
    let no!: (error: Error) => void;
    const promise = new Promise<string[]>((resolve, reject) => { yes = resolve; no = reject; });
    refresh = { id, promise, resolve: yes, reject: no,
      timer: setTimeout(() => finishRefresh(safeError("DISCOVERY_FAILED")), 12000) };
    worker.stdin.write(JSON.stringify({ type: "discover", protocol: 1, id }) + "\n");
    return promise;
  }

  function wait(ms: number): Promise<void> {
    if (exited) return Promise.resolve();
    return new Promise(done => {
      const finish = () => { clearTimeout(deadline); worker.removeListener("exit", finish); done(); };
      const deadline = setTimeout(finish, ms);
      worker.once("exit", finish);
    });
  }
  function close(): Promise<void> {
    if (closing) return closing;
    state = "closed";
    clearTimeout(timer);
    startFrame = "";
    controller.abort(safeError("CLOSED"));
    reject(safeError("CLOSED"));
    finishRefresh(safeError("CLOSED"));
    signal?.removeEventListener("abort", cancel);
    closing = Promise.resolve().then(async () => {
      try {
        if (!exited) {
          if (!worker.stdin.destroyed && verifiedHello) worker.stdin.end('{"type":"close","protocol":1}\n');
          worker.kill("SIGTERM");
          // The bridge helper itself has a five-second graceful shutdown window.
          await wait(7000);
        }
        if (!exited) { worker.kill("SIGKILL"); await wait(1000); }
      } catch {
        try { worker.kill("SIGKILL"); } catch { /* Already gone. */ }
        await wait(1000);
      } finally {
        worker.stdin.destroy(); worker.stdout.destroy(); worker.stderr.destroy();
        pending = Buffer.alloc(0);
        if (!exited) worker.unref();
      }
    });
    return closing;
  }
  function fail(code: string, retain = false) {
    if (state === "closed" || state === "failed") return;
    state = "failed";
    clearTimeout(timer);
    startFrame = "";
    const error = safeError(code);
    controller.abort(error);
    reject(error);
    finishRefresh(error);
    // A failed live worker retains its Unix listener until the owner closes it.
    if (!retain) void close();
  }
  function cancel() { fail("CANCELLED"); void close(); }
  function frame(line: Buffer) {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
      if (!m || typeof m !== "object" || Array.isArray(m)) throw 0;
    } catch { fail("PROTOCOL_ERROR"); return; }
    const keys = Object.keys(m).sort().join(",");
    if (state === "running" && (m.type === "models" || m.type === "models-error")) {
      if (!Number.isSafeInteger(m.id) || (m.id as number) < 1 || (m.id as number) > issued
        || (m.type === "models" ? keys !== (catalog ? "id,models,providers,type" : "id,models,type") || !Array.isArray(m.models)
          || (!catalog && !m.models.length) || !m.models.every(v => typeof v === "string" && !!v.trim())
          || new Set(m.models).size !== m.models.length
          || (catalog && !validCatalog(m.models, m.providers))
          : keys !== "code,id,type" || m.code !== "DISCOVERY_FAILED")) {
        fail("PROTOCOL_ERROR"); return;
      }
      // Sequential IDs bound bookkeeping and keep late replies from satisfying a new request.
      if (m.id !== refresh?.id) return;
      finishRefresh(m.type === "models-error" ? safeError("DISCOVERY_FAILED") : undefined, m.models as string[], m.providers as ProviderInfo[]);
      return;
    }
    if (state === "hello" && m.type === "hello" && keys === "bun,protocol,type" && m.protocol === 1) {
      if (m.bun !== "1.4.2") { fail("UNSUPPORTED_RUNTIME"); return; }
      verifiedHello = true;
      state = "starting";
      worker.stdin.write(startFrame + "\n");
      startFrame = "";
      return;
    }
    if (state === "starting" && m.type === "auth-required" && keys === "type,url" && browser && typeof m.url === "string") {
      try {
        const url = new URL(m.url);
        if (url.protocol !== "https:" || url.username || url.password || /[\s\0]/.test(m.url)) throw 0;
        onAuthRequired?.(m.url);
      } catch { fail("AUTH_CALLBACK_FAILED"); }
      return;
    }
    if ((state === "starting" || state === "running") && m.type === "failure" && keys === "code,type"
      && BRIDGE_FAILURE_CODES.includes(m.code as typeof BRIDGE_FAILURE_CODES[number])) {
      fail(m.code as string, state === "running"); return;
    }
    if (state === "starting" && m.type === "ready" && keys === (catalog ? "bun,capability,models,protocol,providers,type" : "bun,capability,models,protocol,type")
      && m.protocol === 1 && m.bun === "1.4.2" && typeof m.capability === "string"
      && /^aperture-worker-[a-f0-9]{64}$/.test(m.capability)
      && Array.isArray(m.models) && m.models.every(v => typeof v === "string" && !!v.trim())
      && new Set(m.models).size === m.models.length
      && (catalog ? validCatalog(m.models, m.providers) && (action !== "enroll" || m.models.length === 0)
        : action === "enroll" ? m.models.length === 0 : m.models.length > 0)) {
      state = "running";
      clearTimeout(timer);
      session = { models: [...m.models], capability: m.capability, socketPath, bun: m.bun,
        ...(catalog ? { providers: m.providers as ProviderInfo[] } : {}),
        alive: () => state === "running" && !exited, signal: controller.signal, close, refreshModels };
      resolve(session);
      return;
    }
    fail("PROTOCOL_ERROR");
  }
  worker.on("error", () => { exited = true; fail("SPAWN_FAILED"); });
  worker.on("exit", () => { exited = true; fail("WORKER_EXITED"); });
  worker.stdin.on("error", () => fail("PIPE_FAILED"));
  worker.stdout.on("error", () => fail("PIPE_FAILED"));
  worker.stderr.on("error", () => fail("PIPE_FAILED"));
  worker.stdout.on("end", () => fail("WORKER_EOF"));
  worker.stderr.on("data", (chunk: Buffer) => {
    errors += chunk.length;
    if (errors > MAX_OUTPUT) { fail("OUTPUT_LIMIT"); void close(); }
  });
  worker.stdout.on("data", (chunk: Buffer) => {
    if (state === "closed") return;
    if (state !== "running") output += chunk.length;
    if (output > MAX_OUTPUT) { fail("OUTPUT_LIMIT"); void close(); return; }
    if (state === "failed") return;
    pending = Buffer.concat([pending, chunk]);
    let newline: number;
    while ((newline = pending.indexOf(10)) !== -1) {
      if (newline > MAX_LINE) { fail("PROTOCOL_ERROR"); return; }
      const line = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      frame(line);
      if ((state as string) === "closed" || (state as string) === "failed") return;
    }
    if (pending.length > MAX_LINE) fail("PROTOCOL_ERROR");
  });
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try { return await ready; }
  catch (error) { await close(); throw error; }
}
