import { afterAll, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTransportProcess, VERIFIED_TRANSPORT_BUN_VERSIONS } from "../src/transport-process";

const directory = await mkdtemp(join(tmpdir(), "transport-process-"));
const executable = process.execPath;
const embedded = process.env.BUN_BE_BUN === "1";
const capability = `worker-fixture-${"a".repeat(64)}`;
let sequence = 0;
afterAll(() => rm(directory, { recursive: true, force: true }));

const prelude = `
import { closeSync, writeFileSync, writeSync } from "node:fs";
// Protocol fixture only: this claim does not verify the executing runtime.
const claimedBun = "1.4.2";
const send = value => writeSync(1, JSON.stringify(value) + "\\n");
const hello = () => send({ type: "hello", protocol: 1, bun: claimedBun });
const ready = (extra = {}) => send({ type: "ready", protocol: 1,
  origin: "http://127.0.0.1:12345", capability: ${JSON.stringify(capability)}, bun: claimedBun, ...extra });
const hold = setInterval(() => {}, 1000);
`;
const normal = `
hello();
let buffer = "";
process.stdin.on("data", chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) !== -1) {
    const message = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (message.type === "close" && message.protocol === 1) process.exit(0);
    if (message.type !== "start" || message.protocol !== 1) process.exit(2);
    START
  }
});
`;
async function fixture(body: string) {
  const workerPath = join(directory, `worker-${sequence++}.ts`);
  await Bun.write(workerPath, prelude + body);
  return workerPath;
}
async function start(body = normal.replace("START", "ready();"), options: Partial<Parameters<typeof startTransportProcess>[0]> = {}) {
  return startTransportProcess({
    runtime: { mode: embedded ? "opencode" : "external", executable }, workerPath: await fixture(body),
    startup: { secret: "private-startup-value" }, timeoutMs: 2_000, ...options,
  });
}
async function eventuallyDead(worker: Awaited<ReturnType<typeof start>>) {
  try {
    for (let i = 0; i < 100 && worker.alive(); i++) await Bun.sleep(10);
    expect(worker.alive()).toBe(false);
    expect(() => worker.capability).toThrow("not alive");
  } finally {
    await worker.close();
  }
}

test("verified runtime claim, private handshake, sanitized events, graceful idempotent close", async () => {
  expect(VERIFIED_TRANSPORT_BUN_VERSIONS).toEqual(["1.4.2"]);
  const events: unknown[] = [];
  const closedPath = join(directory, "close-observed.json");
  const worker = await start(normal.replace('process.exit(0);', `{
    writeFileSync(${JSON.stringify(closedPath)}, JSON.stringify(message));
    process.exit(0);
  }`).replace("START", `
    if (message.secret !== "private-startup-value" || process.argv.length !== 2) process.exit(3);
    send({ type: "event", name: "transport-smoke-complete" });
    send({ type: "event", name: "tunnel-peer-port", port: 54321 });
    ready();
  `), { onEvent: event => events.push(event) });
  try {
    expect(worker.origin).toBe("http://127.0.0.1:12345");
    expect(worker.bun).toBe("1.4.2");
    expect(worker.pid).toBeGreaterThan(0);
    expect(worker.capability).toBe(capability);
    expect(worker.alive()).toBe(true);
    expect(events).toEqual([
      { type: "event", name: "transport-smoke-complete" },
      { type: "event", name: "tunnel-peer-port", port: 54321 },
    ]);
  } finally {
    const closing = worker.close();
    expect(worker.alive()).toBe(false);
    expect(worker.close()).toBe(closing);
    await closing;
  }
  expect(() => worker.capability).toThrow("not alive");
  expect(JSON.parse(await readFile(closedPath, "utf8"))).toEqual({ type: "close", protocol: 1 });
  expect(() => process.kill(worker.pid, 0)).toThrow();
});

for (const version of ["1.3.14", "1.5.0"]) test(`rejects unverified ${version} without startup bytes`, async () => {
  const observedPath = join(directory, `startup-bytes-${version}.json`);
  await expect(start(`
    let bytes = 0;
    writeFileSync(${JSON.stringify(observedPath)}, "0");
    process.stdin.on("data", chunk => {
      bytes += chunk.length;
      writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify(bytes));
    });
    process.on("SIGTERM", () => setTimeout(() => process.exit(0), 50));
    send({ type: "hello", protocol: 1, bun: ${JSON.stringify(version)} });
  `)).rejects.toThrow("unsupported runtime");
  expect(JSON.parse(await readFile(observedPath, "utf8"))).toBe(0);
});

