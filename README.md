# Aperture for OpenCode

Use models from your [Aperture](https://tailscale.com/aperture) gateway in OpenCode.

The plugin discovers supported providers and models, adds them to OpenCode's model
picker, and routes requests through your gateway. Connect directly or use an
optional userspace Tailscale bridge, independent of your machine's Tailscale client.

- Use gateway-managed credentials, explicitly forward a provider API key, or keep
  OpenCode's native ChatGPT subscription login for compatible forwarding routes.
- Access OpenAI Responses, Chat Completions, Anthropic Messages, Bedrock Converse,
  and Gemini APIs where advertised by the gateway.
- Enroll the bridge and refresh models from OpenCode's command palette.

Only connect to a gateway you trust: it receives your prompts and, when forwarding
is enabled, the credentials selected for that route.

**Documentation:** [How to use](docs/how-to-use.md) | [Build](docs/build.md) |
[Run locally](docs/run-locally.md) | [Documentation site](docs/README.md)

MIT licensed. See [LICENSE](LICENSE).
