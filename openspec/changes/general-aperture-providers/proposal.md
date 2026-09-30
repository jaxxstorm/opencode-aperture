# General Aperture Providers

## Why

The server now discovers more than native OpenAI subscriptions. Documentation must describe supported remote providers, explicit credential selection, and evidence limits without implying arbitrary API support or live inference success.

## What Changes

- Document namespaced provider groups across Responses, Chat, Messages, Bedrock Converse, and Gemini.
- Define gateway, explicit environment-key passthrough, and retained native subscription authentication.
- Document process-scoped enablement, all-provider refresh, browser-opener privacy limits, and implemented explicit launcher environment forwarding.
- Describe raw SDK model IDs, fetch-boundary JSON qualification, and projection of extra gateway metadata out of the private catalog protocol.
- Record authorized 2026-09-29 real-bridge discovery: eight remote providers, 10 groups, 42 model entries, zero unsupported entries, and no subscription selection or live inference.
- Separate earlier installed synthetic passes and fresh typecheck evidence from pending latest-build verification and inference evidence limits.

## Impact

This documentation-only change updates `README.md` and `scripts/README.md` and adds a minimal delta for `optional-tailscale-bridge`. It does not modify runtime code, existing specs, archived changes, or global user configuration. Existing `src/aperture-providers.ts` is the implementation reference; remaining integration work belongs to its respective workstreams.
