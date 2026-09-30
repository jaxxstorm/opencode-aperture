import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Config } from "@opencode-ai/plugin";
import type { ProviderInfo } from "../src/aperture-codex-plugin";
import { applyApertureProviders, type ApertureProviderOptions } from "../src/aperture-providers";

const origin = "https://aperture.test";
const catalog: ProviderInfo[] = [
  { id: "openai", name: "OpenAI", models: ["gpt-5"], compatibility: { openai_responses: true, openai_chat: true } },
  { id: "anthropic", models: ["claude-sonnet-4"], compatibility: { anthropic: true } },
  { id: "bedrock", models: ["us.anthropic.claude-sonnet-4-v1:0"], compatibility: { bedrock: true } },
  { id: "gemini", models: ["gemini-2.5-pro"], compatibility: { gemini_generate_content: true } },
  { id: "vercel", models: ["anthropic/claude-sonnet-4", "openai/gpt-5", "meta/llama-4"],
    compatibility: { openai_responses: true, openai_chat: true, anthropic: true } },
  { id: "openrouter", models: ["meta/llama-4"], compatibility: { openai_chat: true } },
  { id: "ollama", models: ["qwen3"], compatibility: { openai_chat: true } },
  { id: "xai", models: ["grok-4"], compatibility: { openai_chat: true } },
];
const fetchOriginal = globalThis.fetch;
const keyOriginal = process.env.APERTURE_TEST_PROVIDER_KEY;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (keyOriginal === undefined) delete process.env.APERTURE_TEST_PROVIDER_KEY;
  else process.env.APERTURE_TEST_PROVIDER_KEY = keyOriginal;
});

