import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import { applyApertureProviders, type ApertureProviderOptions } from "./aperture-providers";
import { loadBridgeSettings } from "./bridge-settings";
import { BRIDGE_FAILURE_CODES } from "./bridge-client";
import { acquireBridgeRuntime, bridgeRuntimeKey, type BridgeRuntimeLease } from "./bridge-runtime";
import { attachBridgeIngress } from "./bridge-ingress";
import {
  ApertureSetupError,
  apertureHost,
  fetchApertureProviders,
} from "./aperture-codex-plugin";

export default (async (_input?: PluginInput, options: Pick<ApertureProviderOptions, "auth"> = {}) => {
  if (process.env.OPENCODE_APERTURE_ENABLE !== "1") return {} satisfies Hooks;
  const debug = process.env.OPENCODE_APERTURE_DEBUG === "1";
  let origin: string | undefined;
  let configured = false;
  let lease: BridgeRuntimeLease | undefined;
  let ingress: Awaited<ReturnType<typeof attachBridgeIngress>> | undefined;
  let activeKey: string | undefined;
  let preparing: Promise<void> | undefined;
  let providerIDs = new Set<string>();
  const lifetime = new AbortController();

  async function release() {
    await ingress?.close();
    ingress = undefined;
    await lease?.release();
    lease = undefined;
    activeKey = undefined;
    preparing = undefined;
    configured = false;
    origin = undefined;
    providerIDs.clear();
  }

  return {
    config: async (config) => {
      let attemptedBridge = false;
      try {
        if (lifetime.signal.aborted) return;
        const settings = await loadBridgeSettings();
        const nextOrigin = apertureHost({ ...process.env,
          APERTURE_HOST: process.env.APERTURE_HOST || process.env.OPENCODE_APERTURE_HOST || (settings?.bridge.enabled ? settings.bridge.gateway : undefined),
        });
        const nextKey = settings?.bridge.enabled ? bridgeRuntimeKey(settings.bridge, nextOrigin) : undefined;
        if (activeKey !== undefined && activeKey !== nextKey) {
          throw new ApertureSetupError("Aperture bridge configuration changed; restart OpenCode to apply it");
        }
        if (settings?.bridge.enabled) {
          if (!nextOrigin.startsWith("https://")) throw new ApertureSetupError("bridge mode requires a trusted HTTPS gateway");
          activeKey = nextKey;
          attemptedBridge = true;
          if (!preparing) preparing = (async () => {
            lease = await acquireBridgeRuntime(settings.bridge, nextOrigin, lifetime.signal);
            if (lifetime.signal.aborted) return;
            ingress = await attachBridgeIngress(lease.session);
          })();
          await preparing;
          if (lifetime.signal.aborted) { await release(); return; }
          const worker = lease?.session;
          if (!worker?.alive() || worker.signal.aborted || !ingress) throw new ApertureSetupError("Aperture bridge unavailable; restart OpenCode after fixing the connection");
          // Validation precedes mutation in the shared model policy; no direct route is published first.
          if (!worker.providers) throw new ApertureSetupError("bridge catalog protocol unavailable; restart OpenCode to load matching plugin and worker builds");
          const result = applyApertureProviders(config, ingress.origin, worker.providers, { auth: options.auth, bridge: true, capability: ingress.capability });
          providerIDs = new Set(result.providerIDs);
          configured = true;
          origin = nextOrigin;
          if (debug) console.error("[opencode-aperture] bridge configured", "providers", providerIDs.size, "models", result.modelCount, "unsupported", result.unsupported.length);
          return;
        }
        const providers = await fetchApertureProviders(nextOrigin);
        if (lifetime.signal.aborted) return;
        const result = applyApertureProviders(config, nextOrigin, providers, { auth: options.auth });
        providerIDs = new Set(result.providerIDs);
        origin = nextOrigin;
        configured = true;
        if (debug) console.error("[opencode-aperture] configured", "providers", providerIDs.size, "models", result.modelCount, "unsupported", result.unsupported.length);
      } catch (error) {
        if (!configured && attemptedBridge) await release().catch(() => {});
        // Non-destructive: route through Aperture when available, otherwise leave
        // native ChatGPT/OpenCode behavior untouched and report the sanitized error.
        const safeBridgeError = error instanceof Error && [
          ...BRIDGE_FAILURE_CODES, "CANCELLED", "CLOSED", "SPAWN_FAILED", "AUTH_CALLBACK_FAILED",
          "WORKER_EXITED", "PIPE_FAILED", "WORKER_EOF", "OUTPUT_LIMIT", "RESTART_REQUIRED",
        ].some(code => error.message === `Aperture bridge: ${code}`);
        const message = error instanceof ApertureSetupError || safeBridgeError ? (error as Error).message
          : error instanceof Error && error.message === "Invalid or unsafe Aperture bridge settings" ? error.message : "Aperture setup failed";
        console.error("[opencode-aperture] leaving provider configuration unchanged:",
          message === "Aperture bridge: RESTART_REQUIRED" ? "Aperture bridge unavailable; restart OpenCode after fixing the connection" : message);
      }
    },
    "chat.headers": async (input, output) => {
      if (!providerIDs.has(input.model.providerID) || !configured) return;
      output.headers["X-Aperture-OpenCode-Plugin"] = "1";
      if (ingress) output.headers["x-aperture-relay-capability"] = ingress.capability;
      if (debug) console.error("[opencode-aperture] inference headers attached");
    },
    dispose: async () => {
      lifetime.abort();
      await preparing?.catch(() => {});
      await release();
    },
  } satisfies Hooks;
}) satisfies Plugin;
