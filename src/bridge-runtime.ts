import { fileURLToPath } from "node:url";
import { startBridgeWorker, type BridgeSession } from "./bridge-client";
import { createBridgeSocketDir, resolveBridgeRuntime, type BridgeSettings } from "./bridge-settings";

export type BridgeRuntimeLease = { session: BridgeSession; release(): Promise<void> };

// This identity deliberately includes the environment variable NAME, never its value.
export function bridgeRuntimeKey(bridge: BridgeSettings["bridge"], gateway: string): string {
  return JSON.stringify([gateway, bridge.hostname, bridge.stateDir, resolveBridgeRuntime(bridge.runtime),
    bridge.modulePath ?? null, bridge.authKeyEnv ?? null, bridge.startupTimeoutMs, { catalog: true }]);
}

type Entry = {
  users: number;
  controller: AbortController;
  startup: Promise<BridgeSession>;
  socket?: Awaited<ReturnType<typeof createBridgeSocketDir>>;
  closing?: Promise<void>;
  ready?: boolean;
};
const pool = new Map<string, Entry>();
const cancelled = () => new Error("Aperture bridge: CANCELLED");

export async function acquireBridgeRuntime(
  bridge: BridgeSettings["bridge"], gateway: string, signal?: AbortSignal,
): Promise<BridgeRuntimeLease> {
  if (signal?.aborted) throw cancelled();
  const runtime = resolveBridgeRuntime(bridge.runtime);
  const key = bridgeRuntimeKey({ ...bridge, runtime }, gateway);
  let entry = pool.get(key);
  // Concurrent startup owners share its discovery; later acquisitions need a fresh catalog.
  const refresh = entry?.ready === true;
  if (entry?.closing) throw new Error("Aperture bridge: RESTART_REQUIRED");
  if (!entry) {
    const created: Entry = { users: 0, controller: new AbortController(), startup: undefined! };
    created.startup = (async () => {
      try {
        created.socket = await createBridgeSocketDir();
        const session = await startBridgeWorker({ runtime,
          workerPath: fileURLToPath(new URL("./bridge-worker.js", import.meta.url)),
          signal: created.controller.signal,
          start: { action: "connect", catalog: true, gateway, hostname: bridge.hostname, stateDir: bridge.stateDir,
            modulePath: bridge.modulePath, authKey: bridge.authKeyEnv ? process.env[bridge.authKeyEnv] : undefined,
            timeoutMs: bridge.startupTimeoutMs, socketPath: created.socket.socketPath },
        });
        created.ready = true;
        return session;
      } catch (error) {
        // startBridgeWorker waits for the failed helper to close before rejecting.
        await created.socket?.cleanup();
        throw error;
      }
    })();
    pool.set(key, created);
    entry = created;
  }
  const owned = entry;
  owned.users++;
  let released: Promise<void> | undefined;
  function release(): Promise<void> {
    if (released) return released;
    if (--owned.users > 0) return released = Promise.resolve();
    owned.controller.abort();
    owned.closing = (async () => {
      const session = await owned.startup.catch(() => undefined);
      await session?.close();
      await owned.socket?.cleanup();
      // Keep a failed cleanup tombstone rather than overlap a possibly live helper.
      if (pool.get(key) === owned) pool.delete(key);
    })();
    return released = owned.closing;
  }
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => {
      // Drop this reference before awaiting startup, without cancelling other owners.
      void release().catch(() => {});
      reject(cancelled());
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  try {
    const session = await Promise.race([owned.startup, aborted]);
    if (signal?.aborted) throw cancelled();
    if (!session.alive() || session.signal.aborted) throw new Error("Aperture bridge: RESTART_REQUIRED");
    if (refresh) await Promise.race([session.refreshModels(), aborted]);
    if (signal?.aborted) throw cancelled();
    if (!session.alive() || session.signal.aborted) throw new Error("Aperture bridge: RESTART_REQUIRED");
    return { session, release };
  } catch (error) {
    await release();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
