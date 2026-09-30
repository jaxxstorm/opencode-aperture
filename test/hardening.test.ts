import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Hooks } from "@opencode-ai/plugin";
import plugin from "../src/index";
import {
  apertureHost, applyApertureOpenCodeConfig, fetchApertureProviders,
  selectOpenAISubscriptionProvider, type OpenCodeConfig,
} from "../src/aperture-codex-plugin";

const provider = {
  id: "openai-sub", models: ["gpt-5.5", "gpt-6-astra"],
  requires_client_auth: true, compatibility: { openai_responses: true },
};
const originalHost = process.env.APERTURE_HOST;
const originalDebug = process.env.OPENCODE_APERTURE_DEBUG;
const originalEnable = process.env.OPENCODE_APERTURE_ENABLE;
let gateway: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  gateway?.stop(true);
  gateway = undefined;
  mock.restore();
  for (const [key, value] of [["APERTURE_HOST", originalHost], ["OPENCODE_APERTURE_DEBUG", originalDebug], ["OPENCODE_APERTURE_ENABLE", originalEnable]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});

function serve(fetch: (request: Request) => Response | Promise<Response>) {
  gateway = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
  return `http://127.0.0.1:${gateway.port}`;
}

function chat(providerID = "openai") {
  // Deliberately omit provider.info: the runtime does not reliably supply it.
  return { model: { providerID, id: "gpt-6-astra" } } as Parameters<NonNullable<Hooks["chat.headers"]>>[0];
}

describe("gateway validation and discovery", () => {
  test("preserves precedence, aliases, default, and normalized origins", () => {
    expect(apertureHost({})).toBe("http://ai");
    expect(apertureHost({ APERTURE_HOST: "https://gateway.test/", OPENCODE_APERTURE_HOST: "http://ai" })).toBe("https://gateway.test");
    expect(apertureHost({ APERTURE_HOST: "", OPENCODE_APERTURE_HOST: "http://localhost:8080" })).toBe("http://localhost:8080");
  });

  test.each(["bad-secret", "ftp://ai", "http://secret@ai", "http://user:secret@ai", "http://ai/path", "http://ai?secret", "http://ai#secret", "http://ai?", "http://ai#"])("rejects unsafe origin %s without echoing it", value => {
    expect(() => apertureHost({ APERTURE_HOST: value })).toThrow("invalid gateway origin");
    try { apertureHost({ APERTURE_HOST: value }); } catch (error) { expect(String(error)).not.toContain("secret"); }
  });

  test("rejects invalid hosts before fetching", async () => {
    const fetch = spyOn(globalThis, "fetch");
    await expect(fetchApertureProviders("http://secret@ai")).rejects.toThrow("invalid gateway origin");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("validates discovery and selects only a unique Responses subscription", async () => {
    const host = serve(() => Response.json([{ ...provider, models: [...provider.models, provider.models[0]] }, { ...provider, id: "api", requires_client_auth: false }]));
    const selected = selectOpenAISubscriptionProvider(await fetchApertureProviders(host));
    expect(selected.models).toEqual(provider.models);
    expect(() => selectOpenAISubscriptionProvider([])).toThrow("no Aperture");
    expect(() => selectOpenAISubscriptionProvider([{ ...provider, models: [] }])).toThrow("no Aperture");
    expect(() => selectOpenAISubscriptionProvider([{ ...provider, compatibility: { openai_chat: true } }])).toThrow("no Aperture");
    expect(() => selectOpenAISubscriptionProvider([provider, { ...provider, id: "second" }])).toThrow("multiple Aperture");
  });

  test.each([null, {}, [null], [{ id: "secret" }], [{ ...provider, models: [null] }], [{ ...provider, models: [" "] }], [{ ...provider, compatibility: [] }], [{ ...provider, compatibility: { openai_responses: "yes" } }], [{ ...provider, requires_client_auth: "true" }]])("rejects malformed catalog %#", async data => {
    const host = serve(() => Response.json(data));
    await expect(fetchApertureProviders(host)).rejects.toThrow("invalid catalog");
  });

  test("does not include invalid JSON or upstream error bodies in errors", async () => {
    let badJSON = true;
    const host = serve(() => new Response("synthetic-secret-body", { status: badJSON ? 200 : 503 }));
    await expect(fetchApertureProviders(host)).rejects.toThrow("invalid JSON");
    badJSON = false;
    await expect(fetchApertureProviders(host)).rejects.toThrow("HTTP 503");
  });

  test("rejects redirects without visiting the target", async () => {
    let hits = 0;
    const host = serve(() => { hits++; return Response.redirect(`${gateway!.url}secret`, 302); });
    await expect(fetchApertureProviders(host)).rejects.toThrow("connectivity and redirects");
    expect(hits).toBe(1);
  });

  test("bounds stalled discovery with a 10-second signal and no retries", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const timer = spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(30));
    let hits = 0;
    const host = serve(() => { hits++; return new Promise<Response>(() => {}); });
    await expect(fetchApertureProviders(host)).rejects.toThrow("timed out after 10 seconds");
    expect(timer).toHaveBeenCalledWith(10000);
    expect(hits).toBe(1);
  });

  test("sanitizes connection failures", async () => {
    await expect(fetchApertureProviders("http://127.0.0.1:1")).rejects.toThrow("connectivity and redirects");
  });
});

