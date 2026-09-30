// Synthetic loopback proof only, not a distributed plugin or Tailscale transport.
import type { Plugin } from "@opencode-ai/plugin";
import { join } from "node:path";
import { capabilityHeader, createRelay } from "./relay-core";
import { startTransportProcess, type TransportProcess } from "../../src/transport-process";

export default (async () => {
  const target = new URL(process.env.APERTURE_RELAY_FIXTURE_TARGET ?? process.env.APERTURE_HOST!);
  const capability = `relay-fixture-${crypto.randomUUID()}`;
  let relay: Awaited<ReturnType<typeof createRelay>> | undefined;
  let worker: TransportProcess | undefined;
  const ca = process.env.APERTURE_RELAY_FIXTURE_CA ? await Bun.file(process.env.APERTURE_RELAY_FIXTURE_CA).text() : undefined;
  return {
    async config(config) {
      if (!config.provider?.openai?.options) throw new Error("Run the packaged Aperture plugin before the relay fixture");
      const mode = process.env.APERTURE_RELAY_RUNTIME_MODE;
      if (mode) {
        if (mode !== "external" && mode !== "opencode") throw new Error("Invalid worker runtime mode");
        const executable = mode === "opencode" ? process.execPath : process.env.APERTURE_RELAY_RUNTIME_EXECUTABLE;
        if (!executable) throw new Error("External Bun executable required");
        try {
          worker ??= await startTransportProcess({
            runtime: { mode, executable }, workerPath: join(import.meta.dir, "transport-worker.ts"), timeoutMs: 15_000,
            startup: { target: target.origin, ca, key: await Bun.file(process.env.APERTURE_RELAY_FIXTURE_KEY!).text() },
            onEvent(event) {
              if (event.name === "discovery-complete") console.log("[aperture-relay-fixture] proxied discovery complete");
              if (event.name === "http-accepted") console.log("[aperture-proxy-fixture] http accepted");
              if (event.name === "connect-accepted") console.log("[aperture-proxy-fixture] connect accepted");
              if (event.name === "tunnel-peer-port") console.log(`[aperture-proxy-fixture] tunnel-peer-port=${event.port}`);
              if (event.name === "proxy-listening-port") console.log(`[aperture-proxy-fixture] listening-port=${event.port}`);
              if (event.name === "transport-smoke-complete") console.log("[aperture-worker-fixture] transport smoke complete");
            },
          });
          console.log(`[aperture-worker-fixture] ready bun=${worker.bun}`);
          config.provider.openai.options.baseURL = `${worker.origin}/codex`;
        } catch (error) {
          console.log(error instanceof Error && error.message === "Transport process: unsupported runtime" ? "[aperture-worker-fixture] unsupported runtime" : "[aperture-worker-fixture] setup rejected");
        }
        return;
      }
      relay ??= await createRelay(target, capability, ca, process.env.APERTURE_RELAY_FIXTURE_PROXY === "1");
      config.provider.openai.options.baseURL = `${relay.origin}/codex`;
    },
    async "chat.headers"(input, output) {
      if (input.model.providerID !== "openai") return;
      if (worker?.alive()) output.headers[capabilityHeader] = worker.capability;
      else if (relay) output.headers[capabilityHeader] = capability;
    },
    async dispose() { await relay?.close(); await worker?.close(); },
  };
}) satisfies Plugin;
