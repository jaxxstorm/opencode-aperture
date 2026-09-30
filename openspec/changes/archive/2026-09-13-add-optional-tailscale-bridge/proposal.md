## Why

Users whose Aperture gateway is on a tailnet currently need independently available network connectivity, typically an installed Tailscale client. Optional integration with `jaxxstorm/bun-tailscale-bridge` would let users enroll a userspace node through the OpenCode UX and reach Aperture without a system client, root privileges, or host route changes.

## What Changes

### Current Full Authorization

The owner's explicit "wire it in please, finish the job" authorizes the full production feature. This supersedes the earlier narrow-only authorization retained below as history, not the historical NO-GO findings or outstanding verification gates. This turn edits only `openspec/config.yaml`, `openspec/project.md`, and this change's proposal/design/specs/tasks/evidence; main owns implementation and final feature verification.

- Ship one default server root function, `dist/bridge-worker.js`, and optional TUI subpath `dist/tui.js`.
- Use one parent-owned shared raw HTTP numeric-loopback ingress port until parent exit, unref'ed, with per-instance capability routes removed on dispose. Stream parent HTTP via `node:http` to worker-only Unix sockets in short parent-created private 0700 directories; only the exact verified Bun 1.4.2 child does HTTPS through the real bridge proxy.
- Worker death aborts/503s in-flight work and removes routes so later cached capabilities get 403; the parent port stays bound against other-UID reuse. Private Unix directories protect the liveness/connect race. Same-user/root compromise is out of scope. Test these guarantees before support claims.
- Share local version-1 settings at `${XDG_CONFIG_HOME:-~/.config}/opencode-aperture/settings.json`: `bridge: { enabled, gateway, hostname, stateDir, runtime: { mode, executable? }, modulePath?, authKeyEnv?, startupTimeoutMs }`. Require trusted HTTPS gateway, absolute private stateDir, optional absolute trusted installed JS modulePath, explicit external executable or PATH resolved once, and no runtime autofallback. Future verified embedded mode retains the same separate worker and child-only `BUN_BE_BUN`.
- Local TUI commands `/aperture-setup`, `/aperture-status`, `/aperture-disconnect`, `/aperture-forget` use private dialogs, not model tools. Browser URL is `DialogAlert`-only; replace masked key-input requirement with explicit user-owned environment-variable reference input because public `DialogPrompt` cannot mask. Never prompt for an unmasked key or read/persist native ChatGPT credentials.
- Disconnect saves disabled settings and requires full OpenCode restart without assuming server RPC. Forget requires stopped profile, exclusive lock, matching owner marker and safe confirmed deletion. Local TUI/server only; remote attachment unsupported.
- Permit exact optional bridge 0.1.0 despite current npm E404, tolerate optional absence while disabled, and support separately installed local tarball via modulePath without committed developer file dependencies, runtime build/download, or publication. Checksum/metadata inspection is complete; zero-commit provenance and native helper operation remain unverified. Full feature verification uses fake bridge modules exclusively on loopback; real artifact import/helper launch-protocol checks do not authorize enrollment.

### Earlier Proposal Scope (Historical)

The following records the sequence of earlier approvals and candidate ownership decisions. Where it differs, Current Full Authorization and the current normative delta specs govern; worker-held TCP ports and masked key prompts are superseded, not current implementation instructions.

