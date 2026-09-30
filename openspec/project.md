# @jaxxstorm/opencode-aperture

## Purpose and Status

Provide an OpenCode plugin that routes native OpenAI ChatGPT subscription Responses traffic through a trusted Aperture gateway. Bridge-disabled operation remains config-only. The owner has authorized full production implementation of the optional independent Tailscale bridge in `add-optional-tailscale-bridge`, with the narrow transport/state exceptions below. OpenCode exclusively owns native OAuth login, refresh, persistence, and authentication headers; no native auth fetch is replaced.

The owner-approved package `@jaxxstorm/opencode-aperture@0.1.0` is prepared for public distribution under MIT, copyright 2026 Lee Briggs, with Bun 1.3.14 metadata and repository `jaxxstorm/opencode-aperture`. It remains unpublished. npm scope access, trusted publishing, and required environment reviewers need external owner setup; removing `private` or preparing a tarball is not permission to publish.

## Active Architecture

### Authorized Bridge Target (Not Yet Verified)

The latest "wire it in please, finish the job" authorization supersedes earlier synthetic-only scope, not historical technical NO-GOs. This reconciliation is limited to active OpenSpec guidance and current change artifacts; existing code/tests and their final verification remain owned by main. Authorization is not evidence that the feature works.

- Ship one default server plugin function at `dist/index.js`, a self-contained `dist/bridge-worker.js`, and optional TUI subpath `dist/tui.js`; no additional root plugin export.
- The parent owns one shared numeric-loopback raw HTTP ingress on an OS-assigned port until parent process exit. `unref()` prevents it blocking exit. Independent per-instance private capability routes are removed on disposal; neither a request nor instance disposal closes the shared listener.
- Parent `node:http` streams to each worker's Unix socket in a short parent-created private 0700 directory. The worker exposes no native-facing TCP listener. Only the child performs HTTPS/CONNECT through the real bridge proxy to the fixed trusted HTTPS gateway. Native embedded Bun never performs CONNECT.
- On unexpected worker exit, invalidate routes, abort/close in-flight work (or return sanitized 503), then return 403 for removed capabilities. The parent TCP port remains bound, protecting cached retries from other-UID port reuse. Private Unix directory ownership/permissions prevent an other-UID replacement even between liveness checking and connect. Same-user/root compromise is out of scope. These are required guarantees awaiting tests, not proven outcomes.
- External runtime uses an explicit absolute executable or one-time PATH resolution, actual Bun allowlist exactly 1.4.2, bounded protocol and transport checks. Future explicit embedded mode runs the identical child via `process.execPath` and child-only `BUN_BE_BUN=1` only after verification; never automatically fall back.
- Share `${XDG_CONFIG_HOME:-~/.config}/opencode-aperture/settings.json` locally between TUI and server. Version 1 contains `bridge: { enabled, gateway, hostname, stateDir, runtime: { mode, executable? }, modulePath?, authKeyEnv?, startupTimeoutMs }`. Gateway is HTTPS-only; stateDir is absolute/private, modulePath an optional absolute trusted installed JavaScript entry. Default disabled; timeout defaults to 60000 ms, integer range 1-300000 ms. Writes are atomic and owner-only. Existing gateway environment precedence remains unchanged while disabled.
- Local TUI commands `/aperture-setup`, `/aperture-status`, `/aperture-disconnect`, `/aperture-forget` use private public-host dialogs, never model tools. Browser enrollment URL appears only in `DialogAlert`. Public `DialogPrompt` cannot mask, so accept only an explicit environment-variable name (`authKeyEnv`), never an unmasked key. Resolve that user's key transiently and pass over private control stdin, not inherited child environment; persist only the reference. No ambient `TS_*` enrollment or native ChatGPT credential access.
- Support local TUI/server only; remote-server attachment/setup is unsupported. Disconnect saves `enabled: false` and requires full OpenCode restart; assume no server-control RPC and do not promise immediate server shutdown. Forget requires the profile stopped, exclusive lock acquisition, matching ownership marker, safe ownership/permissions and symlink/path validation before confirmed deletion; remote revocation is separate.
- Permit exact optional `@jaxxstorm/bun-tailscale-bridge@0.1.0` with enabled-only loading in the worker. Registry E404/optional absence must not break disabled use. Support a separately installed local tarball via explicit modulePath without committed developer file dependencies, runtime compilation/downloads, or publication. Clean-install behavior remains a verification gate.
- The reviewed local tarball SHA-256 is `a8c6f8d626cc99bb0160f66b848b41d3dc1dd640295bf302e9697067bbac2ab6`; four executable helper entries, MIT and notices are present. Release metadata has a zero commit, so provenance is unverified; npm returns E404 and GitHub releases are empty. Inspection does not verify native helpers. Full feature tests use fake bridge modules and exclusively loopback traffic; real import/helper launch-protocol checks must not enroll or contact a live tailnet.