test("rejects a non-Bun executable", async () => {
  await expect(start(undefined, { runtime: { mode: "external", executable: "/bin/sh" } }))
    .rejects.toThrow("Transport process: unexpected");
});

test("worker cwd is isolated and dotenv and project preloads are disabled", async () => {
  const envPath = join(directory, ".env");
  const configPath = join(directory, "bunfig.toml");
  const preloadPath = join(directory, "preload.ts");
  const observedPath = join(directory, "preload-observed");
  try {
    await Bun.write(envPath, "TRANSPORT_DOTENV_SECRET=synthetic-dotenv\n");
    await Bun.write(preloadPath, `import { writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(observedPath)}, "loaded"); process.exit(6);`);
    await Bun.write(configPath, 'preload = ["./preload.ts"]\n');
    const worker = await start(normal.replace("START", `
      if (process.env.TRANSPORT_DOTENV_SECRET !== undefined
        || process.cwd() !== ${JSON.stringify(await realpath(directory))} || process.argv.length !== 2) process.exit(7);
      ready();
    `));
    await worker.close();
    expect(await Bun.file(observedPath).exists()).toBe(false);
  } finally {
    await Promise.all([envPath, configPath, preloadPath, observedPath].map(path => rm(path, { force: true })));
  }
});

for (const [name, body, category] of [
  ["malformed JSON", 'process.stdout.write("private-credential-not-json\\n");', "invalid frame"],
  ["oversized line", 'process.stdout.write("x".repeat(65537));', "frame limit"],
  ["oversized newline frame", 'process.stdout.write("x".repeat(65537) + "\\n");', "frame limit"],
  ["unknown frame", 'send({ type: "unknown", credential: "private" });', "unexpected frame"],
  ["wrong protocol", 'send({ type: "hello", protocol: 2, bun: Bun.version });', "unexpected frame"],
  ["early ready", "ready();", "unexpected frame"],
  ["early EOF", "closeSync(1);", "unexpected EOF"],
  ["early exit", "process.exit(0);", "unexpected"],
  ["stderr cap", 'process.stderr.write("s".repeat(524289));', "stderr limit"],
] as const) {
  // Embedded 1.3.14 does not deliver pipe EOF when this fixture closes fd 1.
  test.skipIf(embedded && Bun.version === "1.3.14" && name === "early EOF")(`rejects ${name}`, async () => {
    await expect(start(body)).rejects.toThrow(category);
  });
}

test("startup timeout and invalid paths, timeout bounds, reserved fields and startup cap", async () => {
  await expect(start("", { timeoutMs: 50 })).rejects.toThrow("startup timeout");
  for (const options of [
    { workerPath: "relative.ts" }, { runtime: { mode: "external" as const, executable: "bun" } },
    { timeoutMs: 0 }, { timeoutMs: 60_001 }, { startup: { protocol: 2 } },
    { startup: { toJSON: () => ({ type: "close" }) } },
  ]) await expect(start(undefined, options)).rejects.toThrow("invalid input");
  await expect(start(undefined, { startup: { pem: "x".repeat(65536) } })).rejects.toThrow("startup limit");
  await expect(start(undefined, { runtime: { mode: "external", executable: "/nonexistent/private-secret" } }))
    .rejects.toThrow("Transport process: spawn failed");
  const worker = await start(undefined, { startup: { pem: "x".repeat(64_000) } });
  await worker.close();
});

