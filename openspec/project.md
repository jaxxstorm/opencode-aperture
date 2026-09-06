# @jaxxstorm/opencode-aperture

## Purpose and Status

Provide a config-only OpenCode plugin that routes native OpenAI ChatGPT subscription Responses traffic through a trusted Aperture gateway. OpenCode owns OAuth login, refresh, persistence, and authentication headers; the plugin does not own identity or replace transport.

The owner-approved package `@jaxxstorm/opencode-aperture@0.1.0` is prepared for public distribution under MIT, copyright 2026 Lee Briggs, with Bun 1.3.14 metadata and repository `jaxxstorm/opencode-aperture`. It remains unpublished. npm scope access, trusted publishing, and required environment reviewers need external owner setup; removing `private` or preparing a tarball is not permission to publish.

## Active Architecture

- TypeScript implementation in `src/index.ts`, with one runtime root export: the plugin factory.
- Bun builds self-contained ESM to `dist/index.js`, the package entrypoint. Consumers require neither a checkout nor development dependencies or a build step.
- `.opencode/plugins/aperture-codex.ts` is a thin source-development adapter to the shared implementation. Load either the adapter or the built/package entry, never both, including auto-discovery and explicit registrations.
- Discovery runs in the config lifecycle after hooks are registered. The plugin configures native provider `openai` with `<gateway-origin>/codex`; Responses requests go to `/codex/responses`.
- On stock OpenCode 1.18.29, that path avoids the native `/v1/responses` or `/chat/completions` rewrite while retaining native OAuth header injection and HTTP/SSE transport. There is no arbitrary request-matching hook or fetch patch.

These are the active distribution contracts. Local release-workflow revision checks pass on darwin-arm64; actual CI and publishing remain unverified. Historical bootstrap and prepare-plugin-distribution artifacts describe earlier assumptions and are not current implementation guidance. Do not rewrite those artifacts as part of reconciliation.

The three completed changes were archived under `openspec/changes/archive/2026-09-05-*/`. Five current capabilities are recorded in `openspec/specs/`. The bootstrap's obsolete request-interception and endpoint/debug-variable specification was retained only in history, not promoted to a main spec; the implemented config-only routing and native OAuth boundary are covered by the newer capabilities.

## Boundaries

- Do not implement OAuth, read auth files, persist tokens/account IDs, register auth loaders, replace fetch, import private OpenCode APIs, or maintain a patched host.
- Do not synthesize authentication headers or convert subscription routing into API-key provider behavior. Preserve OpenCode-generated and user-supplied headers; the optional marker is OpenAI-only.
- The gateway receives subscription bearer credentials and request content. Require explicit trust; prefer HTTPS, or an explicitly trusted independently protected network for HTTP.
- WebSockets and residency-sensitive accounts are unsupported. The avoided native rewrite branch currently adds residency headers; do not claim residency enforcement.

## Runtime Configuration

Resolve the first nonempty `APERTURE_HOST`, then nonempty `OPENCODE_APERTURE_HOST`, then `http://ai`. Accept only HTTP/HTTPS origins with an optional trailing slash. Reject malformed URLs, other schemes, credentials, queries, fragments, and non-root paths before discovery. No endpoint override or shell propagation is part of this contract.

Discover `/api/providers` with a 10-second timeout, reject redirects and non-success responses, validate records, and require exactly one provider with `requires_client_auth: true`, `openai_responses: true`, and nonempty model IDs. Reject chat-only and ambiguous catalogs; deduplicate model IDs in stable order. Discovery has no automatic retry and runs again on a new OpenCode initialization.

Preserve explicit default models, including unrelated providers; preserve user model metadata and unrelated OpenAI options/providers. Intersect any existing OpenAI whitelist with discovered IDs. An unavailable explicit OpenAI model or empty intersection is an error, not a substitution. Choose the first allowed discovered model only when no default is set; repeated application must be idempotent.