### Existing Shipped Baseline

- TypeScript implementation in `src/index.ts`, with one runtime root export: the plugin factory.
- Bun builds self-contained ESM to `dist/index.js`, the package entrypoint. Consumers require neither a checkout nor development dependencies or a build step.
- `.opencode/plugins/aperture-codex.ts` is a thin source-development adapter to the shared implementation. Load either the adapter or the built/package entry, never both, including auto-discovery and explicit registrations.
- Discovery runs in the config lifecycle after hooks are registered. The plugin configures native provider `openai` with `<gateway-origin>/codex`; Responses requests go to `/codex/responses`.
- On stock OpenCode 1.18.29, that path avoids the native `/v1/responses` or `/chat/completions` rewrite while retaining native OAuth header injection and HTTP/SSE transport. There is no arbitrary request-matching hook or fetch patch.

These describe the existing shipped baseline, extended only by the authorized bridge target above and current delta specs. Local release-workflow revision checks pass on darwin-arm64; actual CI and publishing remain unverified. Historical bootstrap and prepare-plugin-distribution artifacts describe earlier assumptions and are not current implementation guidance. Do not rewrite those artifacts as part of reconciliation.

The three completed changes were archived under `openspec/changes/archive/2026-09-05-*/`. Five current capabilities are recorded in `openspec/specs/`. The bootstrap's obsolete request-interception and endpoint/debug-variable specification was retained only in history, not promoted to a main spec; the implemented config-only routing and native OAuth boundary are covered by the newer capabilities.

## Boundaries

- Do not implement OAuth, read auth files, persist tokens/account IDs, register auth loaders, replace fetch, import private OpenCode APIs, or maintain a patched host.
- Do not synthesize authentication headers or convert subscription routing into API-key provider behavior. Preserve OpenCode-generated and user-supplied headers; the optional marker is OpenAI-only.
- The gateway receives subscription bearer credentials and request content. Require explicit trust; prefer HTTPS, or an explicitly trusted independently protected network for HTTP.
- WebSockets and residency-sensitive accounts are unsupported. The avoided native rewrite branch currently adds residency headers; do not claim residency enforcement.

## Runtime Configuration

The gateway environment resolution below applies to ordinary bridge-disabled routing. Enabled bridge uses the explicit HTTPS `bridge.gateway` and validated local settings described above; shared discovery/model and sanitized diagnostic rules still apply.

Resolve the first nonempty `APERTURE_HOST`, then nonempty `OPENCODE_APERTURE_HOST`, then `http://ai`. Accept only HTTP/HTTPS origins with an optional trailing slash. Reject malformed URLs, other schemes, credentials, queries, fragments, and non-root paths before discovery. No endpoint override or shell propagation is part of this contract.

Discover `/api/providers` with a 10-second timeout, reject redirects and non-success responses, validate records, and require exactly one provider with `requires_client_auth: true`, `openai_responses: true`, and nonempty model IDs. Reject chat-only and ambiguous catalogs; deduplicate model IDs in stable order. Discovery has no automatic retry and runs again on a new OpenCode initialization.

Preserve explicit default models, including unrelated providers; preserve user model metadata and unrelated OpenAI options/providers. Intersect any existing OpenAI whitelist with discovered IDs. An unavailable explicit OpenAI model or empty intersection is an error, not a substitution. Choose the first allowed discovered model only when no default is set; repeated application must be idempotent.

