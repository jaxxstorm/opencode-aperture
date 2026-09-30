import { spawn } from "node:child_process";
import { dirname, isAbsolute } from "node:path";

// Extend only after the transport smoke has been verified on that exact runtime.
export const VERIFIED_TRANSPORT_BUN_VERSIONS: readonly string[] = Object.freeze(["1.4.2"]);

export type TransportEvent = {
  type: "event";
  name: string;
  port?: number;
};

export type TransportProcessInput = {
  runtime: { mode: "external"; executable: string } | { mode: "opencode"; executable: string };
  workerPath: string;
  startup: Record<string, unknown>;
  timeoutMs?: number;
  onEvent?: (event: TransportEvent) => void;
};

export type TransportProcess = {
  readonly origin: string;
  readonly capability: string;
  readonly bun: string;
  readonly pid: number;
  close(): Promise<void>;
  alive(): boolean;
};

const MAX_LINE = 64 * 1024;
const MAX_OUTPUT = 512 * 1024;
const EVENT_NAMES = new Set([
  "http-accepted", "connect-accepted", "tunnel-peer-port", "proxy-listening-port",
  "discovery-complete", "transport-smoke-complete",
]);

function failure(category: string): Error {
  return new Error(`Transport process: ${category}`);
}

function loopbackOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    const host = url.hostname;
    const ipv4 = /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host)
      && host.split(".").every(octet => Number(octet) <= 255);
    if (url.protocol !== "http:" || (!ipv4 && host !== "[::1]")
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || (url.port && Number(url.port) < 1)
      || (value !== url.origin && value !== `${url.origin}/`)) return;
    return url.origin;
  } catch {
    return;
  }
}