describe("configuration ownership", () => {
  test("preserves explicit Astra choice and user overrides idempotently", () => {
    const config: OpenCodeConfig = { model: "openai/gpt-6-astra", provider: {
      openai: { options: { timeout: 1234 }, models: { "gpt-6-astra": { name: "My Astra", limit: { context: 50000, output: 1000 } } } },
      anthropic: { options: { timeout: 5678 } },
    } };
    applyApertureOpenCodeConfig(config, "http://ai", provider);
    const first = structuredClone(config);
    applyApertureOpenCodeConfig(config, "http://ai", provider);
    expect(config).toEqual(first);
    expect(config.model).toBe("openai/gpt-6-astra");
    expect(config.provider!.openai.models!["gpt-6-astra"].name).toBe("My Astra");
    expect(config.provider!.openai.options!.timeout).toBe(1234);
    expect(config.provider!.anthropic.options!.timeout).toBe(5678);
  });

  test("preserves another provider default and restricts allowed OpenAI models", () => {
    const config: OpenCodeConfig = { model: "anthropic/claude", provider: { openai: { whitelist: ["gpt-6-astra", "unknown"] } } };
    applyApertureOpenCodeConfig(config, "http://ai", provider);
    expect(config.model).toBe("anthropic/claude");
    expect(config.provider!.openai.whitelist).toEqual(["gpt-6-astra"]);
  });

  test("chooses an allowed default instead of the first excluded model", () => {
    const config: OpenCodeConfig = { provider: { openai: { whitelist: ["gpt-6-astra"] } } };
    applyApertureOpenCodeConfig(config, "http://ai", provider);
    expect(config.model).toBe("openai/gpt-6-astra");
  });

  const unavailable: OpenCodeConfig[] = [
    { model: "openai/unknown" },
    { model: "openai/gpt-5.5", provider: { openai: { whitelist: ["gpt-6-astra"] } } },
    { provider: { openai: { whitelist: [] } } },
    { provider: { openai: { blacklist: provider.models } } },
  ];
  test.each(unavailable)("rejects unavailable model selections without partial mutation %#", config => {
    const before = structuredClone(config);
    expect(() => applyApertureOpenCodeConfig(config, "http://ai", provider)).toThrow();
    expect(config).toEqual(before);
  });
});

describe("plugin hooks and safe failures", () => {
  test("server plugin is inert unless explicitly enabled", async () => {
    delete process.env.OPENCODE_APERTURE_ENABLE;
    expect(await plugin()).toEqual({});
  });

  test("registers hooks without network and leaves native config unchanged on setup failure", async () => {
    process.env.APERTURE_HOST = "http://synthetic-secret@ai";
    process.env.OPENCODE_APERTURE_ENABLE = "1";
    const fetch = spyOn(globalThis, "fetch");
    const log = spyOn(console, "error").mockImplementation(() => {});
    const hooks = await plugin();
    expect(fetch).not.toHaveBeenCalled();
    expect(hooks).not.toHaveProperty("auth");
    expect(hooks).not.toHaveProperty("shell.env");
    const config: OpenCodeConfig = { disabled_providers: ["other"], provider: { anthropic: { name: "unchanged" } } };
    const before = structuredClone(config);
    await hooks.config!(config);
    expect(config).toEqual(before);
    expect(config.disabled_providers).toEqual(["other"]);
    const output = { headers: {} };
    await hooks["chat.headers"]!(chat(), output);
    expect(output.headers).toEqual({});
    await hooks["chat.headers"]!(chat("anthropic"), output);
    expect(output.headers).toEqual({});
    expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-secret");
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([undefined, "0", "true", "1"])("debug value %s and header scoping", async debug => {
    if (debug === undefined) delete process.env.OPENCODE_APERTURE_DEBUG;
    else process.env.OPENCODE_APERTURE_DEBUG = debug;
    process.env.OPENCODE_APERTURE_ENABLE = "1";
    process.env.APERTURE_HOST = serve(() => Response.json([provider]));
    const log = spyOn(console, "error").mockImplementation(() => {});
    const hooks = await plugin();
    await hooks.config!({});
    const headers = { Authorization: "Bearer synthetic-secret", "ChatGPT-Account-Id": "synthetic-account", "session-id": "synthetic-session" };
    const output: { headers: Record<string, string> } = { headers: { ...headers } };
    await hooks["chat.headers"]!(chat(), output);
    expect(output.headers).toEqual({ ...headers, "X-Aperture-OpenCode-Plugin": "1" });
    const other = { headers: { ...headers } };
    await hooks["chat.headers"]!(chat("anthropic"), other);
    expect(other.headers).toEqual(headers);
    expect(log.mock.calls.length > 0).toBe(debug === "1");
    for (const value of Object.values(headers)) expect(JSON.stringify(log.mock.calls)).not.toContain(value);
  });

  test("malformed discovery cannot leak secret data or mutate native config", async () => {
    process.env.OPENCODE_APERTURE_DEBUG = "1";
    process.env.OPENCODE_APERTURE_ENABLE = "1";
    process.env.APERTURE_HOST = serve(() => Response.json([{ id: "synthetic-secret" }]));
    const log = spyOn(console, "error").mockImplementation(() => {});
    const hooks = await plugin();
    const config: OpenCodeConfig = { model: "openai/gpt-5.5" };
    const before = structuredClone(config);
    await hooks.config!(config);
    expect(config).toEqual(before);
    expect(config.disabled_providers).toBeUndefined();
    const output = { headers: {} };
    await hooks["chat.headers"]!(chat(), output);
    expect(output.headers).toEqual({});
    expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-secret");
  });
});
