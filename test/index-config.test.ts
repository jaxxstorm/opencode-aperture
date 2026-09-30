import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("refresh can enable a newly saved bridge without restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-index-config-"));
  try {
    const runner = join(root, "runner.ts");
    await writeFile(runner, `
      import { mock } from "bun:test";
      import assert from "node:assert/strict";
      const runtimePath = ${JSON.stringify(resolve(import.meta.dir, "../src/bridge-runtime.ts"))};
      const ingressPath = ${JSON.stringify(resolve(import.meta.dir, "../src/bridge-ingress.ts"))};
      const settingsPath = ${JSON.stringify(resolve(import.meta.dir, "../src/bridge-settings.ts"))};
      const codexPath = ${JSON.stringify(resolve(import.meta.dir, "../src/aperture-codex-plugin.ts"))};
      const indexPath = ${JSON.stringify(resolve(import.meta.dir, "../src/index.ts"))};
      const codex = { ...await import(codexPath) };
      let settings;
      let acquisitions = 0;
      process.env.OPENCODE_APERTURE_ENABLE = "1";
      mock.module(settingsPath, () => ({ loadBridgeSettings: async () => settings }));
      mock.module(runtimePath, () => ({
        bridgeRuntimeKey: (bridge, origin) => \`\${origin}|\${bridge.gateway}|\${bridge.hostname}|\${bridge.enabled}\`,
        acquireBridgeRuntime: async () => {
          acquisitions++;
          const signal = new AbortController().signal;
          return { session: { models: ["gpt-5.5-test"], providers: [{ id: "remote-subscription", models: ["gpt-5.5-test"], requires_client_auth: true, compatibility: { openai_responses: true } }], capability: "aperture-worker-${"a".repeat(64)}",
            socketPath: "/tmp/aperture-test.sock", bun: "1.4.2", signal, alive: () => true,
            refreshModels: async () => ["gpt-5.5-test"], close: async () => {} }, release: async () => {} };
        },
      }));
      mock.module(ingressPath, () => ({ attachBridgeIngress: async () => ({ origin: "http://127.0.0.1:12345", capability: "capability", close: async () => {} }) }));
      mock.module(codexPath, () => {
        return { ...codex,
          fetchApertureProviders: async () => [{ id: "direct", name: "Direct", models: ["direct-model"], compatibility: { openai_responses: true }, requires_client_auth: true }],
        };
      });
      const hooks = await (await import(indexPath)).default();
      const first = {};
      await hooks.config(first);
      assert.equal(first.provider.openai.name, "Aperture (Direct)");
      assert.equal(acquisitions, 0);
      settings = { version: 1, bridge: { enabled: true, gateway: "https://gateway.test", hostname: "test-device",
        stateDir: "/tmp/aperture-test-state", runtime: { mode: "external", executable: process.execPath }, startupTimeoutMs: 1000 } };
      const second = {};
      await hooks.config(second);
      assert.equal(second.provider.openai.name, "Aperture (remote-subscription)");
      assert.deepEqual(Object.keys(second.provider.openai.models), ["gpt-5.5-test"]);
      assert.equal(acquisitions, 1);
      await hooks.dispose?.();
      const gatewayHooks = await (await import(indexPath)).default(undefined, {
        auth: { "remote-subscription": { mode: "gateway" } },
      });
      const gatewayConfig = {};
      await gatewayHooks.config(gatewayConfig);
      assert.equal(gatewayConfig.provider.openai, undefined);
      assert.equal(gatewayConfig.provider["aperture-remote-subscription"].models["gpt-5.5-test"].id, "gpt-5.5-test");
      const managed = { headers: {} };
      await gatewayHooks["chat.headers"]({ model: { providerID: "aperture-remote-subscription" } }, managed);
      assert.equal(managed.headers["X-Aperture-OpenCode-Plugin"], "1");
      assert.equal(managed.headers["x-aperture-relay-capability"], "capability");
      const native = { headers: {} };
      await gatewayHooks["chat.headers"]({ model: { providerID: "openai" } }, native);
      assert.deepEqual(native.headers, {});
      await gatewayHooks.dispose?.();
    `);
    const child = Bun.spawn([process.execPath, runner], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
