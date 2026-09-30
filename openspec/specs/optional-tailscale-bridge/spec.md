# optional-tailscale-bridge Specification

## Purpose

Define explicitly enabled Tailscale bridge configuration, private enrollment and state, isolated worker transport, native gateway routing, and bounded lifecycle while preserving native OAuth ownership and evidence-gated support claims.

## Requirements

### Requirement: Separate verified transport worker

Upstream proxy/TLS transport SHALL remain in a distinct worker process, with parent-owned native OpenAI-only `chat.headers` capability closure and shared raw HTTP ingress. The parent SHALL stream via `node:http` to a worker-only Unix socket in a short parent-created owner-private 0700 directory; the embedded parent SHALL NOT perform CONNECT. Only the child SHALL perform HTTPS through the real bridge proxy. External Bun SHALL be the default mode, with a nonsecret explicit absolute executable or one-time PATH resolution to an absolute path. Explicit future embedded mode SHALL launch the identical worker/protocol via `process.execPath` with child-only `BUN_BE_BUN=1` only after verification. Actual Bun identity/version (allowlist exactly 1.4.2), protocol and bounded streamed HTTPS CONNECT/cancellation smoke SHALL pass before readiness/activation; discovery/model validation SHALL also precede activation. Missing executables, bad paths, incompatible/unverified runtimes, protocol mismatch or smoke timeout/failure SHALL NOT trigger silent fallback across paths/modes. Newer semver SHALL NOT imply verification. No shell launch, runtime download or global environment mutation SHALL occur. Evidence SHALL record host embedded Bun separately from selected worker executable/mode/actual Bun and require the installed native HTTPS matrix, not just standalone differential success. The real bridge factory SHALL use this same worker boundary; synthetic transport SHALL NOT be described as implemented Tailscale.

#### Scenario: External worker selected
- **WHEN** external Bun is resolved or explicitly selected
- **THEN** a separate worker passes runtime/protocol/transport checks before native route activation, with exact executable and host/worker versions recorded

#### Scenario: Incompatible embedded runtime
- **WHEN** explicit embedded mode fails streamed CONNECT or cancellation checks, including the recorded 1.3.14 candidate
- **THEN** setup cleans up unpublished resources before route/capability activation, leaves native configuration unchanged and does not fall back to external Bun

#### Scenario: Future embedded runtime
- **WHEN** a later OpenCode executable is explicitly selected
- **THEN** the same separate worker/protocol must pass identical capability checks and installed native HTTPS tests regardless of newer version ordering

### Requirement: Private supervised worker protocol

Parent and worker SHALL use private piped stdin/stdout with versioned bounded JSON lines: a worker hello validated before sending any startup bytes, exactly one startup request containing private transport inputs, and one correlated ready response after checks. The worker SHALL generate an independent cryptographically random relay capability and return it privately in ready. Correlation SHALL use the single-worker protocol state and matching protocol/runtime. Stdout SHALL be protocol only; raw child/helper logs and exceptions SHALL NOT be forwarded or persisted, and stderr SHALL be bounded and drained without exposing raw contents. Schemas, bytes/lines/message counts, buffering and startup/shutdown SHALL have tested finite bounds. Malformed, oversized, duplicate, unknown or out-of-order messages SHALL fail with allowlisted diagnostics. Secrets SHALL NOT enter child env, argv, config URLs, logs or persistence; an explicitly referenced user environment auth key SHALL be passed privately over stdin only. Ready SHALL report a Unix endpoint validated within the parent-created private directory and necessary private correlation/nonsecret runtime metadata, never an arbitrary worker TCP destination. Native application headers/bodies SHALL NOT enter control messages. A close request acknowledged by process exit (no explicit closed frame), abort, EOF/exit and termination escalation SHALL be supervised with bounded cleanup and readiness/capability route invalidation, without direct fallback, runtime switching or restart-in-place. Parent EOF SHALL be a crash-cleanup backstop, not a reason to close a surviving parent's shared ingress.

The focused implementation bounds control lines to 64 KiB and supervisor output to 512 KiB per stream, with strict runtime/frame checks and allowlisted events. Children SHALL disable dotenv and project preloads using `--no-env-file --config=/dev/null`, worker-directory cwd and PATH-only environment plus child-only BUN_BE_BUN in embedded mode. The current exact-version allowlist is `VERIFIED_TRANSPORT_BUN_VERSIONS = ["1.4.2"]`; extension SHALL require exact-version differential/native checks, not semver ordering. Synthetic startup supplies fixture certificate/key privately for pre-ready streamed HTTPS CONNECT and reader-cancellation smoke followed by independent proxied discovery. This SHALL NOT imply a production OpenSSL dependency or completed bounded-memory/backpressure stress proof.

