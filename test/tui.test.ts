import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, lstat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import * as client from "../src/bridge-client";
import * as persistence from "../src/bridge-settings";
import * as browser from "../src/browser";
import plugin from "../src/tui";
import { claimBridgeStateLease, defaultBridgeSettings, loadBridgeSettings, prepareBridgeStateDirectory, saveBridgeSettings, settingsPath } from "../src/bridge-settings";

let root: string;
let config: string | undefined;
let state: string | undefined;
let enable: string | undefined;
let openBrowser: ReturnType<typeof spyOn<typeof browser, "openEnrollmentBrowser">>;
beforeEach(async () => {
  openBrowser = spyOn(browser, "openEnrollmentBrowser").mockResolvedValue(false);
  config = process.env.XDG_CONFIG_HOME; state = process.env.XDG_STATE_HOME; enable = process.env.OPENCODE_APERTURE_ENABLE;
  root = await mkdtemp(join(await realpath(tmpdir()), "aperture-tui-test-"));
  process.env.XDG_CONFIG_HOME = join(root, "config");
  process.env.XDG_STATE_HOME = join(root, "state");
  process.env.OPENCODE_APERTURE_ENABLE = "1";
});
afterEach(async () => {
  openBrowser.mockRestore();
  if (config === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = config;
  if (state === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = state;
  if (enable === undefined) delete process.env.OPENCODE_APERTURE_ENABLE; else process.env.OPENCODE_APERTURE_ENABLE = enable;
  delete process.env.APERTURE_TUI_TEST_KEY;
  await rm(root, { recursive: true, force: true });
});

type Command = { namespace?: string; name: string; title: string; slashName: string; run(): Promise<void> };
async function harness(answers: (string | boolean | undefined)[], beforeDispose?: () => void | Promise<void>) {
  let commands: Command[] = [];
  let onClose: (() => void) | undefined;
  let dispose: (() => void | Promise<void>) | undefined;
  const lifecycle = new AbortController();
  const dialogs: { kind: string; title: string; message?: string; value?: string }[] = [];
  const toasts: { message: string }[] = [];
  let current: any;
  let foreignClosed = false;
  let event: ((event: unknown) => void) | undefined;
  const calls: string[] = [];
  const provider = { id: "openai", name: "Aperture (Tailscale)", models: { test: { id: "test", name: "Test model" } } };
  const publicState = { path: { directory: "/local" }, provider: [] as unknown[] };
  const sdk = {
    session: { status: async () => ({ data: {} }) },
    instance: { dispose: async () => { calls.push("dispose"); await beforeDispose?.(); event?.({ properties: { directory: "/local" } }); return { data: true }; } },
    config: { providers: async () => { calls.push("providers"); publicState.provider = [provider]; return { data: { providers: [provider] } }; } },
  };
  const clear = () => { const close = onClose; onClose = undefined; close?.(); };
  const factory = (kind: string) => (props: any) => {
    current = props;
    dialogs.push({ kind, title: props.title, message: props.message ?? props.options?.find((option: any) => option.value === "wait")?.footer, value: props.value });
    if (kind === "alert") return null;
    if ((kind === "select" && ["Aperture enrollment", "Aperture models"].includes(props.title))
      || (kind === "prompt" && props.title.startsWith("Copy Aperture enrollment URL"))) return null;
    queueMicrotask(() => {
      const answer = answers.shift();
      if (answer === undefined) { clear(); return; }
      if (kind === "select") props.onSelect({ value: answer });
      else if (kind === "confirm") answer ? props.onConfirm() : props.onCancel();
      else props.onConfirm(answer);
    });
    return null;
  };
  // The pinned host queries palette namespace entries for both palette and slashes.
  const api = { client: sdk, state: publicState,
    event: { on: (_: string, handler: (event: unknown) => void) => { event = handler; return () => { event = undefined; }; } },
    keymap: { dispatchCommand(name: string) { expect(onClose).toBeUndefined(); calls.push(name); }, registerLayer(layer: { commands: Command[] }) { commands = layer.commands.filter(command => command.namespace === "palette"); return () => {}; } },
    lifecycle: { signal: lifecycle.signal, onDispose(fn: () => void | Promise<void>) { dispose = fn; return () => {}; } },
    ui: { toast: (value: { message: string }) => toasts.push(value), dialog: { clear, replace(render: () => unknown, close?: () => void) { clear(); onClose = close; render(); } },
      DialogPrompt: factory("prompt"), DialogConfirm: factory("confirm"), DialogSelect: factory("select"), DialogAlert: factory("alert") },
  } as unknown as TuiPluginApi;
  await plugin.tui(api);
  return { commands, dialogs, toasts, clear, lifecycle, sdk, calls, dispose: () => dispose?.(),
    choosePending: (value: string) => current.onSelect ? current.onSelect({ value }) : value === "cancel" ? current.onCancel() : current.onConfirm(current.value ?? value),
    replaceWithForeign: () => { clear(); onClose = () => { foreignClosed = true; }; },
    foreignClosed: () => foreignClosed,
    run: (name: string) => commands.find(command => command.name === `aperture.${name}`)!.run() };
}
const browserAnswers = [true, "enable", "https://gateway.test", true, "external", process.execPath, "", "test-device", "browser"];

test("manual refresh opens the native picker after cleanup without changing settings", async () => {
  const settings = defaultBridgeSettings(); settings.bridge.enabled = true;
  await saveBridgeSettings(settings);
  const before = await readFile(settingsPath(), "utf8");
  const save = spyOn(persistence, "saveBridgeSettings");
  try {
    const h = await harness([true, true]);
    await h.run("models");
    expect(h.calls).toEqual(["dispose", "providers", "model.list"]);
    await h.run("models");
    expect(h.calls).toEqual(["dispose", "providers", "model.list", "dispose", "providers", "model.list"]);
    expect(save).not.toHaveBeenCalled();
    expect(await readFile(settingsPath(), "utf8")).toBe(before);
    await h.dispose();
  } finally { save.mockRestore(); }
});

test("manual refresh requires saved enabled settings", async () => {
  for (const saved of [false, true]) {
    if (saved) await saveBridgeSettings(defaultBridgeSettings());
    const h = await harness([]);
    await h.run("models");
    expect(h.calls).toEqual([]);
    expect(h.dialogs.at(-1)?.message).toContain("/aperture-setup");
    await h.dispose();
  }
});

test.each(["busy", "failure"])("automatic refresh %s retains enrollment and saved settings", async outcome => {
  const start = spyOn(client, "startBridgeWorker").mockResolvedValue({ close: async () => {} } as client.BridgeSession);
  const save = spyOn(persistence, "saveBridgeSettings");
  try {
    const h = await harness([...browserAnswers]);
    if (outcome === "busy") h.sdk.session.status = async () => ({ data: { session: { type: "busy" } } });
    else h.sdk.config.providers = async () => { throw new Error("private-sdk-failure"); };
    await h.run("setup");
    expect((await loadBridgeSettings())?.bridge.enabled).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(h.dialogs.at(-1)?.kind).toBe("alert");
    expect(h.toasts).toHaveLength(0);
    const message = h.dialogs.at(-1)?.message;
    expect(message).toContain("enrolled; settings saved");
    expect(message).toContain("/aperture-models");
    expect(message).not.toContain("unchanged");
    expect(message).not.toContain("/aperture-login");
    expect(JSON.stringify(h.dialogs)).not.toContain("private-sdk-failure");
    if (outcome === "failure") expect(message).toContain("[unavailable:catalog]");
    expect(h.calls).not.toContain("model.list");
    if (outcome === "busy") expect(h.calls).toEqual([]);
    await h.dispose();
  } finally { start.mockRestore(); save.mockRestore(); }
});

test.each(["cancel", "replace"])("refresh %s stops waiting only and preserves dialog ownership and mutex", async how => {
  const settings = defaultBridgeSettings(); settings.bridge.enabled = true;
  await saveBridgeSettings(settings);
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const h = await harness([true]);
  h.sdk.config.providers = () => { started(); return new Promise(() => {}); };
  const task = h.run("models");
  await ready;
  h.choosePending("wait");
  await h.run("models");
  expect(h.calls).toEqual(["dispose"]);
  if (how === "cancel") h.choosePending("cancel"); else h.replaceWithForeign();
  await task;
  expect(h.foreignClosed()).toBe(false);
  expect(h.toasts.at(-1)?.message).toContain("waiting cancelled");
  expect((await loadBridgeSettings())?.bridge.enabled).toBe(true);
  expect(h.calls).not.toContain("model.list");
  await h.dispose();
});

test("saved-settings login keeps waiting on Enter before and after the private URL arrives", async () => {
  const settings = defaultBridgeSettings();
  await saveBridgeSettings(settings);
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let input!: Parameters<typeof client.startBridgeWorker>[0];
  let complete!: (value: client.BridgeSession) => void;
  const start = spyOn(client, "startBridgeWorker").mockImplementation(value => {
    input = value;
    started();
    return new Promise(resolve => { complete = resolve; });
  });
  try {
    const h = await harness([true, "browser"]);
    const task = h.run("login");
    await ready;
    expect(h.dialogs.some(dialog => dialog.kind === "prompt")).toBe(false);
    expect(input.start.gateway).toBe(settings.bridge.gateway);
    expect(input.start.hostname).toBe(settings.bridge.hostname);
    h.choosePending("wait");
    expect(input.signal?.aborted).toBe(false);
    input.onAuthRequired?.("https://login.test/private-login-link");
    expect(openBrowser).toHaveBeenCalledWith("https://login.test/private-login-link");
    input.onAuthRequired?.("https://login.test/private-login-link");
    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(input.signal?.aborted).toBe(false);
    expect(h.dialogs.at(-1)?.value).toBe("https://login.test/private-login-link");
    expect(h.dialogs.at(-1)?.kind).toBe("prompt");
    expect(h.dialogs.at(-1)?.title).toContain("Copy Aperture enrollment URL");
    h.choosePending("wait");
    expect(input.signal?.aborted).toBe(false);
    complete({ close: async () => {} } as client.BridgeSession);
    await task;
    expect((await loadBridgeSettings())?.bridge.enabled).toBe(true);
    expect(await readFile(settingsPath(), "utf8")).not.toContain("private-login-link");
    expect(h.toasts.at(-1)?.message).toContain("1 Aperture models ready");
    await h.dispose();
  } finally { start.mockRestore(); }
});

test.each(["cancel", "dismiss", "replace"])("enrollment %s is acknowledged without clearing another dialog", async how => {
  const settings = defaultBridgeSettings();
  await saveBridgeSettings(settings);
  const before = await readFile(settingsPath(), "utf8");
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let signal: AbortSignal | undefined;
  const start = spyOn(client, "startBridgeWorker").mockImplementation(input => {
    signal = input.signal;
    input.onAuthRequired?.("https://login.test/private-login-link");
    started();
    return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new Error("private-worker-error")), { once: true }));
  });
  try {
    const h = await harness([true, "browser"]);
    const task = h.run("login");
    await ready;
    if (how === "cancel") h.choosePending("cancel");
    else if (how === "replace") h.replaceWithForeign();
    else h.clear();
    await task;
    expect(signal?.aborted).toBe(true);
    expect(h.toasts).toHaveLength(1);
    expect(h.toasts[0]?.message).toContain("cancelled");
    expect(JSON.stringify(h.toasts)).not.toContain("private-login-link");
    expect(JSON.stringify(h.dialogs)).not.toContain("private-worker-error");
    expect(await readFile(settingsPath(), "utf8")).toBe(before);
    expect(h.foreignClosed()).toBe(false);
    await h.dispose();
  } finally { start.mockRestore(); }
});