export async function startTransportProcess(input: TransportProcessInput): Promise<TransportProcess> {
  const { runtime, workerPath, startup, onEvent } = input;
  const timeoutMs = input.timeoutMs ?? 10_000;
  if (!runtime || !["external", "opencode"].includes(runtime.mode)
    || typeof runtime.executable !== "string" || !isAbsolute(runtime.executable)
    || runtime.executable.includes("\0") || typeof workerPath !== "string"
    || !isAbsolute(workerPath) || workerPath.includes("\0")
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000
    || !startup || typeof startup !== "object" || Array.isArray(startup)
    || Object.hasOwn(startup, "type") || Object.hasOwn(startup, "protocol")
    || Object.hasOwn(startup, "toJSON")) {
    throw failure("invalid input");
  }
  let startFrame: string;
  try {
    startFrame = JSON.stringify({ ...startup, type: "start", protocol: 1 });
  } catch {
    throw failure("invalid startup");
  }
  if (Buffer.byteLength(startFrame) > MAX_LINE) throw failure("startup limit");

  const env: NodeJS.ProcessEnv = {};
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  if (runtime.mode === "opencode") env.BUN_BE_BUN = "1";
  let child;
  try {
    child = spawn(runtime.executable, ["--no-env-file", "--config=/dev/null", workerPath], {
      env, cwd: dirname(workerPath), stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw failure("spawn failed");
  }
  const worker = child;
  let state: "hello" | "ready" | "running" | "dead" = "hello";
  let bun = "";
  let capability = "";
  let exited = false;
  let pending = Buffer.alloc(0);
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let shutdown: Promise<void> | undefined;
  let resolveReady!: (result: TransportProcess) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<TransportProcess>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timer = setTimeout(() => fail("startup timeout"), timeoutMs);

  function cleanup() {
    clearTimeout(timer);
    worker.stdout.removeListener("data", stdout);
    worker.stdout.removeListener("end", eof);
    worker.stdout.removeListener("error", ioError);
    worker.stderr.removeListener("data", stderr);
    worker.stderr.removeListener("error", ioError);
    worker.stdin.removeListener("error", ioError);
    worker.removeListener("error", spawnError);
    worker.removeListener("exit", exit);
    worker.stdin.destroy();
    worker.stdout.destroy();
    worker.stderr.destroy();
    pending = Buffer.alloc(0);
    startFrame = "";
  }

  function wait(ms: number): Promise<void> {
    if (exited) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(deadline);
        worker.removeListener("exit", done);
        resolve();
      };
      const deadline = setTimeout(done, ms);
      worker.once("exit", done);
    });
  }

  function stop(graceful: boolean): Promise<void> {
    if (shutdown) return shutdown;
    const wasStarting = state === "hello" || state === "ready";
    state = "dead";
    capability = "";
    startFrame = "";
    clearTimeout(timer);
    if (wasStarting) rejectReady(failure("closed before ready"));
    // Defer so shutdown is assigned before any stream callbacks can re-enter stop.
    shutdown = Promise.resolve().then(async () => {
      try {
        if (graceful && !exited && !worker.stdin.destroyed) {
          worker.stdin.end('{"type":"close","protocol":1}\n');
          await wait(150);
        }
        if (!exited) {
          worker.kill("SIGTERM");
          await wait(150);
        }
        if (!exited) {
          worker.kill("SIGKILL");
          await wait(300);
        }
      } catch {
        // Never include OS errors or worker output in diagnostics.
        try { worker.kill("SIGKILL"); } catch { /* Already gone. */ }
        await wait(300);
      } finally {
        cleanup();
        if (!exited) worker.unref();
      }
    });
    return shutdown;
  }

  function fail(category: string) {
    if (state === "dead") return;
    rejectReady(failure(category));
    void stop(false);
  }
  function spawnError() { fail("spawn failed"); }
  function ioError() { fail("pipe failed"); }
  function eof() { fail("unexpected EOF"); }
  function exit() {
    exited = true;
    fail("unexpected exit");
  }
  function stderr(chunk: Buffer) {
    stderrBytes += chunk.length;
    if (stderrBytes > MAX_OUTPUT) fail("stderr limit");
  }
  function frame(line: Buffer) {
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw failure("frame");
      message = parsed as Record<string, unknown>;
    } catch {
      fail("invalid frame");
      return;
    }
    const keys = Object.keys(message);
    if (state === "hello" && message.type === "hello"
      && keys.length === 3 && message.protocol === 1 && typeof message.bun === "string") {
      if (!VERIFIED_TRANSPORT_BUN_VERSIONS.includes(message.bun)) {
        fail("unsupported runtime");
        return;
      }
      bun = message.bun;
      state = "ready";
      worker.stdin.write(`${startFrame}\n`);
      startFrame = "";
      return;
    }
    if (state === "ready" && message.type === "ready" && keys.length === 5
      && message.protocol === 1 && message.bun === bun
      && typeof message.capability === "string" && /^worker-fixture-[a-f0-9]{64}$/.test(message.capability)) {
      const origin = loopbackOrigin(message.origin);
      if (!origin || !worker.pid) { fail("invalid ready"); return; }
      capability = message.capability;
      state = "running";
      clearTimeout(timer);
      resolveReady({
        origin, bun, pid: worker.pid,
        get capability() {
          if (state !== "running") throw failure("not alive");
          return capability;
        },
        alive: () => state === "running",
        close: () => stop(true),
      });
      return;
    }
    if ((state === "ready" || state === "running") && message.type === "event"
      && typeof message.name === "string" && EVENT_NAMES.has(message.name)
      && keys.every(key => ["type", "name", "port"].includes(key))
      && (!Object.hasOwn(message, "port") || (typeof message.port === "number"
        && Number.isInteger(message.port) && message.port >= 1 && message.port <= 65535))) {
      const event: TransportEvent = { type: "event", name: message.name };
      if (typeof message.port === "number") event.port = message.port;
      try { onEvent?.(event); } catch { fail("event callback failed"); }
      return;
    }
    fail("unexpected frame");
  }
  function stdout(chunk: Buffer) {
    if (state === "dead") return;
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_OUTPUT) { fail("stdout limit"); return; }
    pending = Buffer.concat([pending, chunk]);
    let newline: number;
    while ((newline = pending.indexOf(10)) !== -1) {
      if (newline > MAX_LINE) { fail("frame limit"); return; }
      const line = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      frame(line);
      if ((state as string) === "dead") return;
    }
    if (pending.length > MAX_LINE) fail("frame limit");
  }
  worker.on("error", spawnError);
  worker.on("exit", exit);
  worker.stdin.on("error", ioError);
  worker.stdout.on("error", ioError);
  worker.stdout.on("data", stdout);
  worker.stdout.on("end", eof);
  worker.stderr.on("error", ioError);
  worker.stderr.on("data", stderr);
  try {
    return await ready;
  } catch (error) {
    await stop(false);
    throw error;
  }
}