#### Scenario: Protocol or startup failure
- **WHEN** startup times out or worker output is malformed, oversized, duplicated or incompatible
- **THEN** the parent invalidates readiness/capability, performs bounded partial cleanup and reports only a sanitized category without native activation or mode fallback

#### Scenario: Unexpected worker death
- **WHEN** an activated transport worker exits unexpectedly or its pipe reaches EOF
- **THEN** the parent invalidates readiness and removes that capability route, aborts in-flight work with sanitized 503 or connection closure, and returns 403 for subsequent old-capability requests without forwarding
- **AND** its shared native-facing TCP listener stays bound until parent exit, while private Unix directory protection prevents another UID from replacing the worker endpoint during the liveness/connect race

### Requirement: Explicit optional configuration

The bridge SHALL be disabled by default. Local TUI and server SHALL share `${XDG_CONFIG_HOME:-~/.config}/opencode-aperture/settings.json` with `version: 1` and nonsecret `bridge: { enabled, gateway, hostname, stateDir, runtime: { mode, executable? }, modulePath?, authKeyEnv?, startupTimeoutMs }`, independently of native OpenAI credentials. Enabled gateway SHALL be an explicit trusted HTTPS origin without userinfo/query/fragment/non-root path. stateDir SHALL be absolute private owned state outside project/package trees; modulePath, if supplied, SHALL be an absolute trusted separately installed JavaScript entry. authKeyEnv SHALL be a valid explicit environment-variable name, never a key value. Missing configuration SHALL retain existing behavior. Invalid types, unknown versions/fields, blank hostnames, unsafe paths, and noninteger timeouts or values outside 1 through 300000 milliseconds SHALL fail before helper startup. The default startup timeout SHALL be 60000 milliseconds. Existing gateway environment precedence SHALL remain unchanged for bridge-disabled routing. Remote server attachment/setup SHALL be unsupported, with no assumed RPC or shared filesystem.

#### Scenario: Default installation
- **WHEN** bridge configuration is absent or disabled, including when its optional package is not installed
- **THEN** the plugin performs existing ordinary gateway setup without importing the bridge, starting helpers, prompting for enrollment, or creating node state

#### Scenario: Invalid bridge configuration
- **WHEN** an enabled configuration has an invalid field or unsafe state path
- **THEN** setup reports a sanitized validation failure without launching a helper or mutating native configuration

### Requirement: Private OpenCode enrollment UX

The optional local TUI SHALL provide `/aperture-setup`, `/aperture-status`, `/aperture-disconnect`, and `/aperture-forget` as explicitly invoked commands opening private dialogs through public host interfaces, never model tools. Setup SHALL show the HTTPS gateway and trust implications and offer browser enrollment with URL displayed only in private `DialogAlert`, or input of an explicit user-owned `authKeyEnv` reference. Because public `DialogPrompt` cannot mask, it SHALL NOT prompt for an unmasked key value. The user's referenced key SHALL be resolved transiently and sent via private control stdin, never inherited by children; only its variable name may be saved. This replaces the earlier masked key-input requirement while preserving explicit user-credential enrollment. Secrets and enrollment URLs SHALL NOT enter model context, chat transcripts, ordinary logs, settings, argv, or child environments. Saving nonsecret settings SHALL be atomic and owner-only. Startup SHALL NOT prompt interactively. Native ChatGPT credentials SHALL never be read or persisted and native login SHALL remain separate and unchanged.

#### Scenario: Browser enrollment
- **WHEN** the user explicitly chooses browser enrollment for new state
- **THEN** the enrollment URL is shown only in a verified private interactive surface and startup is bounded and cancellable
- **AND** completion saves only nonsecret settings and bridge-owned private node state and instructs the user to restart OpenCode

#### Scenario: Auth-key enrollment
- **WHEN** the user supplies an explicit environment-variable name through a private setup dialog
- **THEN** only that reference is saved and its resolved key is passed transiently to bridge enrollment, never saved, echoed or inherited by children, and never reused as an OpenAI credential
- **AND** a missing referenced value produces a sanitized setup-required error without a fallback unmasked key prompt or ambient `TS_*` enrollment

#### Scenario: Setup cancellation
- **WHEN** the user cancels enrollment or its deadline expires
- **THEN** helper work is closed, saved settings remain unchanged, and only a sanitized status is displayed

#### Scenario: Headless enrollment is missing
- **WHEN** enabled startup has no reusable enrollment, no usable explicit authKeyEnv, and no explicit interactive setup underway
- **THEN** setup returns a bounded setup-required diagnostic without waiting for UI input

### Requirement: Private reusable Tailscale state

The integration SHALL reuse enrolled state before requesting enrollment, delegate identity storage to the bridge, and enforce owner-only directories/files and exclusive state locking. State SHALL remain outside project and package trees. The plugin SHALL NOT persist enrollment keys, proxy credentials, login URLs, or application tokens. Ambient Tailscale environment settings SHALL NOT implicitly configure enrollment.