test("login without saved settings directs to setup without starting enrollment", async () => {
  const start = spyOn(client, "startBridgeWorker").mockRejectedValue(new Error("must not start"));
  try {
    const h = await harness([]);
    await h.run("login");
    expect(h.dialogs.at(-1)?.message).toContain("/aperture-setup");
    expect(start).not.toHaveBeenCalled();
    await h.dispose();
  } finally { start.mockRestore(); }
});

test.each([
  ["Aperture bridge: STATE_LOCKED", "profile is locked"],
  ["Aperture bridge: STARTUP_TIMEOUT", "timed out"],
  ["Aperture bridge: AUTH_FAILED", "Tailscale rejected"],
  ["Aperture bridge: MODULE_UNAVAILABLE", "module could not load"],
  ["private-unknown-worker-error", "No secrets are shown"],
])("login failure %s gives safe guidance", async (failure, expected) => {
  await saveBridgeSettings(defaultBridgeSettings());
  const start = spyOn(client, "startBridgeWorker").mockRejectedValue(new Error(failure));
  try {
    const h = await harness([true, "browser"]);
    await h.run("login");
    expect(h.dialogs.at(-1)?.message).toContain(expected);
    expect(JSON.stringify(h.dialogs)).not.toContain("private-unknown-worker-error");
    expect((await loadBridgeSettings())?.bridge.enabled).toBe(false);
    await h.dispose();
  } finally { start.mockRestore(); }
});

