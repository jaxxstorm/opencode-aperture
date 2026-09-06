import type { Hooks, Plugin } from "@opencode-ai/plugin";
import {
  ApertureSetupError,
  apertureHost,
  apertureURL,
  applyApertureOpenCodeConfig,
  fetchApertureProviders,
  selectOpenAISubscriptionProvider,
} from "./aperture-codex-plugin";

export default (async () => {
  const debug = process.env.OPENCODE_APERTURE_DEBUG === "1";
  let origin: string | undefined;
  let configured = false;

  return {
    config: async (config) => {
      try {
        origin = apertureHost(process.env);
        const providers = await fetchApertureProviders(origin);
        const provider = selectOpenAISubscriptionProvider(providers);
        applyApertureOpenCodeConfig(config, origin, provider);
        configured = true;
        if (debug) console.error("[opencode-aperture] configured", apertureURL(origin, "/codex"), "models", provider.models.length);
      } catch (error) {
        // Non-destructive: route through Aperture when available, otherwise leave
        // native ChatGPT/OpenCode behavior untouched and report the sanitized error.
        const message = error instanceof ApertureSetupError ? error.message : "Aperture setup failed";
        console.error("[opencode-aperture] leaving native OpenAI configuration unchanged:", message);
      }
    },
    "chat.headers": async (input, output) => {
      if (input.model.providerID !== "openai" || !configured) return;
      output.headers["X-Aperture-OpenCode-Plugin"] = "1";
      if (debug) console.error("[opencode-aperture] chat headers", apertureURL(origin!, "/codex/responses"));
    },
  } satisfies Hooks;
}) satisfies Plugin;
