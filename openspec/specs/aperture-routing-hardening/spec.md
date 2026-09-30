# aperture-routing-hardening Specification

## Purpose

Define validated Aperture gateway discovery and routing that preserve native OAuth ownership, user configuration, and credential safety without destructive setup failures.

## Requirements

### Requirement: Validated gateway origin

Bridge-disabled routing SHALL resolve nonempty `APERTURE_HOST`, then nonempty `OPENCODE_APERTURE_HOST`, then `http://ai`, accepting HTTP/HTTPS origins with optional trailing slash. Enabled managed bridge routing SHALL instead require explicit trusted `bridge.gateway` from local shared settings and SHALL accept HTTPS only. Both modes SHALL reject malformed URLs, userinfo, query, fragment and non-root paths before contact without echoing invalid values.

#### Scenario: Host precedence
- **WHEN** the bridge is disabled and both host environment variables are valid
- **THEN** discovery and inference use APERTURE_HOST as before

#### Scenario: Enabled bridge gateway
- **WHEN** bridge setup selects an HTTP or secret-bearing gateway URL
- **THEN** validation fails before bridge startup or network contact and leaves native configuration unchanged with sanitized diagnostics

#### Scenario: Invalid or secret-bearing URL
- **WHEN** either mode selects a malformed or prohibited origin
- **THEN** initialization fails without contacting or echoing that URL

### Requirement: Bounded subscription Responses discovery

Discovery SHALL complete or fail within a 10-second request timeout, SHALL reject redirects and unsuccessful HTTP responses, and SHALL validate the provider response shape. Selection SHALL require exactly one provider with client authentication enabled, Responses compatibility enabled, and a nonempty list of nonempty string model IDs. Duplicate model IDs SHALL be removed while preserving order.

#### Scenario: One eligible provider
- **WHEN** discovery returns exactly one eligible provider among valid noneligible providers
- **THEN** the plugin selects it and uses its ordered unique model IDs

#### Scenario: Unsupported or ambiguous providers
- **WHEN** discovery returns no eligible providers, only chat-compatible providers, or multiple eligible providers
- **THEN** the plugin reports a selection failure rather than choosing an arbitrary provider

#### Scenario: Invalid discovery response
- **WHEN** discovery returns invalid JSON, an invalid provider shape, a redirect, or an unsuccessful HTTP status
- **THEN** setup fails with a bounded sanitized diagnostic without logging the raw response

#### Scenario: Gateway does not respond
- **WHEN** the discovery request stalls
- **THEN** the request is aborted at the configured 10-second limit without automatic discovery retries

### Requirement: Preserve model selection and unrelated configuration

The plugin SHALL preserve explicit default-model selections, user model overrides, unrelated providers, and OpenAI options unrelated to required gateway routing. It SHALL limit OpenAI models to discovered IDs intersected with any existing whitelist. It SHALL select the first allowed discovered model only when no default model exists. Reapplying its configuration SHALL be idempotent.

#### Scenario: Explicit discovered OpenAI model
- **WHEN** the user selects `openai/gpt-6-astra` and it is discovered and allowed
- **THEN** the plugin retains that selection even if another model is listed first

#### Scenario: Unrelated default provider
- **WHEN** the user's default model belongs to another provider
- **THEN** the plugin leaves that default and the other provider's configuration unchanged

#### Scenario: User selection is unavailable
- **WHEN** an explicit OpenAI model is outside the allowed discovered set or the whitelist intersection is empty
- **THEN** the plugin reports a configuration error rather than silently substituting a model

#### Scenario: Default selection respects whitelist
- **WHEN** no default is configured and a whitelist permits only a subset of discovered models
- **THEN** the first discovered model in that permitted subset becomes the default

#### Scenario: Repeated config application
- **WHEN** equivalent setup is applied twice to a configuration with custom model metadata and unrelated options
- **THEN** the second application does not alter the result or discard those overrides

### Requirement: Native OAuth routing and scoped headers

