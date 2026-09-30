import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import * as fs from "node:fs/promises";
import { claimBridgeStateLease, createBridgeSocketDir, defaultBridgeSettings, forgetBridgeState, loadBridgeSettings, prepareAndClaimBridgeState, prepareBridgeStateDirectory,
  resolveBridgeRuntime, saveBridgeSettings, settingsPath, validateBridgeSettings } from "../src/bridge-settings";

let root: string;
let config: string | undefined;
let state: string | undefined;
beforeEach(async () => {
  config = process.env.XDG_CONFIG_HOME;
  state = process.env.XDG_STATE_HOME;
  root = await mkdtemp(join(await realpath(tmpdir()), "aperture-settings-test-"));
  process.env.XDG_CONFIG_HOME = join(root, "config");
  process.env.XDG_STATE_HOME = join(root, "state");
});
afterEach(async () => {
  if (config === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = config;
  if (state === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = state;
  await rm(root, { recursive: true, force: true });
});

describe("bridge settings", () => {
  test("forget holds the settings transaction against concurrent re-enable", async () => {
    const settings = defaultBridgeSettings();
    await prepareBridgeStateDirectory(settings.bridge.stateDir);
    await saveBridgeSettings(settings);
    let entered!: () => void;
    let resume!: () => void;
    const scanning = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { resume = resolve; });
    const read = fs.readdir;
    const scan = spyOn(fs, "readdir").mockImplementation((async (...args: Parameters<typeof fs.readdir>) => {
      if (args[0] === settings.bridge.stateDir) { entered(); await paused; }
      return read(...args);
    }) as typeof fs.readdir);
    const forgetting = forgetBridgeState(settings);
    try {
      await scanning;
      await expect(saveBridgeSettings({ ...settings, bridge: { ...settings.bridge, enabled: true } },
        { expected: settings })).rejects.toThrow("locked");
      expect((await lstat(settings.bridge.stateDir)).isDirectory()).toBe(true);
    } finally { resume(); await forgetting; scan.mockRestore(); }
    expect(await loadBridgeSettings()).toEqual(settings);
    await expect(lstat(settings.bridge.stateDir)).rejects.toThrow();
  });

  test("home and root working directories permit defaults without writing home state", async () => {
    for (const cwd of [homedir(), "/"]) {
      const child = Bun.spawn([process.execPath, "--eval", `
        import { defaultBridgeSettings, validateBridgeSettings } from ${JSON.stringify(new URL("../src/bridge-settings.ts", import.meta.url).pathname)};
        delete process.env.XDG_STATE_HOME;
        delete process.env.XDG_CONFIG_HOME;
        validateBridgeSettings(defaultBridgeSettings());
      `], { cwd, stdout: "pipe", stderr: "pipe" });
      const error = await new Response(child.stderr).text();
      expect(error).toBe("");
      expect(await child.exited).toBe(0);
    }
    expect(await readdir(root)).toEqual([]);
  });

  test("CAS rejects stale snapshots and absent expectations without changing settings", async () => {
    const original = defaultBridgeSettings();
    await saveBridgeSettings(original, { expected: undefined });
    const changed = structuredClone(original);
    changed.bridge.hostname = "other-device";
    await saveBridgeSettings(changed, { expected: original });
    const before = await readFile(settingsPath(), "utf8");
    for (const expected of [undefined, original]) {
      await expect(saveBridgeSettings(original, { expected })).rejects.toThrow("settings changed");
      expect(await readFile(settingsPath(), "utf8")).toBe(before);
      expect(await readdir(join(root, "config/opencode-aperture"))).toEqual(["settings.json"]);
    }
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
      saveBridgeSettings({ ...changed, bridge: { ...changed.bridge, hostname: `writer-${i}` } }, { expected: changed })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    await saveBridgeSettings(original);
    expect(await loadBridgeSettings()).toEqual(original);
  });

  test("prepare-and-claim holds one continuous lease and validates markers under it", async () => {
    const settings = defaultBridgeSettings();
    const path = settings.bridge.stateDir;
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => prepareAndClaimBridgeState(path)));
    const winners = results.filter(r => r.status === "fulfilled");
    expect(winners).toHaveLength(1);
    const winner = winners[0]!;
    if (winner.status !== "fulfilled") throw new Error("Missing lease");
    await saveBridgeSettings(settings);
    const marker = join(path, ".opencode-aperture-profile");
    expect((await lstat(path)).mode & 0o777).toBe(0o700);
    expect(await readFile(marker, "utf8")).toContain("local bridge profile v1");
    await expect(forgetBridgeState(settings)).rejects.toThrow("locked");
    await writeFile(marker, "invalid");
    await expect(prepareAndClaimBridgeState(path)).rejects.toThrow("locked");
    await winner.value();
    await expect(prepareAndClaimBridgeState(path)).rejects.toThrow("unsafe");
    await expect(lstat(path + ".aperture-lock")).rejects.toThrow();
  });

  test("nested paths are rejected before creation or lease claims", async () => {
    const settings = defaultBridgeSettings();
    await prepareBridgeStateDirectory(settings.bridge.stateDir);
    const child = join(settings.bridge.stateDir, "helpers/deep/child");
    expect(() => validateBridgeSettings({ ...settings, bridge: { ...settings.bridge, stateDir: child } })).toThrow();
    await expect(prepareAndClaimBridgeState(child)).rejects.toThrow();
    await expect(claimBridgeStateLease(child)).rejects.toThrow();
    expect(await readdir(settings.bridge.stateDir)).toEqual([".opencode-aperture-profile"]);
  });

  test("parent forget preserves legacy nested profiles and live or stale child leases", async () => {
    const settings = defaultBridgeSettings();
    const path = settings.bridge.stateDir;
    await prepareBridgeStateDirectory(path);
    await saveBridgeSettings(settings);
    // Simulate a legacy child lease acquired before the parent was marked.
    const marker = join(path, ".opencode-aperture-profile");
    const label = await readFile(marker, "utf8");
    await rm(marker);
    const child = join(path, "helpers/child");
    const release = await prepareAndClaimBridgeState(child);
    await writeFile(marker, label, { mode: 0o600 });
    await writeFile(join(child, "identity"), "keep", { mode: 0o600 });
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    expect((await lstat(child + ".aperture-lock")).isDirectory()).toBe(true);
    await release();
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    expect(await readFile(join(child, "identity"), "utf8")).toBe("keep");
    await rm(join(child, ".opencode-aperture-profile"));
    await mkdir(child + ".aperture-lock", { mode: 0o700 });
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    expect(await readFile(join(child, "identity"), "utf8")).toBe("keep");
    expect(await readdir(join(path, ".."))).toEqual(["node"]);
  });

  test("absent and disabled reads never create state or resolve a runtime", async () => {
    expect(await loadBridgeSettings()).toBeUndefined();
    expect(await readdir(root)).toEqual([]);
    const settings = defaultBridgeSettings();
    expect(settings.bridge.enabled).toBe(false);
    expect(settings.bridge.startupTimeoutMs).toBe(60_000);
    expect(settingsPath()).toBe(join(root, "config/opencode-aperture/settings.json"));
    await saveBridgeSettings(settings);
    const which = spyOn(Bun, "which").mockImplementation(() => { throw new Error("must not resolve"); });
    try { expect(await loadBridgeSettings()).toEqual(settings); } finally { which.mockRestore(); }
    expect(await readdir(root)).toEqual(["config"]);
  });

  test("strict schema, origins, state paths, runtime, module and env references", () => {
    const defaults = defaultBridgeSettings();
    const invalid = [
      { enabled: "yes" }, { gateway: "http://gateway.test" }, { gateway: "https://user:password@gateway.test" },
      { gateway: "https://gateway.test/path" }, { gateway: "https://gateway.test/?" }, { gateway: "https://gateway.test/#" },
      { gateway: "https://gateway.test/.." }, { hostname: " " }, { stateDir: "/" }, { stateDir: homedir() },
      { stateDir: process.cwd() }, { stateDir: join(process.cwd(), "identity") }, { stateDir: "/etc/identity" },
      { stateDir: join(homedir(), ".ssh/identity") }, { stateDir: join(root, "config/node") },
      { stateDir: "relative" }, { runtime: { mode: "auto" } }, { runtime: { mode: "external", executable: "" } },
      { runtime: { mode: "external", executable: "bun" } }, { runtime: { mode: "external", fallback: true } },
      { modulePath: "entry.js" }, { modulePath: "/private/entry.ts" }, { authKeyEnv: "tskey-secret" },
      { authKeyEnv: "KEY=value" }, { authKey: "secret" }, { startupTimeoutMs: 0 }, { startupTimeoutMs: 300001 },
      { startupTimeoutMs: 1.5 }, { startupTimeoutMs: null },
    ];
    for (const bridge of invalid) expect(() => validateBridgeSettings({ ...defaults, bridge: { ...defaults.bridge, ...bridge } })).toThrow();
    expect(() => validateBridgeSettings({ ...defaults, version: 2 })).toThrow();
    expect(() => validateBridgeSettings({ ...defaults, extra: true })).toThrow();
    const { startupTimeoutMs: _, ...bridge } = defaults.bridge;
    expect(validateBridgeSettings({ version: 1, bridge }).bridge.startupTimeoutMs).toBe(60000);
    expect(validateBridgeSettings({ ...defaults, bridge: { ...bridge, gateway: "https://gateway.test:443/", startupTimeoutMs: 300000 } }).bridge.startupTimeoutMs).toBe(300000);
  });

  test("private atomic persistence stores a reference, never an environment value", async () => {
    process.env.APERTURE_SETTINGS_TEST_KEY = "secret-never-persist";
    try {
      const settings = defaultBridgeSettings();
      settings.bridge.authKeyEnv = "APERTURE_SETTINGS_TEST_KEY";
      await saveBridgeSettings(settings);
      const text = await readFile(settingsPath(), "utf8");
      expect(text).toContain("APERTURE_SETTINGS_TEST_KEY");
      expect(text).not.toContain("secret-never-persist");
      expect((await lstat(settingsPath())).mode & 0o777).toBe(0o600);
      expect((await lstat(join(root, "config/opencode-aperture"))).mode & 0o777).toBe(0o700);
      expect(await readdir(join(root, "config/opencode-aperture"))).toEqual(["settings.json"]);
      expect(await loadBridgeSettings()).toEqual(settings);
    } finally { delete process.env.APERTURE_SETTINGS_TEST_KEY; }
  });

  test("symlink files, ancestors, project state and unsafe permissions fail closed", async () => {
    const settings = defaultBridgeSettings();
    await mkdir(join(root, "target"), { mode: 0o700 });
    await symlink(join(root, "target"), join(root, "config"));
    await expect(loadBridgeSettings()).rejects.toThrow();
    await expect(saveBridgeSettings(settings)).rejects.toThrow();
    await rm(join(root, "config"));
    await saveBridgeSettings(settings);
    await chmod(settingsPath(), 0o644);
    await expect(loadBridgeSettings()).rejects.toThrow();
    await expect(saveBridgeSettings(settings)).rejects.toThrow();
    await rm(settingsPath());
    await symlink(join(root, "target/secret"), settingsPath());
    await expect(loadBridgeSettings()).rejects.toThrow();
    await expect(saveBridgeSettings(settings)).rejects.toThrow();
    await symlink(join(root, "target"), join(root, "state-link"));
    expect(() => validateBridgeSettings({ ...settings, bridge: { ...settings.bridge, stateDir: join(root, "state-link/node") } })).toThrow();
    await writeFile(join(root, "target/package.json"), "{}");
    expect(() => validateBridgeSettings({ ...settings, bridge: { ...settings.bridge, stateDir: join(root, "target/node") } })).toThrow();
  });

  test("locks are not stolen and concurrent writes leave complete settings", async () => {
    const settings = defaultBridgeSettings();
    await saveBridgeSettings(settings);
    const before = await readFile(settingsPath(), "utf8");
    await writeFile(settingsPath() + ".lock", "other writer", { mode: 0o600 });
    await expect(saveBridgeSettings({ ...settings, bridge: { ...settings.bridge, enabled: true } })).rejects.toThrow("locked");
    expect(await readFile(settingsPath(), "utf8")).toBe(before);
    expect(await readFile(settingsPath() + ".lock", "utf8")).toBe("other writer");
    await rm(settingsPath() + ".lock");
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => saveBridgeSettings(settings)));
    expect(results.some(r => r.status === "fulfilled")).toBe(true);
    expect(await loadBridgeSettings()).toEqual(settings);
    expect(await readdir(join(root, "config/opencode-aperture"))).toEqual(["settings.json"]);
  });

  test("runtime selection is explicit and never falls back", () => {
    const which = spyOn(Bun, "which").mockReturnValue(null);
    try {
      expect(() => resolveBridgeRuntime({ mode: "external" })).toThrow();
      expect(resolveBridgeRuntime({ mode: "opencode" }).executable).toBe(process.execPath);
      expect(resolveBridgeRuntime({ mode: "external", executable: "/private/runtime/bun" })).toEqual({ mode: "external", executable: "/private/runtime/bun" });
      which.mockReturnValue("relative/bun");
      expect(() => resolveBridgeRuntime({ mode: "external" })).toThrow();
      which.mockReturnValue("/private/runtime/bun");
      expect(resolveBridgeRuntime({ mode: "external" }).executable).toBe("/private/runtime/bun");
    } finally { which.mockRestore(); }
  });

  test("state creation is private and socket cleanup never removes unexpected contents", async () => {
    const stateDir = defaultBridgeSettings().bridge.stateDir;
    await prepareBridgeStateDirectory(stateDir);
    expect((await lstat(stateDir)).mode & 0o777).toBe(0o700);
    const socket = await createBridgeSocketDir();
    try {
      expect(Buffer.byteLength(socket.socketPath)).toBeLessThanOrEqual(100);
      expect((await lstat(socket.directory)).mode & 0o777).toBe(0o700);
      await writeFile(join(socket.directory, "unexpected"), "keep");
      await expect(socket.cleanup()).rejects.toThrow();
      expect(await readFile(join(socket.directory, "unexpected"), "utf8")).toBe("keep");
      await rm(join(socket.directory, "unexpected"));
      await socket.cleanup();
      await socket.cleanup();
    } finally { await rm(socket.directory, { recursive: true, force: true }); }
  });

  test("preparation marks only empty private profiles and never adopts existing identity", async () => {
    const path = defaultBridgeSettings().bridge.stateDir;
    await prepareBridgeStateDirectory(path);
    const marker = join(path, ".opencode-aperture-profile");
    expect((await lstat(marker)).mode & 0o777).toBe(0o600);
    expect(await readFile(marker, "utf8")).toBe("opencode-aperture local bridge profile v1\n");
    await writeFile(join(path, "identity"), "secret", { mode: 0o600 });
    await prepareBridgeStateDirectory(path);
    await rm(marker);
    await expect(prepareBridgeStateDirectory(path)).rejects.toThrow();
    expect(await readdir(path)).toEqual(["identity"]);
    await symlink(join(path, "identity"), marker);
    await expect(prepareBridgeStateDirectory(path)).rejects.toThrow();
    expect(await readFile(join(path, "identity"), "utf8")).toBe("secret");
  });

  test("forget rejects live and stale leases without stealing them", async () => {
    const settings = defaultBridgeSettings();
    const path = settings.bridge.stateDir;
    await prepareBridgeStateDirectory(path);
    await saveBridgeSettings(settings);
    await writeFile(join(path, "identity"), "secret", { mode: 0o600 });
    const release = await claimBridgeStateLease(path);
    expect((await lstat(path + ".aperture-lock")).mode & 0o777).toBe(0o700);
    await expect(claimBridgeStateLease(path)).rejects.toThrow("locked");
    await expect(forgetBridgeState(settings)).rejects.toThrow("locked");
    await expect(prepareBridgeStateDirectory(path)).rejects.toThrow("locked");
    expect(await readFile(join(path, "identity"), "utf8")).toBe("secret");
    await release();
    await release();
    await mkdir(path + ".aperture-lock", { mode: 0o700 });
    await expect(forgetBridgeState(settings)).rejects.toThrow("stale");
    expect((await lstat(path + ".aperture-lock")).isDirectory()).toBe(true);
    expect(await readFile(join(path, "identity"), "utf8")).toBe("secret");
  });

  test("forget requires matching disabled settings and a valid private ownership marker", async () => {
    const settings = defaultBridgeSettings();
    const path = settings.bridge.stateDir;
    await prepareBridgeStateDirectory(path);
    await saveBridgeSettings(settings);
    const marker = join(path, ".opencode-aperture-profile");
    const label = await readFile(marker, "utf8");
    await expect(forgetBridgeState({ ...settings, bridge: { ...settings.bridge, enabled: true } })).rejects.toThrow("Disable");
    await saveBridgeSettings({ ...settings, bridge: { ...settings.bridge, enabled: true } });
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    await saveBridgeSettings(settings);
    const moved = structuredClone(settings);
    moved.bridge.stateDir = join(root, "other-profile");
    await saveBridgeSettings(moved);
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    await saveBridgeSettings(settings);
    await rm(marker);
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    await writeFile(join(root, "marker-target"), label, { mode: 0o600 });
    await symlink(join(root, "marker-target"), marker);
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    expect(await readFile(join(root, "marker-target"), "utf8")).toBe(label);
    await rm(marker);
    await writeFile(marker, "not our profile", { mode: 0o600 });
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    await writeFile(marker, label);
    await chmod(marker, 0o644);
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    await chmod(marker, 0o600);
    await chmod(path, 0o755);
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    await chmod(path, 0o700);
    await writeFile(settingsPath() + ".lock", "busy", { mode: 0o600 });
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    expect(await readFile(settingsPath() + ".lock", "utf8")).toBe("busy");
    expect(await readFile(marker, "utf8")).toBe(label);
    for (const stateDir of [root, process.cwd(), join(process.cwd(), "identity"), "/", homedir()]) {
      await expect(forgetBridgeState({ ...settings, bridge: { ...settings.bridge, stateDir } })).rejects.toThrow();
    }
  });

  test("lease claims are exclusive and release never removes a replacement", async () => {
    const path = defaultBridgeSettings().bridge.stateDir;
    await prepareBridgeStateDirectory(path);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => claimBridgeStateLease(path)));
    const winners = results.filter(r => r.status === "fulfilled");
    expect(winners).toHaveLength(1);
    const winner = winners[0]!;
    if (winner.status !== "fulfilled") throw new Error("Missing lease");
    const lockPath = path + ".aperture-lock";
    await rename(lockPath, lockPath + ".original");
    await mkdir(lockPath, { mode: 0o700 });
    await expect(winner.value()).rejects.toThrow();
    expect((await lstat(lockPath)).isDirectory()).toBe(true);
    await rm(lockPath, { recursive: true });
    await rename(lockPath + ".original", lockPath);
    await winner.value();
    await symlink(root, lockPath);
    await expect(claimBridgeStateLease(path)).rejects.toThrow("locked");
    expect((await lstat(lockPath)).isSymbolicLink()).toBe(true);
  });

  test("forget refuses a symlink replacing the profile root", async () => {
    const settings = defaultBridgeSettings();
    const path = settings.bridge.stateDir;
    await prepareBridgeStateDirectory(path);
    await saveBridgeSettings(settings);
    await rename(path, path + ".original");
    await symlink(path + ".original", path);
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    expect((await lstat(path)).isSymbolicLink()).toBe(true);
    expect(await readdir(path + ".original")).toEqual([".opencode-aperture-profile"]);
  });

  test("forget deletes only the owned profile, not linked targets, settings, or sibling secrets", async () => {
    const settings = defaultBridgeSettings();
    const path = settings.bridge.stateDir;
    await prepareBridgeStateDirectory(path);
    await saveBridgeSettings(settings);
    const before = await readFile(settingsPath(), "utf8");
    await writeFile(join(root, "unrelated-secret"), "keep", { mode: 0o600 });
    await writeFile(join(path, "identity"), "local-identity-secret", { mode: 0o600 });
    // The helper deliberately leaves this file after releasing its flock.
    await writeFile(join(path, ".bridge.lock"), "", { mode: 0o600 });
    await symlink(root, join(path, "external"));
    await expect(forgetBridgeState(settings)).rejects.toThrow();
    expect((await lstat(path)).isDirectory()).toBe(true);
    await rm(join(path, "external"));
    await mkdir(join(path, "helper-data"), { mode: 0o700 });
    await writeFile(join(path, "helper-data/state"), "helper-state", { mode: 0o600 });
    await forgetBridgeState(settings);
    await expect(lstat(path)).rejects.toThrow();
    await expect(lstat(path + ".aperture-lock")).rejects.toThrow();
    expect(await readdir(join(path, ".."))).toEqual([]);
    expect(await readFile(join(root, "unrelated-secret"), "utf8")).toBe("keep");
    expect(await readFile(settingsPath(), "utf8")).toBe(before);
    await prepareBridgeStateDirectory(path);
    expect(await readdir(path)).toEqual([".opencode-aperture-profile"]);
  });

  test("socket cleanup rejects replaced directories and socket symlinks", async () => {
    const socket = await createBridgeSocketDir();
    try {
      await symlink(root, socket.socketPath);
      await expect(socket.cleanup()).rejects.toThrow();
      expect((await lstat(socket.socketPath)).isSymbolicLink()).toBe(true);
      await rm(socket.socketPath);
      await rm(socket.directory, { recursive: true });
      await symlink(root, socket.directory);
      await expect(socket.cleanup()).rejects.toThrow();
      expect((await lstat(root)).isDirectory()).toBe(true);
    } finally { await rm(socket.directory, { force: true }); }
  });

  test("unsafe state permissions and malformed settings never get repaired silently", async () => {
    const settings = defaultBridgeSettings();
    await prepareBridgeStateDirectory(settings.bridge.stateDir);
    await chmod(settings.bridge.stateDir, 0o755);
    await expect(saveBridgeSettings(settings)).rejects.toThrow();
    expect((await lstat(settings.bridge.stateDir)).mode & 0o777).toBe(0o755);
    await chmod(settings.bridge.stateDir, 0o700);
    await saveBridgeSettings(settings);
    await writeFile(settingsPath(), '{"authKey":"secret-malformed-json"', { mode: 0o600 });
    await expect(loadBridgeSettings()).rejects.toThrow("Invalid or unsafe");
  });
});