test("real command shape and status use only local settings, no chat APIs", async () => {
  const h = await harness([]);
  expect(plugin.id).toBe("@jaxxstorm/opencode-aperture");
  expect(h.commands.map(c => [c.name, c.slashName])).toEqual([
    ["aperture.setup", "aperture-setup"], ["aperture.login", "aperture-login"], ["aperture.status", "aperture-status"], ["aperture.disconnect", "aperture-disconnect"],
    ["aperture.forget", "aperture-forget"],
    ["aperture.models", "aperture-models"],
  ]);
  await h.run("status");
  expect(h.dialogs.at(-1)?.message).toContain("not live connection status");
  expect(h.dialogs.at(-1)?.message).toContain("Remote TUI servers are unsupported");
  expect(await loadBridgeSettings()).toBeUndefined();
  await h.dispose();
});

test("cancelling any setup dialog leaves saved settings unchanged", async () => {
  const settings = defaultBridgeSettings();
  await saveBridgeSettings(settings);
  const original = await readFile(settingsPath(), "utf8");
  const start = spyOn(client, "startBridgeWorker").mockRejectedValue(new Error("must not start"));
  try {
    for (let i = 0; i < browserAnswers.length; i++) {
      const h = await harness([...browserAnswers.slice(0, i), undefined]);
      await h.run("setup");
      expect(await readFile(settingsPath(), "utf8")).toBe(original);
      await h.dispose();
    }
    expect(start).not.toHaveBeenCalled();
  } finally { start.mockRestore(); }
});