Managed upstream transport SHALL run in the separate verified worker described by `optional-tailscale-bridge`, external Bun by default with explicit absolute executable or one-time PATH resolution, allowlist exactly 1.4.2, and optionally the same future child via `process.execPath` with child-only `BUN_BE_BUN=1` only after verification. Parent owns native `chat.headers` capability injection and shared raw HTTP ingress; node:http streams to worker-only Unix sockets in short parent-created private 0700 directories. Only the worker performs HTTPS/CONNECT through the bridge proxy, never the embedded parent. No silent runtime fallback, semver-only acceptance, automatic in-process upstream transport, or secrets in child env/argv/config URLs SHALL occur. Explicit authKeyEnv is resolved locally and sent transiently over private stdin only. Actual Bun/protocol and transport smoke SHALL be checked before activation; host and worker evidence SHALL be distinguished.

On the documented supported OpenCode runtime with native subscription authentication, ordinary routing SHALL configure the trusted gateway's `/codex` base URL so Responses requests reach `/codex/responses`. OAuth login, refresh, persistence, and auth-header injection SHALL remain exclusively OpenCode-owned. The plugin SHALL NOT implement OpenAI auth loaders, replace native auth fetch, patch global fetch, use private APIs, read auth files, or persist OpenAI/ChatGPT identity data. Explicitly enabled managed bridge operation SHALL permit separately protected bridge-owned Tailscale node state and a verified parent-owned numeric-loopback ingress on a random port: untouched native OAuth -> parent ingress -> private Unix HTTP -> worker -> bridge HTTP/CONNECT forward proxy -> fixed validated HTTPS gateway. The ingress SHALL NOT be `bridge.httpProxyURL()`. It SHALL forward native auth headers unchanged without parsing, persistence, or logging; preserve original-upstream TLS verification, SSE completion, cancellation, bounded backpressure/cleanup, and native retries; reject all upstream redirects; and never fall back directly. Global proxy/environment mutation remains prohibited. Same-user/root compromise is not defended.

Relay authentication SHALL use an independent random capability in a private runtime header injected only for activated OpenAI inference, never URLs, provider options, config/provider APIs, transcripts, logs, telemetry, or persistence. The baseURL SHALL be secret-free and proxy credentials SHALL remain separate private runtime secrets. Only exact `POST /codex/responses` origin-form requests with the expected numeric-loopback Host and no Origin SHALL be accepted. Missing/incorrect capability, Host/Origin/absolute-target abuses, and client-selected destinations SHALL be rejected before forwarding. Relay/proxy credentials and hop-by-hop headers including Connection nominations SHALL be removed on outgoing legs; nominations of required native headers SHALL cause rejection. Any plugin marker SHALL be OpenAI-only and preserve existing auth/session values. Public hook capability scoping/secrecy, installed native composition, embedded runtime, private UI, and disposal safety SHALL be evidence gates, not assumptions.

#### Scenario: Native OAuth request reaches gateway
- **WHEN** a supported OpenCode instance issues an OpenAI Responses request with synthetic OAuth credentials
- **THEN** the gateway receives `/codex/responses` with OpenCode's bearer, account, session, originator, user-agent, and applicable content headers intact

#### Scenario: Other provider request
- **WHEN** a request belongs to a non-OpenAI provider
- **THEN** the plugin leaves its destination and request headers unchanged and does not add its marker

#### Scenario: Separate bridge enrollment
- **WHEN** the user enrolls a managed Tailscale node
- **THEN** only bridge-owned private node state is persisted and native subscription credentials and login behavior remain untouched

#### Scenario: Private relay capability
- **WHEN** the supported host sends activated native OpenAI inference through the relay
- **THEN** only that request receives the private capability header, the baseURL/config/provider APIs expose no capability, and the relay removes it before forwarding
- **AND** requests missing the capability fail before forwarding, while unrelated providers and OAuth login/refresh remain unchanged

### Requirement: Non-destructive setup failures