- Add explicitly enabled managed bridge configuration and an OpenCode setup/status/disconnect UX, with browser enrollment or transient auth-key input and reuse of private Tailscale node state.
- Route discovery through the bridge's authenticated HTTP/CONNECT forward proxy. Route untouched native OpenCode OAuth Responses traffic through a plugin-managed numeric-loopback reverse relay, then that forward proxy, to one fixed validated gateway, preserving upstream hostname/TLS verification, native headers, model policy, and SSE behavior. The reverse relay is not `bridge.httpProxyURL()`.
- Keep bridge-disabled behavior unchanged. Preserve non-destructive startup failures and disclose that native OpenAI routing remains available after unsuccessful setup; never retry activated bridge traffic directly.
- Manage bounded startup, cancellation, helper shutdown, private state permissions, explicit local-state removal, and credential-safe diagnostics.
- Permit an optional, pinned bridge runtime dependency with packaged native helpers, verified independently of the default self-contained plugin path. No automatic runtime downloads, compilation, or publication.
- Gate implementation on installed-host native composition with the approved reverse relay, private OpenAI-only runtime-header capability injection, private interactive UX, and bounded lifecycle safety. Ban native auth-fetch replacement, global fetch patches, private APIs, and global environment proxies.
- Narrow the existing config-only/no-identity-state boundary to permit bridge lifecycle, Tailscale state ownership, and the explicitly approved reverse-relay design and synthetic loopback proof. Independent random relay capability and proxy credentials remain private runtime secrets, never URLs, provider options, config APIs, transcripts, logs, or persistence. Native OAuth login, refresh, persistence, and header ownership remain unchanged; the relay only forwards native auth headers without parsing them. Same-user compromise is outside the threat model.
- Record the revised direct fetch-adapter static gate as NO-GO at OpenCode commit `16747470f976aca3d362ad730bcd3fe82ecc2c9a`: public hooks lack downstream composition with native auth fetch. Installed-host, private UI, and runtime proofs remain pending; no functional adapter is claimed.
- Require exact `POST /codex/responses`, a fixed upstream, Host/Origin/absolute-target rejection, credential and hop-header stripping including Connection nominations, redirect rejection, bounded streaming/cancellation/backpressure, and no direct fallback. After bridge failure keep the relay listening but rejecting until native runtime disposal; normal closure requires proof native traffic has stopped to prevent stale-port credential delivery.
- Current authorization covers separate-process transport/runtime infrastructure and synthetic native HTTPS proof, not full bridge or UX implementation. The transport worker runs on explicitly selected, verified external Bun now; the same worker/protocol may later run as a child of `process.execPath` with `BUN_BE_BUN=1` only after that selected embedded runtime passes capability checks. It stays a separate process; no automatic in-process refactor or silent runtime fallback is permitted.
- Resolve external Bun to a nonsecret absolute executable path by default, validate actual Bun version and protocol plus transport smoke before activation, and never infer verification from newer semver. Parent-owned native `chat.headers` capability injection and worker-owned relay/proxy transport communicate through private bounded JSON-line stdio, not secret-bearing env/argv/config URLs. Plug the future bridge factory into that same worker; synthetic transport is not implemented Tailscale.
- Supervise startup/ready, close, exit, and EOF with capability invalidation and no direct fallback. A surviving worker must retain a rejecting relay after upstream/helper failure. Unexpected worker death releases its relay port: parent header checks cannot protect cached native retries. This remains an unresolved production safety gate; evaluate a parent-owned stable loopback guard before claiming stale-port safety, without assuming it is implemented or sufficient.
- Non-goals: implementing ChatGPT OAuth, registering OpenAI auth loaders, reading OpenCode auth files, persisting OpenAI/ChatGPT tokens or enrollment keys, changing API-key provider behavior, host-wide VPN support, an egress firewall, and guaranteeing native refresh or unsupported platforms without evidence.

## Capabilities

### New Capabilities
- `optional-tailscale-bridge`: Opt-in configuration and private enrollment UX, identity reuse and cleanup, scoped proxy routing, lifecycle safety, and bridge-specific compatibility evidence.

### Modified Capabilities
- `aperture-routing-hardening`: Allow separately managed Tailscale identity while preserving native OAuth; extend setup and diagnostic safety to bridge operation.
- `installable-aperture-plugin`: Document optional bridge installation, supported runtimes, enrollment, private state, and removal separately from native credentials.
- `mit-package-distribution`: Allow the reviewed optional bridge dependency and its helper assets while retaining the default self-contained export and clean-consumer verification.

## Impact

Affected areas include `src/index.ts`, discovery/configuration helpers, new bridge lifecycle/setup code, package/build/lockfile verification, isolated routing and cleanup probes, README and compatibility documentation, and active OpenSpec guidance. Historical artifacts remain unchanged.

The bridge README reviewed on 2026-09-09 describes `createBridge`, `httpProxyURL`, and `close`, an unpublished package, four macOS/Linux helper targets, and a Bun 1.4.2 verification baseline. This plugin currently records OpenCode 1.18.29 with Bun 1.3.14. The implemented internal supervisor and copied synthetic worker now have a reported five-scenario external Bun 1.4.2 native HTTPS pass; embedded 1.3.14 rejects before startup, preserving the original packaged gateway route without inference or external fallback, not failing closed. This does not verify a bridge artifact, production worker integration, private UX or stale-port safety. Exact allowlist extension requires differential/native evidence, never newer semver trust. This reconciliation edits only current change artifacts and scripts/README.md; main owns code/tests and final verification.