test("enrollment keeps auth URL in a dialog and closes worker and socket before saving", async () => {
  let socketPath = "";
  let closed = false;
  const start = spyOn(client, "startBridgeWorker").mockImplementation(async input => {
    expect(input.start.action).toBe("enroll");
    expect(input.start.browser).toBe(true);
    expect(input.start.gateway).toBe("https://gateway.test");
    expect(isAbsolute(input.workerPath)).toBe(true);
    expect(input.workerPath.endsWith("/bridge-worker.js")).toBe(true);
    socketPath = input.start.socketPath;
    input.onAuthRequired?.("https://login.test/private-token");
    expect(input.signal?.aborted).toBe(false);
    return { close: async () => { expect(await loadBridgeSettings()).toBeUndefined(); closed = true; } } as client.BridgeSession;
  });
  try {
    const h = await harness([...browserAnswers], async () => {
      expect(closed).toBe(true);
      await expect(lstat(join(socketPath, ".."))).rejects.toThrow();
      expect((await loadBridgeSettings())?.bridge.enabled).toBe(true);
    });
    await h.run("setup");
    expect(closed).toBe(true);
    expect((await loadBridgeSettings())?.bridge.enabled).toBe(true);
    await expect(lstat(join(socketPath, ".."))).rejects.toThrow();
    const auth = h.dialogs.filter(d => d.value?.includes("private-token"));
    expect(auth.length).toBe(1);
    expect(auth[0]?.kind).toBe("prompt");
    expect(h.toasts.at(-1)?.message).toContain("1 Aperture models ready");
    expect(await readFile(settingsPath(), "utf8")).not.toContain("private-token");
    await h.dispose();
  } finally { start.mockRestore(); }
});