describe("applyApertureProviders", () => {
  test("eight-provider remote schema defaults to gateway and preserves native auth/config", () => {
    const native = { options: { apiKey: "native-secret", headers: { authorization: "native-auth" } } };
    const config: Config = { provider: { openai: native, anthropic: native }, model: "anthropic/local", small_model: "openai/small" };
    const result = applyApertureProviders(config, origin, catalog, { bridge: true, capability: "ephemeral" });
    expect(result).toEqual({ providerIDs: ["aperture-openai", "aperture-anthropic", "aperture-bedrock", "aperture-gemini",
      "aperture-vercel:messages", "aperture-vercel:responses", "aperture-vercel:chat", "aperture-openrouter", "aperture-ollama", "aperture-xai"],
      modelCount: 10, subscription: false, unsupported: [] });
    expect(config.model).toBe("anthropic/local");
    expect(config.small_model).toBe("openai/small");
    expect(config.provider!.openai).toBe(native);
    expect(config.provider!.anthropic).toBe(native);
    for (const id of result.providerIDs) {
      const provider = config.provider![id];
      expect(provider.name).toStartWith("Aperture (");
      expect(provider.env).toEqual([]);
      expect(provider.options!.headers).toBeUndefined();
      expect(JSON.stringify(config)).not.toContain("ephemeral");
      expect(JSON.stringify(provider)).not.toContain("native-secret");
      for (const model of Object.values(provider.models!)) expect(model.limit).toEqual({ context: 128000, output: 8192 });
    }
    expect(config.provider!["aperture-openai"].npm).toBe("@ai-sdk/openai");
    expect(config.provider!["aperture-openai"].models!["gpt-5"].id).toBe("gpt-5");
    expect(config.provider!["aperture-vercel:messages"].npm).toBe("@ai-sdk/anthropic");
    expect(config.provider!["aperture-vercel:messages"].models!["anthropic/claude-sonnet-4"].id).toBe("anthropic/claude-sonnet-4");
    expect(config.provider!["aperture-vercel:responses"].npm).toBe("@ai-sdk/openai");
    expect(config.provider!["aperture-vercel:chat"].npm).toBe("@ai-sdk/openai-compatible");
    expect(config.provider!["aperture-bedrock"].options).toMatchObject({ baseURL: `${origin}/gateway/bedrock`,
      apiKey: "", accessKeyId: "aperture-managed", secretAccessKey: "aperture-managed", sessionToken: "", region: "us-east-1" });
    expect(config.provider!["aperture-bedrock"].models![catalog[2].models[0]].id).toBe(catalog[2].models[0]);
    expect(config.provider!["aperture-gemini"].options!.baseURL).toBe(`${origin}/gateway/v1beta`);
    expect(config.provider!["aperture-gemini"].models!["gemini-2.5-pro"].id).toBe("gemini-2.5-pro");
  });

  test("preserves model metadata, overrides, defaults and all allow/deny lists", () => {
    const config: Config = {
      enabled_providers: ["aperture-openai", "anthropic"], disabled_providers: ["aperture-xai"],
      provider: {
        openai: { models: { "gpt-5": { limit: { context: 200000, output: 16000 }, reasoning: true,
          options: { secret: "native-only" }, headers: { Authorization: "native-only" } } } },
        "aperture-openai": { blacklist: ["blocked"], whitelist: ["gpt-5", "blocked"],
          models: { "gpt-5": { name: "My model", limit: { context: 250000, output: 32000 }, options: { temperature: 0.1 } } } },
      },
    };
    const before = structuredClone(config);
    const result = applyApertureProviders(config, origin, [{ ...catalog[0], models: ["gpt-5", "blocked", "other", "gpt-5"] }, catalog[7]]);
    expect(result.modelCount).toBe(1);
    expect(config.model).toBeUndefined();
    expect(config.enabled_providers).toEqual(before.enabled_providers);
    expect(config.disabled_providers).toEqual(before.disabled_providers);
    expect(config.provider!.openai).toEqual(before.provider!.openai);
    expect(config.provider!["aperture-openai"].blacklist).toEqual(["blocked"]);
    expect(config.provider!["aperture-openai"].whitelist).toEqual(["gpt-5", "blocked"]);
    expect(config.provider!["aperture-openai"].models).toEqual({ "gpt-5": { id: "gpt-5", name: "My model",
      reasoning: true, limit: { context: 250000, output: 32000 }, options: { temperature: 0.1 } } });
  });

  test("native OAuth is gated by explicit subscription or requires_client_auth", () => {
    for (const explicit of [false, true]) {
      const config: Config = { provider: { anthropic: { name: "Untouched" } } };
      const result = applyApertureProviders(config, origin, [{ ...catalog[0], requires_client_auth: !explicit }],
        { capability: "relay", ...(explicit ? { auth: { openai: { mode: "subscription" as const } } } : {}) });
      expect(result).toEqual({ providerIDs: ["openai"], modelCount: 1, subscription: true, unsupported: [] });
      expect(config.provider!.openai.options).toMatchObject({ baseURL: `${origin}/codex` });
      expect(config.provider!.openai.options!.headers).toBeUndefined();
      expect(JSON.stringify(config)).not.toContain("relay");
      expect(config.provider!.openai.models!["gpt-5"].id).toBe("gpt-5");
      expect(config.provider!.openai.options!.fetch).toBeUndefined();
      expect(config.provider!.anthropic).toEqual({ name: "Untouched" });
    }
    const config: Config = {};
    expect(applyApertureProviders(config, origin, [{ ...catalog[0], requires_client_auth: true }],
      { auth: { openai: { mode: "gateway" } } }).subscription).toBe(false);
    expect(config.provider!.openai).toBeUndefined();
  });

  test("ambiguous subscriptions fail atomically, rather than picking the first", () => {
    const config: Config = { model: "anthropic/local", provider: { openai: { options: { apiKey: "keep" } } } };
    const originalProvider = config.provider;
    const before = structuredClone(config);
    expect(() => applyApertureProviders(config, origin, [catalog[1],
      { ...catalog[0], requires_client_auth: true }, { ...catalog[0], id: "other", requires_client_auth: true }])).toThrow("select exactly one");
    expect(config).toEqual(before);
    expect(config.provider).toBe(originalProvider);
  });

  test("native helper validation also happens before mutation", () => {
    const config: Config = { model: "openai/unavailable" };
    expect(() => applyApertureProviders(config, origin, [catalog[1], { ...catalog[0], requires_client_auth: true }])).toThrow("selected OpenAI model");
    expect(config).toEqual({ model: "openai/unavailable" });
  });

  test("disabled native subscriptions are not enabled or made default", () => {
    const config: Config = { disabled_providers: ["openai"] };
    expect(applyApertureProviders(config, origin, [{ ...catalog[0], requires_client_auth: true }]).providerIDs).toEqual([]);
    expect(config).toEqual({ disabled_providers: ["openai"] });
  });

  test("non-Responses client auth is unsupported without blocking gateway providers", () => {
    const config: Config = {};
    const result = applyApertureProviders(config, origin, [
      { ...catalog[1], requires_client_auth: true }, catalog[3],
    ]);
    expect(result.providerIDs).toEqual(["aperture-gemini"]);
    expect(result.subscription).toBe(false);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toContain("anthropic: client authentication required");
    expect(result.unsupported[0]).toContain("explicit gateway or API-key passthrough");
    expect(config.provider!.openai).toBeUndefined();
    expect(config.provider!["aperture-anthropic"]).toBeUndefined();
    expect(applyApertureProviders({}, origin, [{ ...catalog[1], requires_client_auth: true }], {
      auth: { anthropic: { mode: "gateway" } },
    }).providerIDs).toEqual(["aperture-anthropic"]);
  });

  test("auth options are validated at runtime before mutation", () => {
    const invalid = [null, [], "gateway", { openai: null }, { openai: [] }, { openai: {} },
      { openai: { mode: "Gateway" } }, { openai: { mode: "unknown" } }, { openai: { mode: 1 } },
      { openai: { mode: "gateway", protocol: "__proto__" } }, { openai: { mode: "gateway", protocol: null } },
      { openai: { mode: "passthrough", apiKeyEnv: 123 } }];
    for (const auth of invalid) {
      const config: Config = { model: "anthropic/local" };
      expect(() => applyApertureProviders(config, origin, [catalog[1], catalog[0]], {
        auth: auth as ApertureProviderOptions["auth"],
      })).toThrow();
      expect(config).toEqual({ model: "anthropic/local" });
    }
  });

  test("Gemini's legacy flag remains supported and shares ambiguity checks with the actual flag", () => {
    const legacy = { ...catalog[3], id: "legacy", compatibility: { gemini: true } };
    expect(applyApertureProviders({}, origin, [legacy]).providerIDs).toEqual(["aperture-legacy"]);
    const result = applyApertureProviders({}, origin, [legacy, catalog[3]]);
    expect(result.providerIDs).toEqual([]);
    expect(result.unsupported).toHaveLength(2);
  });

  test("explicit protocol must be advertised, not a conversion request", () => {
    const config: Config = {};
    expect(() => applyApertureProviders(config, origin, [catalog[1]], { auth: { anthropic: { mode: "gateway", protocol: "bedrock" } } })).toThrow("not advertised");
    expect(config).toEqual({});
    applyApertureProviders(config, origin, [catalog[0]], { auth: { openai: { mode: "gateway", protocol: "chat" } } });
    expect(config.provider!["aperture-openai"].npm).toBe("@ai-sdk/openai-compatible");
  });

  test("path-based ambiguity considers even disabled remote instances", () => {
    for (const remote of [catalog[2], catalog[3]]) {
      const config: Config = { disabled_providers: ["aperture-duplicate"] };
      const result = applyApertureProviders(config, origin, [remote, { ...remote, id: "duplicate" }]);
      expect(result.providerIDs).toEqual([]);
      expect(result.unsupported).toHaveLength(2);
      expect(result.unsupported[0]).toContain("ambiguous");
      expect(config.provider).toBeUndefined();
    }
  });

  test("body APIs keep bare SDK IDs and qualify identical models by remote instance only on the wire", async () => {
    const config: Config = {};
    applyApertureProviders(config, origin, [catalog[0], { ...catalog[0], id: "second" }]);
    const captured: Request[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => { captured.push(input as Request); return new Response("ok"); }) as unknown as typeof fetch;
    for (const id of ["openai", "second"]) {
      const provider = config.provider![`aperture-${id}`];
      expect(provider.models!["gpt-5"].id).toBe("gpt-5");
      await (provider.options!.fetch as typeof fetch)(`${provider.options!.baseURL}/responses`, {
        method: "POST", body: JSON.stringify({ model: "gpt-5" }),
      });
      expect((await captured.at(-1)!.json()).model).toBe(`${id}/gpt-5`);
    }
  });

  test.each([false, true])("body qualification preserves request semantics and original bodies (bridge=%s)", async bridge => {
    const config: Config = {};
    const remotes = [catalog[0], catalog[1], catalog[4]];
    const result = applyApertureProviders(config, origin, remotes, { bridge });
    const captured: Request[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => { captured.push(input as Request); return new Response("ok"); }) as unknown as typeof fetch;
    for (const id of result.providerIDs) {
      const provider = config.provider![id];
      const remoteID = id.slice("aperture-".length).split(":")[0];
      const model = Object.keys(provider.models!)[0];
      const suffix = provider.npm === "@ai-sdk/openai" ? "/responses" : provider.npm === "@ai-sdk/anthropic" ? "/messages" : "/chat/completions";
      const payload = { model, stream: true, input: [{ role: "developer", content: "unchanged" }] };
      const body = JSON.stringify(payload);
      const controller = new AbortController();
      const headers = { "content-type": "application/json", "content-length": String(body.length), "x-custom": "preserved" };
      const request = new Request(`${provider.options!.baseURL}${suffix}`, {
        method: "POST", body, headers, signal: controller.signal, redirect: "follow",
      });
      const requestFetch = provider.options!.fetch as typeof fetch;
      await requestFetch(request);
      const sent = captured.at(-1)!;
      expect(sent.url).toBe(request.url);
      expect(sent.method).toBe("POST");
      expect(sent.redirect).toBe("error");
      expect(sent.headers.get("content-length")).toBeNull();
      expect(sent.headers.get("content-type")).toBe("application/json");
      expect(sent.headers.get("x-custom")).toBe("preserved");
      expect(await sent.json()).toEqual({ ...payload, model: `${remoteID}/${model}` });
      expect(await request.text()).toBe(body);
      expect(request.headers.get("content-length")).toBe(String(body.length));
      expect(payload.model).toBe(model);
      controller.abort("test cancellation");
      expect(sent.signal.aborted).toBe(true);
      expect(sent.signal.reason).toBe("test cancellation");
      const init = { method: "POST", body, headers };
      await requestFetch(request.url, init);
      expect(init).toEqual({ method: "POST", body, headers });
      expect((await captured.at(-1)!.json()).model).toBe(`${remoteID}/${model}`);
    }
  });

  test("body qualification rejects invalid JSON, excluded models, and other protocol groups before network", async () => {
    const config: Config = { provider: { "aperture-openai": { blacklist: ["blocked"] } } };
    applyApertureProviders(config, origin, [{ ...catalog[0], models: ["gpt-5", "blocked"] }, catalog[4]]);
    const network = mock(async () => new Response("unexpected"));
    globalThis.fetch = network as unknown as typeof fetch;
    const provider = config.provider!["aperture-openai"];
    const invalid = ["not-json", "null", "[]", "{}", '{"model":42}', '{"model":"unknown"}',
      '{"model":"blocked"}', '{"model":"__proto__"}', '{"model":"constructor"}', '{"model":"openai/gpt-5"}'];
    for (const body of invalid) {
      await expect((provider.options!.fetch as typeof fetch)(`${provider.options!.baseURL}/responses`, {
        method: "POST", body,
      })).rejects.toThrow();
    }
    const messages = config.provider!["aperture-vercel:messages"];
    await expect((messages.options!.fetch as typeof fetch)(`${messages.options!.baseURL}/messages`, {
      method: "POST", body: JSON.stringify({ model: "openai/gpt-5" }),
    })).rejects.toThrow("outside the allowed provider catalog");
    expect(network).not.toHaveBeenCalled();
  });

  test("bare model ID overrides are preserved but aliases and qualified IDs fail atomically", () => {
    const config: Config = { provider: { "aperture-openai": { models: { "gpt-5": { id: "gpt-5" } } } } };
    applyApertureProviders(config, origin, [catalog[0]]);
    expect(config.provider!["aperture-openai"].models!["gpt-5"].id).toBe("gpt-5");
    for (const id of ["alias", "openai/gpt-5", ""]) {
      const conflicting: Config = { provider: { "aperture-openai": { models: { "gpt-5": { id } } } } };
      const before = structuredClone(conflicting);
      expect(() => applyApertureProviders(conflicting, origin, [catalog[1], catalog[0]])).toThrow("model routing collision");
      expect(conflicting).toEqual(before);
    }
  });

  test("unsafe path model IDs are unsupported, and ambiguous Gemini resource paths fail atomically", () => {
    expect(applyApertureProviders({}, origin, [{ ...catalog[2], models: ["../model", "model?key=bad"] }]).unsupported).toHaveLength(2);
    const config: Config = {};
    expect(() => applyApertureProviders(config, origin, [{ ...catalog[3], models: ["gemini-pro", "models/gemini-pro"] }])).toThrow("ambiguous Gemini SDK");
    expect(config).toEqual({});
  });

  test("encoded IDs and protocol variant IDs cannot collide", () => {
    const config: Config = {};
    const ids = ["a/b", "a%2Fb", "__proto__", "vercel:chat"];
    const result = applyApertureProviders(config, origin, [...ids.map(id => ({ ...catalog[0], id })), catalog[4]]);
    for (const id of ids) expect(result.providerIDs).toContain(`aperture-${encodeURIComponent(id)}`);
    expect(result.providerIDs).toContain("aperture-vercel:chat");
    expect(new Set(result.providerIDs).size).toBe(result.providerIDs.length);
    expect(Object.getPrototypeOf(config.provider)).toBe(Object.prototype);
  });

  test.each(["__proto__", "constructor", "prototype", " "])("rejects unsafe model key %s atomically", model => {
    const config: Config = {};
    expect(() => applyApertureProviders(config, origin, [catalog[0], { ...catalog[1], models: [model] }])).toThrow("model key");
    expect(config).toEqual({});
  });

  test("duplicate remote IDs and existing routing collisions fail atomically", () => {
    const config: Config = { provider: { "aperture-openai": { npm: "@ai-sdk/anthropic" } } };
    const before = structuredClone(config);
    expect(() => applyApertureProviders(config, origin, [catalog[0], catalog[0]])).toThrow("unique");
    expect(() => applyApertureProviders(config, origin, [catalog[1], catalog[0]])).toThrow("collision");
    expect(config).toEqual(before);
  });

  test("unsupported providers do not silently become chat-compatible", () => {
    const config: Config = {};
    expect(applyApertureProviders(config, origin, [{ id: "unknown", models: ["m"], compatibility: {} }])).toEqual({
      providerIDs: [], modelCount: 0, subscription: false, unsupported: ["unknown/m: no supported inference protocol"],
    });
    expect(config).toEqual({});
  });

  test.each([undefined, "BAD-NAME", "APERTURE_TEST_PROVIDER_KEY"])("passthrough rejects absent or invalid env %s", apiKeyEnv => {
    delete process.env.APERTURE_TEST_PROVIDER_KEY;
    const config: Config = {};
    expect(() => applyApertureProviders(config, origin, [catalog[0]], { auth: { openai: { mode: "passthrough", apiKeyEnv } } })).toThrow("apiKeyEnv");
    expect(config).toEqual({});
  });

  test("Bedrock passthrough and non-Responses subscription fail clearly", () => {
    process.env.APERTURE_TEST_PROVIDER_KEY = "synthetic";
    expect(() => applyApertureProviders({}, origin, [catalog[2]], { auth: { bedrock: {
      mode: "passthrough", apiKeyEnv: "APERTURE_TEST_PROVIDER_KEY" } } })).toThrow("SigV4 passthrough is unsupported");
    expect(() => applyApertureProviders({}, origin, [catalog[1]], {
      auth: { anthropic: { mode: "subscription" } },
    })).toThrow("subscription requires Responses");
  });

  test("passthrough uses only the explicitly named runtime key and /forward", async () => {
    process.env.APERTURE_TEST_PROVIDER_KEY = "explicit-synthetic-key";
    const config: Config = { provider: { openai: { options: { apiKey: "native-do-not-copy" } } } };
    applyApertureProviders(config, origin, [catalog[0], catalog[1]], { bridge: true, auth: { openai: {
      mode: "passthrough", apiKeyEnv: "APERTURE_TEST_PROVIDER_KEY" } } });
    const provider = config.provider!["aperture-openai"];
    expect(provider.options!.apiKey).toBe("aperture-managed");
    expect(JSON.stringify(config)).not.toContain("explicit-synthetic-key");
    expect(provider.options!.baseURL).toBe(`${origin}/forward/v1`);
    expect(config.provider!["aperture-anthropic"].options!.apiKey).toBe("aperture-managed");
    const captured: Request[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => { captured.push(input as Request); return new Response("ok"); }) as unknown as typeof fetch;
    await (provider.options!.fetch as typeof fetch)(`${provider.options!.baseURL}/responses?key=unrelated`, {
      method: "POST", headers: { Authorization: "Bearer unrelated", "x-api-key": "unrelated", Cookie: "unrelated" },
      body: JSON.stringify({ model: "gpt-5" }),
    });
    expect(captured[0].headers.get("authorization")).toBe("Bearer explicit-synthetic-key");
    expect(captured[0].headers.get("x-api-key")).toBeNull();
    expect(captured[0].headers.get("cookie")).toBeNull();
    expect(new URL(captured[0].url).search).toBe("");
    expect(captured[0].redirect).toBe("error");
  });

  test.each([false, true])("config API serialization excludes generated secrets in all auth modes (bridge=%s)", async bridge => {
    const secret = "synthetic-passthrough-secret-not-for-config-api";
    const capability = "synthetic-relay-capability-not-for-config-api";
    process.env.APERTURE_TEST_PROVIDER_KEY = secret;
    const config: Config = {};
    const remotes = [catalog[0], catalog[1], catalog[3], catalog[7]];
    const result = applyApertureProviders(config, origin, [...remotes, catalog[2], {
      ...catalog[0], id: "subscription", requires_client_auth: true,
    }], { bridge, capability, auth: Object.fromEntries(remotes.map(provider => [provider.id, {
      mode: "passthrough", apiKeyEnv: "APERTURE_TEST_PROVIDER_KEY",
    }])) });
    expect(result.providerIDs).toContain("openai");
    expect(result.subscription).toBe(true);
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(capability);
    expect(serialized).not.toContain("x-aperture-relay-capability");
    expect(await Response.json(config).json()).toEqual(JSON.parse(serialized));
    // The runtime closure retains only the explicitly selected key, independent
    // of later environment changes; SDK config contains a non-secret sentinel.
    delete process.env.APERTURE_TEST_PROVIDER_KEY;
    const captured: Request[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => { captured.push(input as Request); return new Response("ok"); }) as unknown as typeof fetch;
    for (const remote of remotes) {
      const provider = config.provider![`aperture-${remote.id}`];
      expect(provider.options!.apiKey).toBe("aperture-managed");
      const suffix = remote.id === "gemini" ? "/models/gemini-2.5-pro:generateContent" :
        remote.id === "anthropic" ? "/messages" : remote.id === "openai" ? "/responses" : "/chat/completions";
      await (provider.options!.fetch as typeof fetch)(`${provider.options!.baseURL}${suffix}`, {
        method: "POST", headers: { Authorization: "Bearer aperture-managed" },
        body: JSON.stringify({ model: remote.models[0] }),
      });
      const headers = captured.at(-1)!.headers;
      const authHeader = remote.id === "gemini" ? "x-goog-api-key" : remote.id === "anthropic" ? "x-api-key" : "authorization";
      expect(headers.get(authHeader)).toBe(authHeader === "authorization" ? `Bearer ${secret}` : secret);
      expect(headers.get("x-aperture-relay-capability")).toBe(capability);
    }
    expect(JSON.stringify(config)).toBe(serialized);
  });

  test("existing user headers are preserved without adding capability to config", () => {
    const headers = { Authorization: "user-provided-existing-auth", "x-custom": "keep" };
    const config: Config = { provider: { "aperture-anthropic": { options: { headers } }, openai: { options: { headers } } } };
    applyApertureProviders(config, origin, [catalog[1], { ...catalog[0], requires_client_auth: true }], { capability: "private-capability" });
    expect(config.provider!["aperture-anthropic"].options!.headers).toEqual(headers);
    expect(config.provider!.openai.options!.headers).toEqual(headers);
    expect(JSON.stringify(config)).not.toContain("private-capability");
  });

  test.each([false, true])("managed fetch strips auth and query keys, preserves inference body and SSE query (bridge=%s)", async bridge => {
    const config: Config = {};
    applyApertureProviders(config, origin, [catalog[3]], { bridge, capability: "relay-capability" });
    const provider = config.provider!["aperture-gemini"];
    const captured: Request[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => { captured.push(input as Request); return new Response("ok"); }) as unknown as typeof fetch;
    const request = new Request(`${provider.options!.baseURL}/models/gemini-2.5-pro:streamGenerateContent?key=dummy&KEY=dummy&alt=sse`, {
      method: "POST", body: '{"contents":[]}', headers: { Authorization: "Bearer dummy", "x-api-key": "dummy", "x-goog-api-key": "dummy",
        "x-amz-security-token": "ambient", Cookie: "ambient", "Content-Type": "application/json",
        "ChatGPT-Account-ID": "native-account", Originator: "native-client", "Session-ID": "native-session",
        session_id: "native-session", "x-session-id": "native-session", "conversation-id": "native-conversation",
        "x-codex-turn-metadata": "native-turn" },
    });
    const requestFetch = provider.options!.fetch as typeof fetch;
    await requestFetch(request);
    const sent = captured[0];
    expect(sent.url).toBe(`${provider.options!.baseURL}/models/gemini-2.5-pro:streamGenerateContent?alt=sse`);
    expect([...sent.headers.keys()].sort()).toEqual(["content-type", "x-aperture-relay-capability"]);
    expect(sent.headers.get("x-aperture-relay-capability")).toBe("relay-capability");
    expect(await sent.text()).toBe('{"contents":[]}');
    expect(sent.redirect).toBe("error");
    expect(request.headers.get("authorization")).toBe("Bearer dummy");
    await expect(requestFetch("https://elsewhere.test/v1beta/models/m:generateContent")).rejects.toThrow("trusted Aperture");
    await expect(requestFetch(`${origin}/api/providers`)).rejects.toThrow("trusted Aperture");
    expect(captured).toHaveLength(1);
  });
});

