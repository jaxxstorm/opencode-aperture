import { describe, expect, test } from "bun:test";
import {
  apertureHost,
  apertureURL,
  applyApertureOpenCodeConfig,
  selectOpenAISubscriptionProvider,
  type OpenCodeConfig,
} from "../src/aperture-codex-plugin";

const provider = {
  id: "openai-sub",
  name: "OpenAI (Subscription)",
  models: ["gpt-5.5"],
  requires_client_auth: true,
  compatibility: {
    openai_responses: true,
    openai_chat: true,
  },
};

describe("Aperture Codex OpenCode plugin", () => {
  test("uses APERTURE_HOST to select the Aperture endpoint", () => {
    expect(apertureHost({ APERTURE_HOST: "http://127.0.0.1:11435" })).toBe("http://127.0.0.1:11435");
    expect(apertureHost({ OPENCODE_APERTURE_HOST: "http://ai" })).toBe("http://ai");
  });

  test("derives OpenAI passthrough and Codex endpoints from the same host", () => {
    expect(apertureURL("http://ai", "/v1")).toBe("http://ai/v1");
    expect(apertureURL("http://127.0.0.1:11435", "/codex/responses")).toBe(
      "http://127.0.0.1:11435/codex/responses",
    );
  });

  test("selects an OpenAI-compatible subscription provider", () => {
    expect(selectOpenAISubscriptionProvider([provider]).id).toBe("openai-sub");
  });

  test("rejects providers without subscription client auth", () => {
    expect(() =>
      selectOpenAISubscriptionProvider([
        {
          ...provider,
          requires_client_auth: false,
        },
      ]),
    ).toThrow("no Aperture subscription Responses provider with models was found");
  });

  test("mutates OpenCode config with dynamic model and Aperture OpenAI passthrough", () => {
    const config: OpenCodeConfig = {
      provider: {
        openai: {
          options: {
            timeout: 600000,
          },
        },
      },
    };

    applyApertureOpenCodeConfig(config, "http://ai", provider);

    expect(config.model).toBe("openai/gpt-5.5");
    expect(config.provider!.openai.name).toBe("Aperture (OpenAI (Subscription))");
    expect(config.provider!.openai.options!.baseURL).toBe("http://ai/codex");
    expect(config.provider!.openai.options!.apiKey).toBeUndefined();
    expect(config.provider!.openai.models!["gpt-5.5"].id).toBe("gpt-5.5");
    expect(config.provider!.openai.whitelist).toEqual(["gpt-5.5"]);
  });
});