Only `OPENCODE_APERTURE_DEBUG=1` enables debug. Use allowlisted stage/status/error-category and validated origin/path metadata. Never log raw headers, bodies, account identifiers, OAuth payloads, discovery responses, arbitrary upstream errors, or invalid URLs. Do not collect secrets and rely on redaction after serialization.

## Failure Contract

The plugin routes OpenAI requests through Aperture only when it sets up successfully. When host validation, optional bridge startup, discovery, selection, or configuration fails, it reports a sanitized diagnostic and leaves the user's configuration untouched: it does not disable providers or install a request guard before activation. Requests continue through native OpenCode routing, so setup failure is not fail-closed. Unrelated providers remain usable. After bridge activation, worker/helper failure aborts upstream work and removes the instance capability route without direct fallback; the parent-held ingress remains bound and rejects cached retries until parent exit.

This contract does not cover an absent/unloadable root plugin, conflicting plugins overriding OpenAI auth/fetch/config, or future or untested runtimes, and the plugin is not a process-wide egress or destination-enforcement product. Optional bridge absence is a sanitized enabled-setup failure, not a disabled-path load failure. Missing auth and gateway request errors remain native OpenCode behavior; the plugin adds no retries or credential repair, and only the authorized fixed-upstream bridge path adds request-time relaying. No controlled-egress environment is required for ordinary release; synthetic credential-bearing tests require loopback containment.

Restart after host/config/install changes and after correcting setup errors. Switching from a local adapter requires removing both explicit registration and auto-discovered copies before enabling the package. Removal changes no native credentials and intentionally restores native routing after restart; it is not failure-mode fallback.

## Evidence and Validation

Exact existing baseline: stock OpenCode 1.18.29, Bun 1.3.14, darwin, September 5, 2026. The old local synthetic HTTP 400 probe verified destination/header behavior, not inference completion. Authorized local `gpt-5.6-luna` and `gpt-6-astra` checks returned text only, without independent gateway-log correlation, tool, or refresh evidence.

Required candidate checks: `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, `bun run build`, local pack inspection, clean-consumer loading, packaged routing, and cleanup. Supply the same candidate to package/routing/cleanup scripts through `APERTURE_TEST_TARBALL`; do not repack between release checks and publication. Include workflow lint, release-validation fixtures, and a credential-free publish dry run. Record exact versions/platforms and candidate checksum; distinguish local baseline, packaged checks, CI, and manual latest canary. Local locked install, typecheck, 79 tests, build, packaged routing/cleanup, and actionlint passed on darwin-arm64; exact candidate evidence is in `openspec/changes/archive/2026-09-05-add-release-workflows/tasks.md`.

Release automation accepts stable `vMAJOR.MINOR.PATCH` tags matching the source version, requires reusable Ubuntu/macOS verification, and publishes one verified tarball after required reviewer approval in the `npm` environment. Use GitHub OIDC with npm trust for owner `jaxxstorm`, repository `opencode-aperture`, workflow `release.yml`, environment `npm`, with direct publish allowed and no long-lived token fallback. Only successful npm publication permits the GitHub release and matching tarball/SHA-256 assets. Initial publication may need separately authorized owner authentication before package trust settings exist; subsequent OIDC publication requires a new version/tag. Follow [release setup and recovery](../docs/release.md); never republish existing versions, move released tags, or replace tested bytes. No tags, publication, or account changes are authorized by implementation work.

Tests use isolated synthetic auth through OpenCode's API, bounded lifecycle/cleanup, protocol-valid SSE, tools, cancellation, and concurrency, with synthetic credentials only ever sent to a loopback mock gateway. No fixtures contain real credentials. Unit tests cover invalid host, unreachable/timed-out discovery, malformed and ambiguous catalogs, and non-destructive setup failures. Live tests require explicit trusted-gateway authorization outside CI; observe natural-expiry native refresh with non-secret evidence and subsequent gateway success, never auth-file access or forced expiry. If safe refresh evidence is unavailable, keep it unverified and messaging experimental.

See [installation](../README.md), [verification](../scripts/README.md), [compatibility](../docs/compatibility.md), [live procedure](../docs/live-validation.md), and [release gates](../docs/release.md).
