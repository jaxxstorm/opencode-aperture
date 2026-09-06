## Why

OpenCode already owns ChatGPT Plus/Pro authentication, but Codex traffic needs a transport-only way to pass through Aperture without reimplementing OAuth or taking ownership of identity.

This change bootstraps a small TypeScript OpenCode plugin that rewrites only Codex-bound request destinations to an Aperture passthrough endpoint while preserving OpenCode-generated auth and session headers.

## What Changes

- Add a Bun/TypeScript OpenCode plugin project scaffold with `package.json`, `tsconfig.json`, `opencode.json`, plugin source, tests, and OpenSpec artifacts.
- Add a local OpenCode plugin entrypoint at `.opencode/plugin/aperture-codex.ts`.
- Detect Codex-bound requests for `/v1/responses`, `/chat/completions`, and `/backend-api/codex/responses`.
- Rewrite Codex-bound request destinations to `OPENCODE_APERTURE_CODEX_ENDPOINT`.
- Leave non-Codex request destinations unchanged.
- Preserve OpenCode-owned auth/session headers including `Authorization`, `ChatGPT-Account-Id`, `User-Agent`, `session-id`, `originator`, `Content-Type`, and `Accept`.
- Use hook-provided auth information only to set missing request headers when OpenCode provides it.
- Fail clearly when a Codex request is detected but `OPENCODE_APERTURE_CODEX_ENDPOINT` is missing.
- Add optional debug logging controlled by `OPENCODE_APERTURE_CODEX_DEBUG=1` with bearer tokens and OAuth payload fields redacted.
- Add tests for routing, non-Codex passthrough, header preservation, redaction, missing endpoint failures, and absence of real-token fixtures.
- Do not implement ChatGPT/OpenAI OAuth, read OpenCode auth files, persist OAuth/account data, log bearer tokens, or convert ChatGPT subscription auth into an OpenAI API-key provider.

## Capabilities

### New Capabilities

- `aperture-codex-plugin`: OpenCode plugin behavior for detecting Codex requests, routing them through Aperture, preserving OpenCode-owned auth/session headers, redacting debug logs, and failing safely when routing cannot be configured.

### Modified Capabilities

- None.

## Impact

- Adds TypeScript/Bun project files: `package.json`, `tsconfig.json`, and test configuration through Bun's built-in test runner.
- Adds OpenCode plugin configuration in `opencode.json` to load `./.opencode/plugin/aperture-codex.ts`.
- Adds plugin implementation at `.opencode/plugin/aperture-codex.ts`.
- Adds unit tests at `test/aperture-codex.test.ts`.
- Adds OpenSpec capability coverage under `openspec/specs/aperture-codex-plugin/spec.md` and change artifacts under `openspec/changes/bootstrap-aperture-codex-plugin/`.
