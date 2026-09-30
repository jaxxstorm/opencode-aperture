import type { Config } from "@opencode-ai/plugin";
import { ApertureSetupError, apertureHost, applyApertureOpenCodeConfig, type ProviderInfo } from "./aperture-codex-plugin";
import { resolveGatewayPath } from "./gateway-path";

export type ApertureProviderOptions = {
  bridge?: boolean;
  capability?: string;
  auth?: Record<string, {
    mode: "gateway" | "passthrough" | "subscription";
    apiKeyEnv?: string;
    protocol?: "responses" | "chat" | "messages" | "bedrock" | "gemini";
  }>;
};

export type ApertureProviderResult = {
  providerIDs: string[];
  modelCount: number;
  subscription: boolean;
  unsupported: string[];
};

type Protocol = NonNullable<NonNullable<ApertureProviderOptions["auth"]>[string]["protocol"]>;
type ProviderConfig = NonNullable<Config["provider"]>[string];

const sdks: Record<Protocol, string> = {
  responses: "@ai-sdk/openai",
  chat: "@ai-sdk/openai-compatible",
  messages: "@ai-sdk/anthropic",
  bedrock: "@ai-sdk/amazon-bedrock",
  gemini: "@ai-sdk/google",
};

/** Mutates only the runtime config, after the entire catalog has been planned.
 * Passthrough keys and relay capabilities stay in fetch closures, never in
 * serializable options exposed by the config API.
 * Unknown limits use estimates (128k context / 8192 output), not advertised facts.
 */