Only `OPENCODE_APERTURE_DEBUG=1` enables debug. Use allowlisted stage/status/error-category and validated origin/path metadata. Never log raw headers, bodies, account identifiers, OAuth payloads, discovery responses, arbitrary upstream errors, or invalid URLs. Do not collect secrets and rely on redaction after serialization.

## Failure Contract

The plugin routes OpenAI requests through Aperture only when it sets up successfully. When host validation, discovery, selection, or configuration fails, it reports a sanitized diagnostic and leaves the user's configuration untouched: it does not disable providers, does not throw or block during request handling, and does not set a request guard. Requests continue through native OpenCode routing, so a setup problem degrades to ordinary behavior instead of breaking existing connections. Unrelated providers remain usable.

This contract does not cover absent/unloadable modules, conflicting plugins overriding OpenAI auth/fetch/config, or future or untested runtimes, and the plugin is not a process-wide egress or destination-enforcement product. Missing auth and gateway request errors remain native OpenCode behavior; the plugin adds no retries, credential repair, or request-time interception. No controlled-egress or network-isolation environment is required for release.

Restart after host/config/install changes and after correcting setup errors. Switching from a local adapter requires removing both explicit registration and auto-discovered copies before enabling the package. Removal changes no native credentials and intentionally restores native routing after restart; it is not failure-mode fallback.

## Evidence and Validation

Exact existing baseline: stock OpenCode 1.18.29, Bun 1.3.14, darwin, September 5, 2026. The old local synthetic HTTP 400 probe verified destination/header behavior, not inference completion. Authorized local `gpt-5.6-luna` and `gpt-6-astra` checks returned text only, without independent gateway-log correlation, tool, or refresh evidence.

Required candidate checks: `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, `bun run build`, local pack inspection, clean-consumer loading, packaged routing, and cleanup. Supply the same candidate to package/routing/cleanup scripts through `APERTURE_TEST_TARBALL`; do not repack between release checks and publication. Include workflow lint, release-validation fixtures, and a credential-free publish dry run. Record exact versions/platforms and candidate checksum; distinguish local baseline, packaged checks, CI, and manual latest canary. Local locked install, typecheck, 79 tests, build, packaged routing/cleanup, and actionlint passed on darwin-arm64; exact candidate evidence is in `openspec/changes/archive/2026-09-05-add-release-workflows/tasks.md`.

Release automation accepts stable `vMAJOR.MINOR.PATCH` tags matching the source version, requires reusable Ubuntu/macOS verification, and publishes one verified tarball after required reviewer approval in the `npm` environment. Use GitHub OIDC with npm trust for owner `jaxxstorm`, repository `opencode-aperture`, workflow `release.yml`, environment `npm`, with direct publish allowed and no long-lived token fallback. Only successful npm publication permits the GitHub release and matching tarball/SHA-256 assets. Initial publication may need separately authorized owner authentication before package trust settings exist; subsequent OIDC publication requires a new version/tag. Follow [release setup and recovery](../docs/release.md); never republish existing versions, move released tags, or replace tested bytes. No tags, publication, or account changes are authorized by implementation work.

Tests use isolated synthetic auth through OpenCode's API, bounded lifecycle/cleanup, protocol-valid SSE, tools, cancellation, and concurrency, with synthetic credentials only ever sent to a loopback mock gateway. No fixtures contain real credentials. Unit tests cover invalid host, unreachable/timed-out discovery, malformed and ambiguous catalogs, and non-destructive setup failures. Live tests require explicit trusted-gateway authorization outside CI; observe natural-expiry native refresh with non-secret evidence and subsequent gateway success, never auth-file access or forced expiry. If safe refresh evidence is unavailable, keep it unverified and messaging experimental.

See [installation](../README.md), [verification](../scripts/README.md), [compatibility](../docs/compatibility.md), [live procedure](../docs/live-validation.md), and [release gates](../docs/release.md).
