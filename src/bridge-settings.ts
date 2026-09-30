import { constants, lstatSync, realpathSync, existsSync, type Stats } from "node:fs";
import { lstat, mkdir, mkdtemp, open, rename, unlink, rmdir, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export type BridgeSettings = {
  version: 1;
  bridge: {
    enabled: boolean;
    gateway: string;
    hostname: string;
    stateDir: string;
    runtime: { mode: "external" | "opencode"; executable?: string };
    modulePath?: string;
    authKeyEnv?: string;
    startupTimeoutMs: number;
  };
};
const invalid = () => new Error("Invalid or unsafe Aperture bridge settings");
const absolute = (v: unknown): v is string => typeof v === "string" && !!v.trim()
  && isAbsolute(v) && !/[\0\r\n]/.test(v);
const within = (path: string, base: string) => path === base || path.startsWith(base + sep);
const uid = () => process.getuid!();
function base(variable: string, fallback: string): string {
  const value = process.env[variable] || fallback;
  if (!absolute(value)) throw invalid();
  return resolve(value);
}
export function settingsPath(): string {
  return join(base("XDG_CONFIG_HOME", join(homedir(), ".config")), "opencode-aperture", "settings.json");
}
export function defaultBridgeSettings(): BridgeSettings {
  return { version: 1, bridge: { enabled: false, gateway: "https://aperture.example.com",
    hostname: "opencode-aperture", stateDir: join(base("XDG_STATE_HOME", join(homedir(), ".local/state")), "opencode-aperture/node"),
    runtime: { mode: "external" }, startupTimeoutMs: 60_000 } };
}
function fields(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) throw invalid();
}
// Inspect every existing component, including ancestors of a not-yet-created path.
function inspectPath(path: string): void {
  const parent = dirname(path);
  if (parent !== path) inspectPath(parent);
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      // macOS's root-owned OS aliases are not user-controlled redirects.
      if (stat.uid === 0 && ["/tmp", "/var"].includes(path) && realpathSync(path) === "/private" + path) return;
      throw invalid();
    }
    if (stat.uid !== uid() && stat.uid !== 0) throw invalid();
    if (stat.isDirectory() && (stat.mode & 0o022) && !(stat.uid === 0 && (stat.mode & 0o1000))) throw invalid();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