export function applyApertureProviders(
  config: Config,
  origin: string,
  providers: ProviderInfo[],
  options: ApertureProviderOptions = {},
): ApertureProviderResult {
  const host = apertureHost({ APERTURE_HOST: origin });
  const result: ApertureProviderResult = { providerIDs: [], modelCount: 0, subscription: false, unsupported: [] };
  const planned: NonNullable<Config["provider"]> = { ...config.provider };
  const seen = new Set<string>();
  const subscriptions: ProviderInfo[] = [];
  const enabled = (id: string) => !config.disabled_providers?.includes(id) &&
    (!config.enabled_providers || config.enabled_providers.includes(id));
  const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined =>
    record && Object.hasOwn(record, key) ? record[key] : undefined;
  const supports = (provider: ProviderInfo, protocol: Protocol) => {
    const flags = provider.compatibility;
    switch (protocol) {
      case "responses": return flags.openai_responses === true;
      case "chat": return flags.openai_chat === true;
      case "messages": return flags.anthropic === true || flags.anthropic_messages === true;
      case "bedrock": return flags.bedrock === true || flags.bedrock_converse === true;
      case "gemini": return flags.gemini_generate_content === true || flags.gemini === true;
    }
  };

  for (const provider of providers) {
    if (!provider.id.trim() || seen.has(provider.id)) {
      throw new ApertureSetupError("provider IDs must be nonempty and unique; fix the Aperture catalog");
    }
    seen.add(provider.id);
    // These keys are unsafe in OpenCode's own plain-object model registries.
    if (provider.models.some(model => !model.trim() || ["__proto__", "constructor", "prototype"].includes(model))) {
      throw new ApertureSetupError("unsafe or empty model key in Aperture catalog");
    }
  }
  if (options.auth !== undefined && (!options.auth || typeof options.auth !== "object" || Array.isArray(options.auth))) {
    throw new ApertureSetupError("auth configuration must be a provider-ID record");
  }
  for (const [id, auth] of Object.entries(options.auth ?? {})) {
    if (!seen.has(id)) throw new ApertureSetupError(`auth configuration refers to an undiscovered provider: ${id}`);
    if (!auth || typeof auth !== "object" || Array.isArray(auth) || !Object.hasOwn(auth, "mode") ||
      !["gateway", "passthrough", "subscription"].includes(auth.mode)) {
      throw new ApertureSetupError(`auth mode for ${id} must be gateway, passthrough, or subscription`);
    }
    if (auth.protocol !== undefined && (typeof auth.protocol !== "string" || !Object.hasOwn(sdks, auth.protocol))) {
      throw new ApertureSetupError(`invalid auth protocol for ${id}`);
    }
    if (auth.apiKeyEnv !== undefined && (typeof auth.apiKeyEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(auth.apiKeyEnv))) {
      throw new ApertureSetupError(`apiKeyEnv for ${id} must be a valid environment variable name`);
    }
  }

  for (const provider of providers) {
    const auth = own(options.auth, provider.id);
    if (!auth && provider.requires_client_auth === true && !supports(provider, "responses")) {
      result.unsupported.push(`${provider.id}: client authentication required; configure explicit gateway or API-key passthrough auth (native subscription requires Responses)`);
      continue;
    }
    const mode = auth?.mode ?? (provider.requires_client_auth === true ? "subscription" : "gateway");
    if (mode === "subscription") {
      if (!supports(provider, "responses") || (auth?.protocol && auth.protocol !== "responses")) {
        throw new ApertureSetupError(`subscription requires Responses: ${provider.id}; configure gateway or explicit API-key passthrough instead`);
      }
      if (provider.models.length && enabled("openai")) subscriptions.push(provider);
      continue;
    }
    let apiKey = "aperture-managed";
    if (mode === "passthrough") {
      const env = auth?.apiKeyEnv;
      if (!env || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(env) || !process.env[env]?.trim()) {
        throw new ApertureSetupError(`passthrough for ${provider.id} requires apiKeyEnv naming a present, nonempty environment variable`);
      }
      apiKey = process.env[env]!;
    }
    const groups = new Map<Protocol, string[]>();
    for (const model of new Set(provider.models)) {
      const family = model.split("/").at(-1)!;
      const protocol = auth?.protocol ?? (
        supports(provider, "bedrock") ? "bedrock" :
        supports(provider, "gemini") ? "gemini" :
        /^(claude[-.]|anthropic\.)/.test(family) && supports(provider, "messages") ? "messages" :
        (provider.id === "openai" || /^(gpt-|o[134](?:-|$)|chatgpt-)/.test(family)) && supports(provider, "responses") ? "responses" :
        supports(provider, "chat") ? "chat" :
        supports(provider, "messages") ? "messages" :
        supports(provider, "responses") ? "responses" : undefined
      );
      if (!protocol || !supports(provider, protocol)) {
        if (auth?.protocol) throw new ApertureSetupError(`protocol ${auth.protocol} is not advertised by ${provider.id}`);
        result.unsupported.push(`${provider.id}/${model}: no supported inference protocol`);
        continue;
      }
      if (protocol === "bedrock" && mode === "passthrough") {
        throw new ApertureSetupError("Bedrock AWS SigV4 passthrough is unsupported; configure gateway-managed Bedrock credentials");
      }
      if ((protocol === "bedrock" || protocol === "gemini") && !resolveGatewayPath(protocol === "bedrock"
        ? `/gateway/bedrock/model/${encodeURIComponent(model)}/converse`
        : `/gateway/v1beta/models/${encodeURIComponent(model)}:generateContent`)) {
        result.unsupported.push(`${provider.id}/${model}: model ID cannot be represented safely in a gateway path`);
        continue;
      }
      // Path APIs cannot carry a provider qualifier. Check the whole remote
      // catalog, including locally disabled providers: the gateway still sees them.
      if ((protocol === "bedrock" || protocol === "gemini") && providers.some(other =>
        other.id !== provider.id && supports(other, protocol) && other.models.includes(model))) {
        result.unsupported.push(`${provider.id}/${model}: ambiguous ${protocol} model; make upstream model IDs unique across gateway providers`);
        continue;
      }
      const group = groups.get(protocol) ?? [];
      group.push(model);
      groups.set(protocol, group);
    }
    for (const [protocol, remoteModels] of groups) {
      // ':' cannot occur in encodeURIComponent(id), so variant IDs cannot collide.
      const id = `aperture-${encodeURIComponent(provider.id)}${groups.size > 1 ? `:${protocol}` : ""}`;
      if (!enabled(id)) continue;
      const existing = own(config.provider, id);
      const prefix = options.bridge ? mode === "passthrough" ? "/forward" : "/gateway" : "";
      const baseURL = `${host}${prefix}${protocol === "bedrock" ? "/bedrock" : protocol === "gemini" ? "/v1beta" : "/v1"}`;
      if ((existing?.npm && existing.npm !== sdks[protocol]) ||
        (existing?.options?.baseURL && existing.options.baseURL !== baseURL) ||
        (existing?.api && existing.api !== baseURL) || (existing?.id && existing.id !== id)) {
        throw new ApertureSetupError(`provider configuration collision at ${id}; remove conflicting routing overrides`);
      }
      const models: NonNullable<ProviderConfig["models"]> = Object.create(null);
      for (const model of remoteModels) {
        if (existing?.blacklist?.includes(model) || (existing?.whitelist && !existing.whitelist.includes(model))) continue;
        const override = own(existing?.models, model);
        // The pinned runtime schema supports api; the plugin's legacy SDK type
        // currently exposes only npm on this nested object.
        const modelProvider = override?.provider as { npm?: string; api?: string } | undefined;
        if ((override?.id !== undefined && override.id !== model) ||
          (modelProvider?.npm && modelProvider.npm !== sdks[protocol]) ||
          (modelProvider?.api && modelProvider.api !== baseURL)) {
          throw new ApertureSetupError(`model routing collision at ${id}/${model}; remove conflicting id/provider overrides`);
        }
        // Reuse only metadata from native config, never its credentials, headers,
        // fetch, or options. No models.dev lookup or auth-file access is needed.
        const nativeID = protocol === "responses" ? "openai" : protocol === "messages" ? "anthropic" :
          protocol === "gemini" ? "google" : protocol === "bedrock" ? "amazon-bedrock" : provider.id;
        const metadata = own(own(config.provider, nativeID)?.models, model);
        models[model] = {
          name: model,
          ...(metadata && Object.fromEntries(Object.entries(metadata).filter(([key]) =>
            !["id", "provider", "options", "headers", "variants"].includes(key)))),
          ...override,
          id: model,
          limit: { context: 128000, output: 8192, ...metadata?.limit, ...override?.limit },
        };
      }
      if (!Object.keys(models).length) continue;
      const geminiPaths = new Map<string, string>();
      if (protocol === "gemini") {
        for (const model of Object.keys(models)) {
          for (const action of ["generateContent", "streamGenerateContent"]) {
            // Google SDK 3.0.73 treats IDs containing '/' as resource paths.
            // Aperture instead expects the entire bare upstream ID encoded.
            const sdkPath = new URL(`${baseURL}/${model.includes("/") ? model : `models/${model}`}:${action}`).pathname;
            const gatewayPath = new URL(`${baseURL}/models/${encodeURIComponent(model)}:${action}`).pathname;
            if (geminiPaths.has(sdkPath)) throw new ApertureSetupError(`ambiguous Gemini SDK model paths in ${provider.id}; use distinct upstream resource names`);
            geminiPaths.set(sdkPath, gatewayPath);
          }
        }
      }
      const runtimeOptions: NonNullable<ProviderConfig["options"]> = {
        ...existing?.options, baseURL, apiKey: "aperture-managed",
      };
      if (protocol === "bedrock") {
        // SDK 4.0.166: '' disables AWS_BEARER_TOKEN_BEDROCK fallback and selects
        // SigV4; explicit credentials/sessionToken prevent ambient AWS auth.
        Object.assign(runtimeOptions, {
          apiKey: "", accessKeyId: "aperture-managed", secretAccessKey: "aperture-managed",
          sessionToken: "", region: "us-east-1", credentialProvider: undefined,
        });
      }
      // Install on bridge requests too: prevent credentials/capabilities escaping
      // via redirects. Direct managed requests must never transmit SDK auth.
      runtimeOptions.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input instanceof Request ? input.clone() : input, init);
        const url = new URL(request.url);
        if (url.origin !== host || url.username || url.password || !url.pathname.startsWith(`${new URL(baseURL).pathname}/`)) {
          throw new ApertureSetupError("refusing inference request outside the trusted Aperture endpoint");
        }
        if (protocol === "gemini") {
          const path = geminiPaths.get(url.pathname);
          if (!path) throw new ApertureSetupError("refusing undiscovered Gemini inference path");
          url.pathname = path;
        }
        const requestHeaders = new Headers(request.headers);
        for (const key of [...requestHeaders.keys()]) {
          if (/^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-goog-api-key|x-amz-.*)$/i.test(key)) requestHeaders.delete(key);
          if (/^(chatgpt-account-id|originator|(?:x-)?(?:session|conversation)[_-]id|x-codex-.*)$/i.test(key)) requestHeaders.delete(key);
        }
        for (const key of [...url.searchParams.keys()]) {
          if (/^(key|api_key|api-key|x-amz-.*)$/i.test(key)) url.searchParams.delete(key);
        }
        // Even an SDK authToken or a per-model Authorization override must not
        // substitute another credential for the explicitly selected env key.
        if (mode === "passthrough") {
          requestHeaders.set(protocol === "messages" ? "x-api-key" : protocol === "gemini" ? "x-goog-api-key" : "authorization",
            protocol === "messages" || protocol === "gemini" ? apiKey : `Bearer ${apiKey}`);
        }
        if (options.capability !== undefined) requestHeaders.set("x-aperture-relay-capability", options.capability);
        let body: string | undefined;
        if (protocol === "responses" || protocol === "chat" || protocol === "messages") {
          let payload: unknown;
          try { payload = await request.clone().json(); }
          catch { throw new ApertureSetupError("inference request requires a JSON body with an allowed model"); }
          if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
            !("model" in payload) || typeof payload.model !== "string" || !Object.hasOwn(models, payload.model)) {
            throw new ApertureSetupError("refusing inference request for a model outside the allowed provider catalog");
          }
          // SDK capability detection must see the bare upstream ID (e.g. gpt-5).
          // Qualify only the serialized wire payload, after SDK transformations.
          body = JSON.stringify({ ...payload, model: `${provider.id}/${payload.model}` });
          requestHeaders.delete("content-length");
        }
        return fetch(new Request(url, new Request(request, {
          headers: requestHeaders, redirect: "error", ...(body !== undefined ? { body } : {}),
        })));
      };
      planned[id] = { ...existing, name: `Aperture (${provider.name || provider.id})`,
        npm: sdks[protocol], env: [], options: runtimeOptions, models };
      result.providerIDs.push(id);
      result.modelCount += Object.keys(models).length;
    }
  }
  if (subscriptions.length > 1) {
    throw new ApertureSetupError("multiple Aperture subscription Responses providers: select exactly one with auth mode subscription and configure the others as gateway or explicit passthrough");
  }
  const subscription = subscriptions[0];
  const staged: Config = { ...config, provider: planned };
  if (subscription) {
    applyApertureOpenCodeConfig(staged, host, { ...subscription, models: [...new Set(subscription.models)] });
    const native = staged.provider!.openai;
    native.models = Object.fromEntries(Object.entries(native.models!).map(([id, model]) => [id, {
      ...model, limit: { context: 128000, output: 8192, ...model.limit },
    }]));
    // Native OAuth owns fetch; the main chat.headers hook injects the capability
    // for returned providerIDs (including openai), not through config options.
    result.providerIDs.push("openai");
    result.modelCount += native.whitelist!.length;
    result.subscription = true;
  }
  if (result.providerIDs.length) {
    config.provider = staged.provider;
    if (staged.model !== undefined) config.model = staged.model;
  }
  return result;
}
