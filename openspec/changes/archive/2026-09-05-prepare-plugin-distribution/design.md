## Context

The current private package loads `.opencode/plugins/aperture-codex.ts`, which imports repository-relative helpers and discovers providers during plugin initialization. It lacks a built public entrypoint, package-content controls, a consumer install test, and CI. The initial project guidance still describes an assumed request-rewrite hook and different environment variables; the actual working plugin configures the native OpenAI provider.

On stock OpenCode 1.18.29, its OAuth fetch refreshes credentials and injects headers before rewriting paths containing `/v1/responses` or `/chat/completions`. Configuring `/codex` causes the Responses SDK to request `/codex/responses`, avoiding that rewrite. Synthetic tests verified the request path and headers, and authorized live runs returned text from `gpt-5.6-luna` and `gpt-6-astra`. These results do not establish token refresh, tool calls, residency handling, or WebSocket support.

OpenCode can swallow initialization and config-hook errors. Startup failure therefore needs testing through stock OpenCode, not just a unit assertion that a helper throws. Consumers also need to understand that the gateway receives subscription credentials and that this is a version-sensitive workaround, not a supported upstream transport hook.

## Goals / Non-Goals

**Goals:**

- Install and load a self-contained package without this checkout or developer dependencies.
- Keep the production plugin configuration-focused, with native OpenCode OAuth and HTTP/SSE transport.
- Bound discovery, preserve user intent, and avoid accidental provider selection, with non-destructive behavior when setup fails.
- Ship safe, reproducible checks for the package actually distributed, plus accurate compatibility and live-test evidence.

**Non-Goals:**

- OAuth implementation, token inspection, direct auth-file access, or plugin-owned identity persistence.
- Custom auth loaders, global fetch interception, private OpenCode imports, or patched OpenCode distributions.
- API-key routing, gateway implementation, WebSocket support, or residency-header synthesis.
- Automatic publication, registry credential setup, or selecting a legal license without owner approval.

## Decisions

### 1. One packaged entrypoint and one development adapter

Move the plugin implementation into `src/index.ts`, exporting only the plugin factory from the package root. Keep helpers in their existing module rather than exporting runtime helper functions alongside the factory: OpenCode's legacy loader can interpret every export as a plugin. Use type-only imports from a compatible public `@opencode-ai/plugin` release to check hook shapes without pulling its SDK into production runtime imports.

Build self-contained ESM JavaScript into `dist/` using Bun. Declare the package entrypoint and an explicit publish allowlist containing the build and user documentation, with approved license material before publication. No postinstall hook or consumer-side build is needed. Keep the existing package name provisionally; registry ownership is a release prerequisite, not an assumption.

The local `.opencode/plugins/aperture-codex.ts` becomes a thin adapter to the same implementation. Document only one installation mechanism at a time so consumers do not load both the local adapter and package. Test the packed tarball in a temporary consumer directory, through OpenCode's package loading path, with no references back to source files.

Alternative: distribute the existing hidden TypeScript tree directly. Rejected because it couples package layout to repository paths and does not prove ordinary installation works.

### 2. Preserve the native OAuth transport boundary

Continue using provider ID `openai` and the native Responses SDK, setting `provider.openai.options.baseURL` to the validated gateway origin plus `/codex`. Never set API keys, replace fetch, register an auth loader, or read auth storage. OpenCode owns login, refresh, persistence, and auth/account/session headers. The optional plugin marker applies only to OpenAI requests and never overwrites existing auth or session headers.

HTTP/SSE on stock 1.18.29 is the initial supported baseline. Compatibility records list exact tested versions rather than claiming an open-ended minimum-version guarantee. Other plugins replacing OpenAI auth/fetch or overriding the gateway config, an absent/unloadable plugin, and future upstream changes are outside the tested fallback guarantee and must be documented.

Alternative: global fetch interception or a custom auth loader. Rejected because the existing route works and these expand identity responsibility and process-wide effects.

### 3. Keep the existing host contract, but validate it

Retain precedence `APERTURE_HOST`, then `OPENCODE_APERTURE_HOST`, then `http://ai`. Accept HTTP and HTTPS origin URLs with an optional trailing slash. Reject malformed URLs, unsupported schemes, userinfo, query strings, fragments, and non-root paths before any discovery request. Requiring an origin avoids silently discarding reverse-proxy path prefixes. Document HTTP as suitable only for an explicitly trusted protected network; do not claim transport encryption from the hostname.

Discovery uses `/api/providers`, a 10-second timeout, and no automatic retries. Reject redirects so discovery cannot silently switch gateway origin. Validate the response as an array of provider records with nonempty IDs, boolean capability flags, and nonempty string model IDs. Eligible providers require `requires_client_auth: true` and `openai_responses: true`. Exactly one eligible provider is required; zero or multiple candidates produce an actionable error. Model IDs are deduplicated in stable order. Explicit multi-provider selection is deferred until needed.

Keep `OPENCODE_APERTURE_DEBUG=1` as the actual debug switch. Remove the inert `OPENCODE_APERTURE_CODEX_ENDPOINT` assignment and shell propagation rather than advertise it as a supported override. Update active project guidance to distinguish this actual contract from the historical bootstrap assumptions.

Alternative: accept arbitrary URL components and pick the first provider. Rejected because ignored paths, hidden credentials, and nondeterministic provider selection are unsafe installation defaults.

### 4. Preserve explicit configuration and contain startup failures