// Optional offline SDK probe. Install the exact SDKs bundled by OpenCode 1.18.29
// outside the checkout and point APERTURE_SDK_TEST_DIR at that node_modules.
// All inference is intercepted; no auth files or live gateways are accessed.
test.skipIf(!process.env.APERTURE_SDK_TEST_DIR)("pinned OpenAI SDK gpt-5 reasoning matches bare-ID behavior before wire qualification", async () => {
  const { createOpenAI } = await import(`${process.env.APERTURE_SDK_TEST_DIR}/@ai-sdk/openai/dist/index.mjs`);
  const captured: Request[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push(new Request(input, init));
    return Response.json({ error: { message: "synthetic stop" } }, { status: 400 });
  }) as unknown as typeof fetch;
  const inference = {
    prompt: [{ role: "system", content: "Reason carefully." },
      { role: "user", content: [{ type: "text", text: "offline reasoning probe" }] }],
    temperature: 0.7, maxOutputTokens: 64,
    providerOptions: { openai: { reasoningEffort: "high", store: false } },
  };
  for (const streaming of [false, true]) {
    const method = streaming ? "doStream" : "doGenerate";
    const bare = createOpenAI({ apiKey: "synthetic", baseURL: `${origin}/baseline/v1`, fetch: globalThis.fetch });
    await expect(bare.languageModel("gpt-5")[method](inference)).rejects.toThrow();
    const baseline = await captured.at(-1)!.json();
    expect(baseline.model).toBe("gpt-5");
    expect(baseline.reasoning.effort).toBe("high");
    expect(baseline.input[0].role).toBe("developer");
    expect(baseline).not.toHaveProperty("temperature");
    expect(baseline.include).toContain("reasoning.encrypted_content");
    for (const bridge of [false, true]) {
      const config: Config = {};
      applyApertureProviders(config, origin, [catalog[0]], { bridge });
      const provider = config.provider!["aperture-openai"];
      expect(provider.models!["gpt-5"].id).toBe("gpt-5");
      const sdk = createOpenAI({ name: "aperture-openai", ...provider.options });
      const previous = captured.length;
      await expect(sdk.languageModel(provider.models!["gpt-5"].id)[method](inference)).rejects.toThrow();
      expect(captured.length).toBe(previous + 1);
      const sent = captured.at(-1)!;
      expect(sent.url).toBe(`${origin}${bridge ? "/gateway" : ""}/v1/responses`);
      const body = await sent.json();
      expect(body.model).toBe("openai/gpt-5");
      expect({ ...body, model: "gpt-5" }).toEqual(baseline);
      expect(sent.headers.get("authorization")).toBeNull();
    }
    const native: Config = {};
    applyApertureProviders(native, origin, [catalog[0]], { auth: { openai: { mode: "subscription" } } });
    const sdk = createOpenAI({ apiKey: "synthetic", ...native.provider!.openai.options, fetch: globalThis.fetch });
    await expect(sdk.languageModel(native.provider!.openai.models!["gpt-5"].id)[method](inference)).rejects.toThrow();
    expect(captured.at(-1)!.url).toBe(`${origin}/codex/responses`);
    expect(await captured.at(-1)!.json()).toEqual(baseline);
  }
});