Runtime selection, worker protocol and transport smoke failures SHALL be setup failures before activation, with bounded cleanup and no silent mode fallback. One parent-owned shared unref'ed raw HTTP ingress port SHALL remain bound until parent exit, not worker or instance disposal. Unexpected worker EOF/exit SHALL invalidate readiness, remove its capability route, abort/503 or close in-flight work, and reject later removed-capability requests with 403 without forwarding. Other UIDs SHALL be unable to reuse the still-bound native TCP port or replace the worker Unix endpoint inside the parent-created 0700 private directory, including the race between liveness checking and connect. Capability invalidation alone is insufficient. These guarantees SHALL be verified before production support claims; design authorization is not proof.

The plugin SHALL route OpenAI requests through a trusted gateway only when setup completes successfully. When host validation, optional bridge configuration/loading/enrollment/startup, discovery, selection, or configuration fails, the plugin SHALL leave native configuration unchanged, SHALL NOT disable providers or install a request guard before activation, and SHALL report only sanitized diagnostics. It SHALL close partial bridge/Unix resources without closing a shared ingress still owned by the parent. Unrelated providers SHALL remain usable. Documentation SHALL identify root plugin load failures, conflicting plugins, and untested versions as outside support scope, distinguish optional bridge setup failures, and disclose that unsuccessful setup can leave direct native OpenAI routing available. After activation, bridge failure or instance disposal SHALL stop upstream work and invalidate proxy credentials/routes without direct fallback or stale proxy reuse. Bounded per-instance cleanup SHALL retain the parent ingress until parent exit, even with no routes, so cached retries cannot deliver native headers to a reused port. Saved TUI disconnect SHALL require full OpenCode restart and SHALL NOT assume server-control RPC. Per-request cleanup SHALL NOT close shared ingress or other instance routes; ingress SHALL NOT prevent natural parent exit.

#### Scenario: Discovery fails during startup
- **WHEN** a configured OpenAI session starts while discovery is unavailable or malformed
- **THEN** the plugin logs a sanitized setup diagnostic and leaves native OpenAI routing unchanged
- **AND** no plugin crash, disabled provider, or request-blocking error is introduced

#### Scenario: Gateway returns a request error
- **WHEN** the selected gateway responds with 401, 403, 429, or 5xx
- **THEN** OpenCode surfaces the failure using its native error/retry behavior
- **AND** the plugin neither repairs credentials nor intercepts requests beyond the verified fixed-upstream reverse relay; native error/retry ownership remains unchanged
- **AND** an activated bridge route remains selected for native gateway retries

#### Scenario: Optional bridge cannot load
- **WHEN** enabled setup cannot load the optional bridge or its helper
- **THEN** a sanitized bridge setup error leaves native configuration unchanged and no partial helper remains

#### Scenario: Relay retained after bridge failure
- **WHEN** an activated bridge fails or its instance is disposed while native runtime requests or retries may still occur
- **THEN** the relay stays bound but rejects requests without forwarding or direct fallback
- **AND** the affected capability route is removed with bounded worker/Unix cleanup but the shared unref'ed listener stays bound until parent exit, preserving unrelated instance routes

### Requirement: Credential-safe optional diagnostics

Debug diagnostics SHALL be enabled only by `OPENCODE_APERTURE_DEBUG=1`. Plugin logs and errors SHALL exclude authorization values, account identifiers, OAuth payloads, request headers/bodies, and raw invalid URLs or discovery response bodies. They SHALL also exclude relay capabilities, Tailscale enrollment keys, login URLs, node identity data, proxy URLs/passwords, LocalAPI credentials, raw helper transcripts, and raw native proxy/TLS exceptions. Enrollment URLs SHALL appear only in the explicit private enrollment UI, not diagnostics. Logging SHALL work with the supported public hook shape.

#### Scenario: Debug mode is disabled
- **WHEN** the debug variable is absent or differs from `1`
- **THEN** no plugin debug messages are emitted

#### Scenario: Debug mode with sensitive fixtures
- **WHEN** discovery and chat hooks execute with debug enabled and synthetic secrets in headers or malformed responses
- **THEN** the hooks do not crash and emitted diagnostics contain none of the synthetic secret values

#### Scenario: Sensitive bridge failure
- **WHEN** a bridge or native proxy exception contains a synthetic key, proxy URL, or enrollment URL
- **THEN** only an allowlisted sanitized error category is reported and none of those values appear in logs or status output