Preserve an explicit `config.model`, including unrelated provider models. Only choose the first allowed discovered OpenAI model when no default is configured. An explicit OpenAI model excluded by discovery or an existing whitelist produces a clear error instead of silently choosing a replacement. Populate discovered model entries without overwriting user overrides; preserve unrelated providers and OpenAI options other than the routing fields required by this plugin. Intersect an existing OpenAI whitelist with the discovered model IDs; an empty intersection is a configuration error. Applying configuration twice must be idempotent.

Return hooks before performing discovery so network failure does not prevent registration. Perform setup in the config lifecycle. When setup fails, leave the user's configuration untouched: do not disable providers, do not throw from request hooks, and report only a sanitized diagnostic. Requests then continue through native OpenCode routing. Preserve unrelated providers. Do not rely on a thrown initialization/config exception alone.

Missing authentication and request-time gateway 401/403/429/5xx errors remain native OpenCode errors. No plugin-managed retries, response buffering, credential repair, or request-time interception is added. Discovery is retried only on a new OpenCode initialization, not on every chat turn.

Alternative: throw from the factory and assume startup stops. Rejected because the host may log and ignore plugin errors. Alternative: disable the OpenAI provider or block its requests on setup failure. Rejected because a setup or gateway problem should not break the user's existing OpenAI configuration; the plugin simply routes through Aperture when it can.

### 5. Log allowlisted metadata, not raw objects

Diagnostics use stage/status/error-category fields and validated origin/path metadata. Debug is off unless its value is exactly `1`. Never log headers, bodies, raw provider responses, auth records, arbitrary upstream error bodies, or raw invalid URLs. Keep errors actionable without echoing userinfo or query data. Test both normal and failure logging with synthetic secret sentinels. Supported hook shapes are checked with public types and exercised with debug enabled through stock OpenCode.

Alternative: serialize then redact arbitrary objects. Rejected as broader and easier to get wrong than not collecting sensitive material.

### 6. Test the distributed artifact and distinguish evidence levels

Use a locked development dependency graph and typecheck production, adapters, tests, and scripts. Keep deterministic unit tests for host/discovery/config/header/logging contracts. Extend the Bun harness to install the tarball into an isolated consumer with isolated HOME/XDG state and synthetic auth registered through OpenCode's API. Test real stock OpenCode, not a copied rewrite predicate.

Provide a minimal protocol-valid Responses SSE fixture for text and tool-call round trips, a harmless deterministic tool fixture, delayed streams for abort tests, and correlated concurrent sessions. Bound subprocess lifetime and waits; clean up on success, failure, and handled termination. Capture sanitized diagnostics rather than dumping logs. Verify status/event errors, not only CLI exit codes. Synthetic credentials are only ever sent to a loopback mock gateway.

CI runs unit/type/build/pack checks and the packaged routing suite against pinned stock OpenCode 1.18.29. A scheduled or manually dispatched latest-version canary reports compatibility drift separately; only passing versions enter the compatibility table. Initial platform claims are limited to environments actually exercised.

Live tests are opt-in, use a separately confirmed trusted gateway, invoke native OpenCode authentication without reading it, and never run in normal CI. Record gateway-correlated text/tool results where accessible. To evaluate refresh, repeat an authorized native session across natural credential expiry and use sanitized native refresh events or other non-secret evidence; never edit real auth storage to force expiry. If refresh cannot be observed safely, label it unverified and keep release messaging experimental rather than invent coverage.

Alternative: rely on five helper tests and the existing HTTP 400 probe. Rejected because they do not validate the packed module, returned streaming data, or tool results.

## Risks / Trade-offs

- Internal OpenCode path matching can change -> Pin the tested baseline, run a packaged canary, and document upgrade checks; do not promise arbitrary-version compatibility.
- OpenCode swallows plugin failures or the runtime changes -> The plugin reports sanitized setup diagnostics and leaves native configuration intact, so a setup problem degrades to ordinary OpenCode behavior rather than breaking connections.
- Gateway credentials travel over HTTP in the user's current setup -> Explain the trust boundary and prefer HTTPS or an independently protected network; never silently change the user's endpoint.
- Native residency headers are skipped on the non-rewritten path -> Explicitly exclude residency-sensitive account support pending separate work.
- WebSockets bypass the tested HTTP behavior -> Keep them disabled in verification and outside initial support claims.
- Model catalogs and native filters evolve -> Test explicit model preservation and discovery with both known and new synthetic IDs, and record live model evidence separately.
- Licensing/registry access is unknown -> Prepare and test tarballs locally; do not publish or invent license terms.
- Existing bootstrap artifacts conflict with current implementation -> Update active project guidance under this change while retaining historical change artifacts as history.

## Migration Plan

1. Keep the local development adapter working while moving implementation to the package entrypoint.
2. Harden discovery/configuration and verify failure containment before claiming distribution readiness.
3. Build and install the tarball into an isolated consumer and run the full synthetic compatibility suite.
4. Document package installation, native OpenAI subscription login, host/debug variables, exact tested versions, and limitations; replace obsolete active guidance.
5. Before a real release, obtain package-name and license approval, inspect package contents, and record verification results. Publishing requires a separate explicit action.
6. Existing users remove the repository-local plugin registration/auto-discovered adapter when switching to the package, add the version-pinned package entry, and restart OpenCode. Do not load both forms.

Rollback is removing the package registration and restoring any user-selected provider configuration, then restarting OpenCode. Plugin configuration mutations are runtime-only and no plugin-owned auth state needs migration or cleanup. Removing the plugin intentionally restores native routing; it is not a failure-mode fallback.

## Open Questions

- Which license and registry namespace does the owner approve? Both are publication gates, not blockers to local implementation and tarball tests.
- Can native refresh be observed without inspecting credentials on the available test account? Until demonstrated, report it as unverified.