test("env enrollment reads the named value only for start and never persists it", async () => {
  process.env.APERTURE_TUI_TEST_KEY = "secret-test-value";
  const start = spyOn(client, "startBridgeWorker").mockImplementation(async input => {
    expect(input.start.authKey).toBe("secret-test-value");
    expect(input.start.browser).toBe(false);
    return { close: async () => {} } as client.BridgeSession;
  });
  try {
    const h = await harness([...browserAnswers.slice(0, -1), "env", "APERTURE_TUI_TEST_KEY"]);
    await h.run("setup");
    expect(start).toHaveBeenCalledTimes(1);
    expect((await loadBridgeSettings())?.bridge.authKeyEnv).toBe("APERTURE_TUI_TEST_KEY");
    expect(await readFile(settingsPath(), "utf8")).not.toContain("secret-test-value");
    expect(JSON.stringify(h.dialogs)).not.toContain("secret-test-value");
    await h.dispose();
  } finally { start.mockRestore(); }
});

test("pending enrollment cancellation and disposal abort worker without saving", async () => {
  for (const disposal of [false, true]) {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let signal: AbortSignal | undefined;
    let socketPath = "";
    const start = spyOn(client, "startBridgeWorker").mockImplementation(input => {
      signal = input.signal;
      socketPath = input.start.socketPath;
      started();
      return new Promise((_, reject) => input.signal!.addEventListener("abort", () => reject(new Error("secret worker error")), { once: true }));
    });
    try {
      const h = await harness([...browserAnswers]);
      const task = h.run("setup");
      await ready;
      if (disposal) await h.dispose(); else h.clear();
      await task;
      expect(signal?.aborted).toBe(true);
      expect(await loadBridgeSettings()).toBeUndefined();
      await expect(lstat(join(socketPath, ".."))).rejects.toThrow();
      expect(JSON.stringify(h.dialogs)).not.toContain("secret worker error");
      expect(h.toasts).toHaveLength(disposal ? 0 : 1);
      if (!disposal) await h.dispose();
    } finally { start.mockRestore(); }
  }
});

test("disconnect requires confirmation and explicitly takes effect on restart", async () => {
  const settings = defaultBridgeSettings();
  settings.bridge.enabled = true;
  await saveBridgeSettings(settings);
  const cancelled = await harness([false]);
  await cancelled.run("disconnect");
  expect((await loadBridgeSettings())?.bridge.enabled).toBe(true);
  await cancelled.dispose();
  const h = await harness([true]);
  await h.run("disconnect");
  expect((await loadBridgeSettings())?.bridge.enabled).toBe(false);
  expect(h.dialogs.at(-1)?.message).toContain("restart OpenCode");
  expect(h.dialogs.at(-1)?.message).toContain("Identity is retained");
  await h.dispose();
});

test("disable and enrollment CAS reject writers arriving after the UI precheck", async () => {
  const save = persistence.saveBridgeSettings;
  for (const kind of ["disconnect", "setup"]) {
    const original = defaultBridgeSettings();
    original.bridge.enabled = kind === "disconnect";
    await save(original);
    const changed = structuredClone(original);
    changed.bridge.hostname = "concurrent-device";
    const start = spyOn(client, "startBridgeWorker").mockResolvedValue({ close: async () => {} } as client.BridgeSession);
    const writer = spyOn(persistence, "saveBridgeSettings").mockImplementation(async (settings, options) => {
      expect(options).toEqual({ expected: original });
      await save(changed);
      await save(settings, options);
    });
    try {
      const h = await harness(kind === "disconnect" ? [true] : [...browserAnswers]);
      await h.run(kind);
      expect(writer).toHaveBeenCalledTimes(1);
      expect(await loadBridgeSettings()).toEqual(changed);
      expect(h.dialogs.at(-1)?.message).toContain("could not complete");
      await h.dispose();
    } finally { writer.mockRestore(); start.mockRestore(); }
  }
});