test.skipIf(!process.env.APERTURE_SDK_TEST_DIR)("pinned SDK .languageModel inference routing and credential isolation", async () => {
  const config: Config = {};
  const sdkCatalog = catalog.map(provider => provider.id === "gemini"
    ? { ...provider, models: [...provider.models, "tunedModels/custom-model"] }
    : provider.id === "bedrock" ? { ...provider, models: [...provider.models, "arn:aws:bedrock:us-east-1:123:inference-profile/custom"] } : provider);
  const result = applyApertureProviders(config, origin, sdkCatalog, { bridge: true, capability: "sdk-relay" });
  const captured: Request[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    captured.push(input as Request);
    return Response.json({ error: { message: "synthetic stop" } }, { status: 400 });
  }) as unknown as typeof fetch;
  const factories: Record<string, string> = {
    "@ai-sdk/openai": "createOpenAI", "@ai-sdk/openai-compatible": "createOpenAICompatible",
    "@ai-sdk/anthropic": "createAnthropic", "@ai-sdk/amazon-bedrock": "createAmazonBedrock", "@ai-sdk/google": "createGoogleGenerativeAI",
  };
  for (const id of result.providerIDs) {
    const provider = config.provider![id];
    const sdkModule = await import(`${process.env.APERTURE_SDK_TEST_DIR}/${provider.npm}/dist/index.mjs`);
    const sdk = sdkModule[factories[provider.npm!]]({ name: id, ...provider.options });
    for (const model of Object.values(provider.models!)) {
      for (const streaming of [false, true]) {
        const language = sdk.languageModel(model.id);
        const previous = captured.length;
        await expect(language[streaming ? "doStream" : "doGenerate"]({
          prompt: [{ role: "user", content: [{ type: "text", text: "offline probe" }] }], maxOutputTokens: 16,
        })).rejects.toThrow();
        expect(captured.length).toBe(previous + 1);
        const request = captured.at(-1)!;
        const path = new URL(request.url).pathname;
        const suffix = provider.npm === "@ai-sdk/openai" ? "/responses" :
          provider.npm === "@ai-sdk/openai-compatible" ? "/chat/completions" :
          provider.npm === "@ai-sdk/anthropic" ? "/messages" :
          provider.npm === "@ai-sdk/amazon-bedrock" ? `/model/${encodeURIComponent(model.id!)}/converse${streaming ? "-stream" : ""}` :
          `/models/${encodeURIComponent(model.id!)}:${streaming ? "streamGenerateContent" : "generateContent"}`;
        expect(request.url).toStartWith(`${provider.options!.baseURL}${suffix}`);
        expect(path).toStartWith("/gateway/");
        expect(request.headers.get("authorization")).toBeNull();
        expect(request.headers.get("x-api-key")).toBeNull();
        expect(request.headers.get("x-goog-api-key")).toBeNull();
        expect(request.headers.get("x-aperture-relay-capability")).toBe("sdk-relay");
        expect(request.redirect).toBe("error");
        const body = await request.json();
        if (["@ai-sdk/openai", "@ai-sdk/openai-compatible", "@ai-sdk/anthropic"].includes(provider.npm!)) {
          const remoteID = decodeURIComponent(id.slice("aperture-".length).split(":")[0]);
          expect(body.model).toBe(`${remoteID}/${model.id}`);
        }
      }
    }
  }
});