#### Scenario: Reuse enrollment
- **WHEN** OpenCode restarts with enabled configuration and valid enrolled state
- **THEN** the same node identity is reused without another key or browser prompt

#### Scenario: Unsafe or locked state
- **WHEN** state has unsafe ownership, permissions, symlinked locations, or is locked by another process
- **THEN** setup fails safely without changing permissions, taking over the lock, or damaging state

#### Scenario: Disconnect and forget
- **WHEN** the user disconnects
- **THEN** saved enablement becomes false without deleting identity or dynamically switching active requests to direct routing
- **AND** full OpenCode restart is required; the local TUI does not assume server-control RPC or promise immediate shutdown of an active server helper
- **WHEN** the user separately confirms forgetting a stopped profile and an exclusive lock, matching owner marker, ownership/permissions and safe nonsymlinked path are verified
- **THEN** only that profile's local state is removed under the lock and the UX explains separate remote node/key revocation
- **AND** an active lock or missing/mismatched owner marker causes refusal, never arbitrary directory deletion

### Requirement: Native gateway-scoped proxy routing

Enabled successful setup SHALL route discovery through the bridge's authenticated HTTP/CONNECT forward proxy. Native subscription Responses requests, including native retries, SHALL use untouched native OAuth fetch -> shared parent numeric-loopback raw HTTP ingress on an OS-assigned random port -> node:http private Unix streaming -> worker -> bridge forward proxy -> fixed validated HTTPS gateway `/codex/responses`. The ingress SHALL NOT be confused with `bridge.httpProxyURL()` or accept client-selected upstreams. The worker SHALL preserve original upstream hostname and TLS verification/SNI; both HTTP legs SHALL preserve native application headers, discovery/model policy, HTTP/SSE completion, independent cancellation, and bounded backpressure/cleanup. OpenCode SHALL exclusively own ChatGPT login, refresh, persistence, and auth-header injection. Native auth headers SHALL only be forwarded as opaque values, never parsed, persisted, or logged. The integration SHALL NOT register OpenAI auth loaders, replace native auth fetch, patch global fetch, use private APIs, mutate global proxy/environment settings, bridge unrelated providers or OAuth enrollment/refresh, or follow upstream redirects. Same-user/root compromise is outside the threat model.

An independent cryptographically random per-runtime relay capability SHALL be injected through a verified private runtime header scoped only to activated OpenAI inference. Relay capability and proxy credentials SHALL remain separate from application authentication and each other, only in private runtime memory, never in URLs, provider options, config/provider APIs, transcripts, logs, telemetry, or persistence. The baseURL SHALL contain no secret. The relay SHALL reject missing/incorrect capability before forwarding, accept only exact origin-form `POST /codex/responses` with its exact numeric-loopback Host authority and no Origin, and reject absolute targets, ambiguous/duplicate Host, and other Host/Origin/method/path abuses. It SHALL strip relay/proxy credentials and hop-by-hop headers including Connection nominations on both legs, regenerate upstream Host from configuration, and reject nominations of required native headers rather than changing their semantics. Proxy authentication SHALL only reach the forward proxy; relay capability SHALL never reach it or the gateway.

#### Scenario: Discovery and Responses traverse the proxy
- **WHEN** a supported host completes setup and a subscription inference request against an isolated fixture
- **THEN** both requests demonstrably traverse the authenticated proxy with the original destination and `/api/providers` or `/codex/responses` path respectively
- **AND** native application Authorization passes opaquely through the relay to the fixed gateway, the relay capability stops at the relay, and proxy credentials reach only the forward proxy

#### Scenario: TLS or redirect violation
- **WHEN** the destination certificate is invalid or an upstream request returns any redirect
- **THEN** the request fails without disabling certificate verification, exposing credentials to the new destination, or retrying directly

#### Scenario: Unrelated traffic
- **WHEN** another provider or native OAuth login/refresh sends a request
- **THEN** the bridge configuration does not alter its route, authentication, or headers

#### Scenario: Unauthenticated or abusive relay request
- **WHEN** a request lacks the correct capability or uses an invalid Host, Origin, absolute target, method, or path
- **THEN** the relay rejects it before forwarding and no client input can select a different upstream

#### Scenario: Connection-nominated headers
- **WHEN** a relay request or upstream response includes hop-by-hop headers or Connection nominations
- **THEN** they and relay/proxy credentials are removed from the outgoing leg
- **AND** a nomination conflicting with required native headers causes rejection rather than credential or header corruption

### Requirement: Bounded lifecycle without direct fallback