test("unit environment construction strips parent secrets; opencode mode adds only BUN_BE_BUN (not real OpenCode)", async () => {
  const names = ["TS_AUTHKEY", "OPENAI_API_KEY", "HTTPS_PROXY", "TRANSPORT_TEST_SECRET", "BUN_BE_BUN"];
  const previous = names.map(name => process.env[name]);
  const spawn = childProcess.spawn;
  const environments: NodeJS.ProcessEnv[] = [];
  const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(((
    command: string, args: readonly string[] = [], options: childProcess.SpawnOptions = {},
  ) => {
    environments.push({ ...options.env });
    // Embedded OpenCode needs this launcher switch even when testing external-mode construction.
    return spawn(command, args, embedded
      ? { ...options, env: { ...options.env, BUN_BE_BUN: "1" } } : options);
  }) as unknown as typeof childProcess.spawn);
  try {
    for (const name of names) process.env[name] = "parent-secret";
    for (const mode of ["external", "opencode"] as const) {
      const worker = await start(normal.replace("START", `
        const allowed = ${JSON.stringify(mode === "opencode" || embedded ? ["PATH", "BUN_BE_BUN"] : ["PATH"])};
        if (Object.keys(process.env).some(key => !allowed.includes(key))) process.exit(4);
        if (${JSON.stringify(mode)} === "opencode" && process.env.BUN_BE_BUN !== "1") process.exit(5);
        ready();
      `), { runtime: { mode, executable } });
      await worker.close();
      expect(environments.at(-1)).toEqual({
        ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
        ...(mode === "opencode" ? { BUN_BE_BUN: "1" } : {}),
      });
    }
  } finally {
    spawnSpy.mockRestore();
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

for (const [name, action] of [
  ["spontaneous exit", "process.exit(0)"],
  ["stdout EOF", "closeSync(1)"],
  ["repeated ready", "ready()"],
  ["repeated hello", "hello()"],
  ["invalid event", 'send({ type: "event", name: "http-accepted", port: 0 })'],
  ["unknown event", 'send({ type: "event", name: "private-secret" })'],
  ["extra event data", 'send({ type: "event", name: "http-accepted", secret: "private" })'],
  ["total stdout cap", 'for (let i = 0; i < 14000; i++) send({ type: "event", name: "http-accepted" })'],
] as const) {
  // Keep the EOF assertion on standalone Bun rather than substituting process exit.
  test.skipIf(embedded && Bun.version === "1.3.14" && name === "stdout EOF")(`${name} invalidates a ready capability`, async () => {
    const worker = await start(normal.replace("START", `ready(); setTimeout(() => { ${action}; }, 30);`));
    await eventuallyDead(worker);
  });
}

for (const extra of [
  { bun: "1.3.14" }, { capability: "wrong" }, { origin: "http://localhost:12345" },
  { origin: "http://192.168.1.1:12345" }, { origin: "https://127.0.0.1:12345" },
  { origin: "http://user:pass@127.0.0.1:12345" }, { origin: "http://127.0.0.1:12345/path" },
  { origin: "http://127.0.0.1:12345/?secret=1" }, { origin: "http://127.1:12345" },
]) {
  test(`rejects invalid ready ${JSON.stringify(extra)}`, async () => {
    await expect(start(normal.replace("START", `ready(${JSON.stringify(extra)});`))).rejects.toThrow("Transport process:");
  });
}

test("close escalates when worker ignores close, EOF, and TERM", async () => {
  const worker = await start('process.on("SIGTERM", () => {}); hello(); process.stdin.on("data", () => ready());');
  const before = Date.now();
  await worker.close();
  expect(Date.now() - before).toBeLessThan(1500);
  expect(() => process.kill(worker.pid, 0)).toThrow();
});

test("worker diagnostics and protocol credentials never reach console or errors", async () => {
  const spies = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  spies.forEach(spy => spy.mockImplementation(() => {}));
  try {
    await expect(start('process.stderr.write("private-stderr-secret"); send({ type: "oops", capability: "private-protocol-secret" });'))
      .rejects.toThrow("Transport process: unexpected frame");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    spies.forEach(spy => spy.mockRestore());
  }
});

test("handles split frames and accepts canonical IPv6 loopback", async () => {
  const worker = await start(`
    process.stdout.write('{"type":"hel');
    setTimeout(() => process.stdout.write('lo","protocol":1,"bun":"1.4.2"}\\n'), 10);
    process.stdin.once("data", () => ready({ origin: "http://[::1]:12345/" }));
    process.stdin.on("end", () => process.exit(0));
  `);
  try {
    expect(worker.origin).toBe("http://[::1]:12345");
  } finally {
    await worker.close();
  }
});

test("event callback errors are sanitized and terminate startup", async () => {
  await expect(start(normal.replace("START", 'send({ type: "event", name: "discovery-complete" });'), {
    onEvent() { throw new Error("private-callback-secret"); },
  })).rejects.toThrow("Transport process: event callback failed");
});