function validateState(path: unknown): asserts path is string {
  if (!absolute(path) || resolve(path) !== path) throw invalid();
  inspectPath(path);
  const canonical = (value: string): string => {
    try { return realpathSync(value); }
    catch (error) {
      if (!["ENOENT", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      return join(canonical(dirname(value)), basename(value));
    }
  };
  const actual = canonical(path);
  const config = dirname(dirname(settingsPath()));
  const forbidden = [fileURLToPath(new URL("..", import.meta.url)), config,
    join(homedir(), ".config"), join(homedir(), ".ssh"), "/etc", "/usr", "/bin", "/sbin", "/System", "/Library", "/Applications", "/dev", "/proc", "/sys", "/boot", "/opt", "/srv", "/run",
    "/var/lib", "/var/run", "/var/log", "/var/db", "/var/cache", "/var/spool", "/var/root", "/var/backups"];
  if (["/", homedir(), "/tmp", "/var", "/private", "/private/tmp", "/private/var", "/Users", "/home",
    base("XDG_STATE_HOME", join(homedir(), ".local/state"))].includes(path)
    || forbidden.some(p => within(actual, canonical(resolve(p))))
    || path.split(sep).some(p => [".ssh", ".git", "node_modules", ".config"].includes(p))) throw invalid();
  for (let p = process.cwd(); ; p = dirname(p)) {
    if ((existsSync(join(p, ".git")) || existsSync(join(p, "package.json")))
      && within(canonical(p), actual)) throw invalid();
    if (dirname(p) === p) break;
  }
  for (let p = dirname(path); ; p = dirname(p)) {
    try { lstatSync(join(p, profileMarker)); throw invalid(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (dirname(p) === p) break;
  }
  for (let p = path; dirname(p) !== p; p = dirname(p)) {
    if (existsSync(join(p, ".git")) || existsSync(join(p, "package.json"))) throw invalid();
  }
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.uid !== uid() || (stat.mode & 0o777) !== 0o700) throw invalid();
  }
}
export function validateBridgeSettings(value: unknown): BridgeSettings {
  fields(value, ["version", "bridge"]);
  if (value.version !== 1) throw invalid();
  const b = value.bridge;
  fields(b, ["enabled", "gateway", "hostname", "stateDir", "runtime", "modulePath", "authKeyEnv", "startupTimeoutMs"]);
  fields(b.runtime, ["mode", "executable"]);
  if (typeof b.enabled !== "boolean" || typeof b.gateway !== "string"
    || !/^https:\/\/[^/?#@\s\\]+\/?$/.test(b.gateway)
    || typeof b.hostname !== "string" || !b.hostname.trim() || /[\0\r\n]/.test(b.hostname)
    || !["external", "opencode"].includes(b.runtime.mode as string)
    || (b.runtime.executable !== undefined && !absolute(b.runtime.executable))
    || (b.modulePath !== undefined && (!absolute(b.modulePath) || !/\.(?:js|mjs|cjs)$/.test(b.modulePath)))
    || (b.authKeyEnv !== undefined && (typeof b.authKeyEnv !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(b.authKeyEnv)))) throw invalid();
  try {
    const url = new URL(b.gateway);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw invalid();
  } catch { throw invalid(); }
  const timeout = b.startupTimeoutMs === undefined ? 60_000 : b.startupTimeoutMs;
  if (!Number.isInteger(timeout) || (timeout as number) < 1 || (timeout as number) > 300_000) throw invalid();
  validateState(b.stateDir);
  return structuredClone({ version: 1, bridge: { ...b, startupTimeoutMs: timeout } }) as BridgeSettings;
}
export function resolveBridgeRuntime(runtime: BridgeSettings["bridge"]["runtime"]): { mode: "external" | "opencode"; executable: string } {
  fields(runtime, ["mode", "executable"]);
  if (!["external", "opencode"].includes(runtime.mode) || (runtime.executable !== undefined && !absolute(runtime.executable))) throw invalid();
  const executable = runtime.executable ?? (runtime.mode === "opencode" ? process.execPath : Bun.which("bun"));
  if (!absolute(executable)) throw new Error("Aperture requires an absolute Bun executable; no runtime fallback is used");
  return { mode: runtime.mode, executable: resolve(executable) };
}
async function privateDirectory(path: string): Promise<void> {
  inspectPath(path);
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { await privateDirectory(dirname(path)); await privateDirectory(path); return; }
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid() || (stat.mode & 0o777) !== 0o700) throw invalid();
}
export async function prepareBridgeStateDirectory(path: string): Promise<void> {
  const release = await prepareAndClaimBridgeState(path);
  await release();
}
// Return the still-held lease so workers cannot race forget between preparation and use.
export async function prepareAndClaimBridgeState(path: string): Promise<() => Promise<void>> {
  const release = await claimBridgeStateLease(path);
  try {
    validateState(path);
    await privateDirectory(path);
    const entries = await readdir(path);
    if (entries.includes(profileMarker)) { await checkProfileMarker(path); return release; }
    if (entries.length) throw invalid();
    const file = await open(join(path, profileMarker), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(profileLabel); await file.sync(); } finally { await file.close(); }
    return release;
  } catch (error) { await release(); throw error; }
}
const profileMarker = ".opencode-aperture-profile";
const profileLabel = "opencode-aperture local bridge profile v1\n";
async function checkProfileMarker(path: string): Promise<void> {
  const file = await open(join(path, profileMarker), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    privateFile(stat);
    if (stat.size !== Buffer.byteLength(profileLabel) || await file.readFile("utf8") !== profileLabel) throw invalid();
  } finally { await file.close(); }
}
// Every worker must hold this lease from before createBridge until the helper has
// actually stopped. Crashes leave a stale lease: never steal or expire it.
export async function claimBridgeStateLease(path: string): Promise<() => Promise<void>> {
  validateState(path);
  await privateDirectory(dirname(path));
  const lockPath = path + ".aperture-lock";
  try { await mkdir(lockPath, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error("Aperture profile is locked. Stop all OpenCode processes and helpers before manually reviewing and removing a stale .aperture-lock directory; never remove a live lease.");
  }
  const owner = await lstat(lockPath);
  let released = false;
  return async () => {
    if (released) return;
    inspectPath(lockPath);
    const current = await lstat(lockPath);
    if (!current.isDirectory() || current.isSymbolicLink() || current.uid !== uid()
      || (current.mode & 0o777) !== 0o700 || current.dev !== owner.dev || current.ino !== owner.ino) throw invalid();
    await rmdir(lockPath);
    released = true;
  };
}
export async function forgetBridgeState(settings: BridgeSettings): Promise<void> {
  const expected = validateBridgeSettings(settings);
  if (expected.bridge.enabled) throw new Error("Disable the bridge and restart OpenCode before forgetting its local profile");
  // Serialize with settings writers so a saved enable cannot race deletion.
  const lockPath = settingsPath() + ".lock";
  inspectPath(lockPath);
  const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    if (JSON.stringify(await loadBridgeSettings()) !== JSON.stringify(expected)) throw invalid();
    const path = expected.bridge.stateDir;
    const release = await claimBridgeStateLease(path);
    try {
      validateState(path);
      await checkProfileMarker(path);
      // Legacy or manually nested profiles must never be removed with their parent.
      async function inspectContents(directory: string): Promise<void> {
        for (const name of await readdir(directory)) {
          const entry = join(directory, name);
          const stat = await lstat(entry);
          if (stat.isSymbolicLink() || (name === profileMarker && directory !== path)
            || (stat.isDirectory() && name.endsWith(".aperture-lock"))) throw invalid();
          if (stat.isDirectory()) await inspectContents(entry);
        }
      }
      await inspectContents(path);
      const owner = await lstat(path);
      const tombstone = join(dirname(path), `.aperture-forgotten-${randomUUID()}`);
      await rename(path, tombstone);
      validateState(tombstone);
      const current = await lstat(tombstone);
      if (current.dev !== owner.dev || current.ino !== owner.ino) throw invalid();
      await checkProfileMarker(tombstone);
      // rm removes nested symlinks themselves, never their targets. Only this
      // renamed, owned profile is recursive; there is no arbitrary-path fallback.
      await rm(tombstone, { recursive: true });
    } finally { await release(); }
  } finally { await lock.close(); await unlink(lockPath); }
}
function privateFile(stat: Stats): void {
  if (!stat.isFile() || stat.uid !== uid() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1) throw invalid();
}
export async function loadBridgeSettings(): Promise<BridgeSettings | undefined> {
  const path = settingsPath();
  inspectPath(path);
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw invalid(); }
  try {
    const directory = await lstat(dirname(path));
    if (directory.uid !== uid() || (directory.mode & 0o777) !== 0o700) throw invalid();
    const stat = await file.stat();
    privateFile(stat);
    if (stat.size > 64 * 1024) throw invalid();
    return validateBridgeSettings(JSON.parse(await file.readFile("utf8")));
  } catch { throw invalid(); } finally { await file.close(); }
}
export async function saveBridgeSettings(settings: BridgeSettings, options?: { expected: BridgeSettings | undefined }): Promise<void> {
  const data = JSON.stringify(validateBridgeSettings(settings), null, 2) + "\n";
  const path = settingsPath();
  await privateDirectory(dirname(path));
  const lockPath = path + ".lock";
  // Exclusive creation is fail-fast. Never steal a potentially live/stale lock.
  let lock;
  try { lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { throw new Error("Aperture settings are locked; retry after the other writer exits (inspect stale locks manually)"); }
  const temporary = join(dirname(path), `.settings-${randomUUID()}.tmp`);
   let created = false;
   try {
     if (options && JSON.stringify(await loadBridgeSettings()) !== JSON.stringify(options.expected)) {
       throw new Error("Aperture settings changed; reload and explicitly confirm the action again");
     }
    inspectPath(path);
    try { privateFile(await lstat(path)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    created = false;
    const directory = await open(dirname(path), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    try { if (created) await unlink(temporary); }
    finally { await lock.close(); await unlink(lockPath); }
  }
}
export async function createBridgeSocketDir(): Promise<{ directory: string; socketPath: string; cleanup(): Promise<void> }> {
  const parent = realpathSync(tmpdir());
  inspectPath(parent);
  if (Buffer.byteLength(join(parent, "apb-XXXXXX/s")) > 100) throw new Error("Aperture temporary socket path exceeds 100 bytes");
  const directory = await mkdtemp(join(parent, "apb-"));
  const owner = await lstat(directory);
  if (!owner.isDirectory() || owner.isSymbolicLink() || owner.uid !== uid() || (owner.mode & 0o777) !== 0o700) throw invalid();
  const socketPath = join(directory, "s");
  let cleaned = false;
  return { directory, socketPath, async cleanup() {
    if (cleaned) return;
    const current = await lstat(directory);
    if (!current.isDirectory() || current.isSymbolicLink() || current.uid !== uid() || current.dev !== owner.dev || current.ino !== owner.ino) throw invalid();
    try {
      const socket = await lstat(socketPath);
      if (!socket.isSocket() || socket.uid !== uid()) throw invalid();
      await unlink(socketPath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // Never recursively remove unexpected contents, even inside our own directory.
    await rmdir(directory);
    cleaned = true;
  } };
}
