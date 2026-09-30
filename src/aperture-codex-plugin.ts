import type { Config } from "@opencode-ai/plugin";

export type ProviderInfo = {
  id: string;
  name?: string;
  models: string[];
  compatibility: Record<string, boolean>;
  requires_client_auth?: boolean;
};

export type OpenCodeConfig = Config;

// Only these locally generated messages are safe to expose during setup.
export class ApertureSetupError extends Error {}

const defaultApertureHost = "http://ai";

export function apertureHost(env: Record<string, string | undefined>): string {
  const value = env.APERTURE_HOST || env.OPENCODE_APERTURE_HOST || defaultApertureHost;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApertureSetupError("invalid gateway origin: use an HTTP or HTTPS origin without credentials, path, query, or fragment");
  }
  if (
    !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
    url.pathname !== "/" || value.includes("?") || value.includes("#") || value.includes("@")
  ) {
    throw new ApertureSetupError("invalid gateway origin: use an HTTP or HTTPS origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

export function apertureURL(host: string, path: string): string {
  return new URL(path, host).toString().replace(/\/$/, "");
}

export async function fetchApertureProviders(
  host: string,
  request: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
): Promise<ProviderInfo[]> {
  const signal = AbortSignal.timeout(10000);
  let response: Response;
  try {
    response = await request(apertureURL(apertureHost({ APERTURE_HOST: host }), "/api/providers"), { signal, redirect: "error" });
  } catch (error) {
    if (error instanceof ApertureSetupError) throw error;
    throw new ApertureSetupError(signal.aborted ? "provider discovery timed out after 10 seconds" : "provider discovery failed: check gateway connectivity and redirects");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApertureSetupError(`provider discovery returned HTTP ${response.status}`);
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new ApertureSetupError(signal.aborted ? "provider discovery timed out after 10 seconds" : "provider discovery returned invalid JSON"); }
  if (!Array.isArray(data) || data.some((item) =>
    !item || typeof item !== "object" ||
    typeof item.id !== "string" || !item.id.trim() ||
    (item.name !== undefined && typeof item.name !== "string") ||
    !Array.isArray(item.models) || item.models.some((model: unknown) => typeof model !== "string" || !model.trim()) ||
    !item.compatibility || typeof item.compatibility !== "object" || Array.isArray(item.compatibility) ||
    Object.values(item.compatibility).some((value) => typeof value !== "boolean") ||
    (item.requires_client_auth !== undefined && typeof item.requires_client_auth !== "boolean")
  )) throw new ApertureSetupError("provider discovery returned an invalid catalog");
  return data as ProviderInfo[];
}

export function selectOpenAISubscriptionProvider(providers: ProviderInfo[]): ProviderInfo {
  const eligible = providers.filter(
    (candidate) =>
      candidate.requires_client_auth &&
      candidate.models.length > 0 &&
      candidate.compatibility.openai_responses === true,
  );

  if (eligible.length !== 1) {
    throw new ApertureSetupError(eligible.length === 0
      ? "no Aperture subscription Responses provider with models was found"
      : "multiple Aperture subscription Responses providers found: configure exactly one eligible provider");
  }
  return { ...eligible[0], models: [...new Set(eligible[0].models)] } as ProviderInfo;
}

export function openCodeModels(provider: ProviderInfo): Record<string, { id: string; name: string }> {
  return Object.fromEntries(
    provider.models.map((model) => [
      model,
      {
        id: model,
        name: `${provider.name || provider.id} ${model}`,
      },
    ]),
  );
}

export function openCodeModelIDs(provider: ProviderInfo): string[] {
  return provider.models;
}

export function applyApertureOpenCodeConfig(
  config: OpenCodeConfig,
  host: string,
  provider: ProviderInfo,
): void {
  const existing = config.provider?.openai;
  const models = provider.models.filter(model =>
    (!existing?.whitelist || existing.whitelist.includes(model)) && !existing?.blacklist?.includes(model));
  if (!models.length) throw new ApertureSetupError("no discovered OpenAI models remain allowed by configuration");
  if (config.model?.startsWith("openai/") && !models.includes(config.model.slice("openai/".length))) {
    throw new ApertureSetupError("selected OpenAI model is not available from the gateway or is excluded by configuration");
  }
  config.model ??= `openai/${models[0]}`;
  config.provider ??= {};
  config.provider.openai = {
    ...config.provider.openai,
    name: `Aperture (${provider.name || provider.id})`,
    options: {
      ...config.provider.openai?.options,
      // The Responses SDK appends /responses. Avoid /v1: OpenCode's native
      // OAuth fetch rewrites /v1/responses to ChatGPT, but leaves /codex/responses intact.
      baseURL: apertureURL(host, "/codex"),
    },
    models: {
      ...openCodeModels(provider),
      ...config.provider.openai?.models,
    },
    whitelist: models,
  };
}
