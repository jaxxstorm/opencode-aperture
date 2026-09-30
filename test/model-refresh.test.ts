import { expect, test } from "bun:test";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { refreshApertureModels } from "../src/model-refresh";

function harness() {
  const controller = new AbortController();
  const lifecycle = new AbortController();
  const provider = { id: "openai", name: "Aperture (Tailscale)", models: { test: { id: "test", name: "New title" } } };
  let listener: ((event: { properties: { directory: string } }) => void) | undefined;
  let subscriptions = 0;
  let status: unknown = {};
  let catalog: unknown = { providers: [provider] };
  const calls: string[] = [];
  const state = { ready: true, path: { directory: "/local" }, provider: [structuredClone(provider)] };
  const check = (scope: unknown, options: { throwOnError: boolean; signal: AbortSignal }) => {
    expect(scope).toEqual({ directory: "/local" });
    expect(options.throwOnError).toBe(true);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  };
  const sdk = {
    session: { status: async (scope: unknown, options: any) => { check(scope, options); calls.push("status"); return { data: status }; } },
    instance: { dispose: async (scope: unknown, options: any) => { check(scope, options); calls.push("dispose"); listener?.({ properties: { directory: "/local" } }); return { data: true }; } },
    config: { providers: async (scope: unknown, options: any) => { check(scope, options); calls.push("providers"); return { data: catalog }; } },
  };
  const api = { client: sdk, state, lifecycle: { signal: lifecycle.signal }, event: {
    on(type: string, handler: typeof listener) {
      expect(type).toBe("server.instance.disposed");
      listener = handler; subscriptions++;
      return () => { listener = undefined; subscriptions--; };
    },
  } } as unknown as TuiPluginApi;
  return { api, sdk, state, provider, calls, controller, lifecycle,
    setStatus: (value: unknown) => { status = value; }, setCatalog: (value: unknown) => { catalog = value; },
    emit: (directory: string) => listener?.({ properties: { directory } }),
    subscriptions: () => subscriptions,
    run: (timeoutMs = 200) => refreshApertureModels(api, { signal: controller.signal, timeoutMs }),
  };
}

test("refresh uses scoped SDK data and catches an event emitted before dispose returns", async () => {
  const h = harness();
  expect(await h.run()).toEqual({ status: "ready", count: 1 });
  expect(h.calls).toEqual(["status", "dispose", "providers"]);
  expect(h.subscriptions()).toBe(0);
});

test.each([undefined, null, [], { x: {} }, { x: { type: "unknown" } }, { x: null }])("unknown status fails closed: %j", async status => {
  const h = harness(); h.setStatus(status);
  expect(await h.run()).toEqual({ status: "failure", reason: "status" });
  expect(h.calls).toEqual(["status"]);
});

test.each(["busy", "retry"])("%s never disposes or aborts requests", async type => {
  const h = harness(); h.setStatus({ x: { type } });
  expect(await h.run()).toEqual({ status: "busy" });
  expect(h.calls).toEqual(["status"]);
});

test("only the captured directory event allows catalog retrieval", async () => {
  const h = harness();
  h.sdk.instance.dispose = async () => { h.calls.push("dispose"); h.emit("/other"); return { data: true }; };
  const task = h.run();
  await Bun.sleep(10);
  expect(h.calls).toEqual(["status", "dispose"]);
  h.emit("/local");
  expect(await task).toEqual({ status: "ready", count: 1 });
  expect(h.subscriptions()).toBe(0);
});

test.each([undefined, { providers: [] }, { providers: [{ id: "openai", name: "OpenAI", models: { native: { id: "native", name: "Native" } } }] },
  { providers: [{ id: "openai", name: "Aperture (Tailscale)", models: {} }] }])("missing Aperture catalog cannot succeed: %j", async catalog => {
  const h = harness(); h.setCatalog(catalog);
  expect(await h.run()).toEqual({ status: "failure", reason: "catalog" });
  expect(h.subscriptions()).toBe(0);
});

test("catalog readiness does not require a fresh TUI state snapshot", async () => {
  const h = harness(); h.state.provider = [];
  expect(await h.run()).toEqual({ status: "ready", count: 1 });
  expect(h.subscriptions()).toBe(0);
});

test("refresh counts all namespaced gateway providers without requiring native OpenAI", async () => {
  const h = harness();
  h.setCatalog({ providers: [
    { id: "aperture-anthropic", name: "Aperture (Anthropic)", models: { claude: { id: "claude", name: "Claude" } } },
    { id: "aperture-openai", name: "Aperture (OpenAI)", models: { gpt: { id: "gpt", name: "GPT" } } },
    { id: "openai", name: "OpenAI", models: { native: { id: "native", name: "Native" } } },
  ] });
  expect(await h.run()).toEqual({ status: "ready", count: 2 });
});

test.each(["status", "dispose", "event", "providers"])("deadline bounds %s even when an API ignores its signal", async stage => {
  const h = harness();
  if (stage === "status") h.sdk.session.status = () => new Promise(() => {});
  if (stage === "dispose") h.sdk.instance.dispose = () => new Promise(() => {});
  if (stage === "event") h.sdk.instance.dispose = async () => ({ data: true });
  if (stage === "providers") h.sdk.config.providers = () => new Promise(() => {});
  expect(await h.run(15)).toEqual({ status: "failure", reason: "timeout", stage: ({ status: "session-status", dispose: "reload", event: "reload-event", providers: "catalog" } as const)[stage] });
  expect(h.subscriptions()).toBe(0);
});

test.each(["caller", "lifecycle"])("%s cancellation cleans subscriptions", async source => {
  const h = harness(); h.sdk.config.providers = () => new Promise(() => {});
  const task = h.run();
  await Bun.sleep(5);
  (source === "caller" ? h.controller : h.lifecycle).abort();
  expect(await task).toEqual({ status: "failure", reason: "cancelled", stage: "catalog" });
  expect(h.subscriptions()).toBe(0);
});

test("pre-aborted operation makes no API calls", async () => {
  const h = harness(); h.controller.abort();
  expect(await h.run()).toEqual({ status: "failure", reason: "cancelled", stage: "session-status" });
  expect(h.calls).toEqual([]);
});

test("SDK exceptions are sanitized and dispose is never retried", async () => {
  const h = harness();
  h.sdk.instance.dispose = async () => { h.calls.push("dispose"); throw new Error("private-secret-response"); };
  expect(await h.run()).toEqual({ status: "failure", reason: "unavailable", stage: "reload" });
  expect(h.calls).toEqual(["status", "dispose"]);
  expect(h.subscriptions()).toBe(0);
});

test("unknown or changed directory fails safely", async () => {
  const h = harness(); h.state.path.directory = "";
  expect(await h.run()).toEqual({ status: "failure", reason: "scope" });
  expect(h.calls).toEqual([]);
  h.state.path.directory = "/local";
  h.sdk.session.status = async () => { h.state.path.directory = "/other"; return { data: {} }; };
  expect(await h.run()).toEqual({ status: "failure", reason: "scope" });
});