The parent SHALL own one shared numeric-loopback raw HTTP ingress TCP port until parent exit, with per-instance private capability route mapping. It SHALL unref the listener so it does not block process exit. Worker death or instance disposal SHALL remove only the affected route, never close or rebind the parent port. Cached native retries SHALL therefore reach a rejecting parent rather than an other-UID replacement listener. Workers SHALL listen only on Unix sockets in short parent-created private 0700 owned directories; this protection SHALL cover worker death between liveness check and connect, not rely solely on capability getter checks. Same-user/root compromise and clients retaining credentials beyond native parent lifetime are out of scope. These required production guarantees SHALL be tested; design approval and synthetic worker cleanup alone SHALL NOT establish them.

The plugin SHALL own at most one active helper/worker per runtime/profile, reuse it across configuration reapplication and concurrent requests, and preserve response consumption with bounded buffering and cancellation cleanup. Discovery SHALL retain its separate 10-second timeout. After activation, bridge failure or runtime disposal SHALL abort upstream work and invalidate/release proxy credentials within a bounded deadline without reconnecting to a stale proxy port or switching to direct traffic. In-flight failures SHALL return sanitized 503 where possible or close; removed/missing capabilities SHALL return 403 without forwarding. Instance disposal SHALL release its worker, Unix resources, locks and route with bounded cleanup while the shared ingress remains bound even when empty, until parent exit. Per-request cancellation SHALL NOT close shared ingress or unrelated instance routes. Listener/socket management SHALL permit natural parent exit and SHALL NOT accumulate shutdown handlers. Saved TUI disconnect SHALL require full OpenCode restart rather than assuming immediate RPC shutdown. Failed setup SHALL close unpublished owned resources and retain non-destructive native-routing behavior, not be described as fail-closed.

#### Scenario: Failed setup
- **WHEN** helper startup, discovery, or configuration validation fails
- **THEN** partial bridge resources are closed and native configuration remains unchanged with a sanitized diagnostic

#### Scenario: Active helper failure
- **WHEN** the helper exits during or after a streaming response
- **THEN** upstream work fails, cached proxy credentials are invalidated and released within a bounded deadline, and no direct gateway retry or stale proxy connection occurs
- **AND** the parent ingress keeps its port bound until parent exit and removes the failed instance route rather than exposing cached native headers to port reuse

#### Scenario: Concurrent requests and disposal
- **WHEN** multiple requests share the bridge and the runtime is disposed
- **THEN** streams retain independent cancellation and backpressure before disposal, the instance route is removed, and owned worker/Unix work terminates with bounded cleanup and no leaked processes
- **AND** the shared unref'ed ingress remains bound until parent exit, rejects cached disposed-instance capabilities, preserves other instances, and does not prevent natural exit

#### Scenario: Worker socket replacement race
- **WHEN** a worker dies between the parent's liveness check and Unix connect and another UID attempts endpoint replacement
- **THEN** the parent-owned private directory prevents replacement and no native credentials reach the attacker; the native-facing TCP port remains parent-bound

### Requirement: Evidence-gated bridge support

Support SHALL require static security review followed by installed-host proof preserving untouched native auth, private capability injection/scoping/secrecy, private-memory proxy credentials, private local TUI UX, redirects, and bounded lifecycle including parent-lifetime ingress retention and private Unix race protection. A possible `chat.headers` closure SHALL NOT count as proof of secrecy through config APIs. Verification SHALL record exact OpenCode, embedded Bun, bridge artifact/revision, and platform. Full-feature automated tests SHALL use fake bridge modules exclusively with synthetic credentials against isolated loopback fixtures and cover traversal, TLS, redirects, header stripping, capability rejection, Host/Origin/target abuse, SSE completion, tools, backpressure, cancellation, concurrency, failure, cleanup, and bridge-disabled regression. Real artifact import and helper launch/protocol verification SHALL be separate, contained, and without enrollment; archive metadata/checksum review SHALL NOT imply native helper or provenance verification. A standalone native-header probe SHALL NOT establish production implementation or remaining support gates. Live enrollment or real tailnet requests SHALL require separate explicit authorization outside CI.

#### Scenario: Host integration gate fails
- **WHEN** a required public host interface is unavailable or exposes sensitive data
- **THEN** dependent implementation is blocked pending a revised design or approved upstream work and documentation does not claim bridge support on that host

#### Scenario: Configured fetch replaces native auth fetch
- **WHEN** static inspection shows configured fetch overwrites native loader fetch and no public downstream composition point exists
- **THEN** the direct fetch-adapter gate is NO-GO, not satisfied by config-hook capture or an auth loader
- **AND** that historical result remains unchanged by the separately approved reverse-relay design and synthetic proof; installed-host, capability secrecy, private UI, embedded-runtime, and lifecycle gates remain incomplete until demonstrated, and host patches remain unauthorized

#### Scenario: Mock verification succeeds
- **WHEN** installed-package and loopback integration tests pass
- **THEN** evidence names the exact tested versions/platform and distinguishes mock routing from unverified live enrollment, native refresh, and other platforms