test("worker failure is redacted and leaves settings unchanged", async () => {
  const settings = defaultBridgeSettings();
  await saveBridgeSettings(settings);
  const before = await readFile(settingsPath(), "utf8");
  const start = spyOn(client, "startBridgeWorker").mockRejectedValue(new Error("secret-auth-material"));
  try {
    const h = await harness([...browserAnswers]);
    await h.run("setup");
    expect(await readFile(settingsPath(), "utf8")).toBe(before);
    expect(JSON.stringify(h.dialogs)).not.toContain("secret-auth-material");
    expect(h.dialogs.at(-1)?.message).toContain("could not complete");
    await h.dispose();
  } finally { start.mockRestore(); }
});

test("forget deletes identity only after confirmation, keeps settings and never reveals secrets", async () => {
  const settings = defaultBridgeSettings();
  await prepareBridgeStateDirectory(settings.bridge.stateDir);
  await saveBridgeSettings(settings);
  const before = await readFile(settingsPath(), "utf8");
  const identity = join(settings.bridge.stateDir, "identity");
  await writeFile(identity, "private-identity-secret", { mode: 0o600 });
  for (const answer of [false, undefined]) {
    const h = await harness([answer]);
    await h.run("forget");
    expect(await readFile(identity, "utf8")).toBe("private-identity-secret");
    expect(await readFile(settingsPath(), "utf8")).toBe(before);
    await h.dispose();
  }
  const h = await harness([true]);
  await h.run("forget");
  expect(h.dialogs[0]?.kind).toBe("confirm");
  expect(h.dialogs[0]?.message).toContain(settings.bridge.stateDir);
  expect(h.dialogs[0]?.message).toContain("Disable and restart");
  expect(h.dialogs.at(-1)?.message).toContain("profile forgotten");
  expect(h.dialogs.at(-1)?.message).toContain("revocation is separate");
  expect(JSON.stringify(h.dialogs)).not.toContain("private-identity-secret");
  await expect(lstat(settings.bridge.stateDir)).rejects.toThrow();
  expect(await readFile(settingsPath(), "utf8")).toBe(before);
  await h.dispose();
});

test("forget refuses enabled, live, stale, and unmarked profiles with safe guidance", async () => {
  const settings = defaultBridgeSettings();
  settings.bridge.enabled = true;
  await prepareBridgeStateDirectory(settings.bridge.stateDir);
  await saveBridgeSettings(settings);
  const enabled = await harness([true]);
  await enabled.run("forget");
  expect(enabled.dialogs.some(d => d.kind === "confirm")).toBe(false);
  expect(enabled.dialogs.at(-1)?.message).toContain("restart OpenCode first");
  await enabled.dispose();
  settings.bridge.enabled = false;
  await saveBridgeSettings(settings);
  const release = await claimBridgeStateLease(settings.bridge.stateDir);
  for (const kind of ["live", "stale", "unmarked"]) {
    if (kind === "stale") {
      await release();
      await mkdir(settings.bridge.stateDir + ".aperture-lock", { mode: 0o700 });
    }
    if (kind === "unmarked") {
      await rm(settings.bridge.stateDir + ".aperture-lock", { recursive: true });
      await rm(join(settings.bridge.stateDir, ".opencode-aperture-profile"));
    }
    const h = await harness([true]);
    await h.run("forget");
    expect(h.dialogs.at(-1)?.message).toContain("could not forget");
    expect(h.dialogs.at(-1)?.message).toContain("stop all OpenCode processes and helpers");
    expect((await lstat(settings.bridge.stateDir)).isDirectory()).toBe(true);
    expect(await loadBridgeSettings()).toEqual(settings);
    await h.dispose();
  }
});
