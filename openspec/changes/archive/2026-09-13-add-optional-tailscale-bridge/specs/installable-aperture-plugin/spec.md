## MODIFIED Requirements

### Requirement: Documented installation and removal

Documentation SHALL distinguish host embedded Bun from the separate worker's selected runtime: external Bun by default with nonsecret absolute executable selection or one-time PATH resolution, actual allowlist exactly 1.4.2, explicit future embedded mode through `process.execPath` and child-only `BUN_BE_BUN=1` using the same worker/protocol only after verification. It SHALL describe protocol and transport smoke checks before activation, no silent runtime fallback, and no semver-only support claims. It SHALL distinguish authorization/design and synthetic evidence from verified production bridge/UX. It SHALL explain parent-owned shared unref'ed raw HTTP ingress retained until parent exit, per-instance capability route removal, node:http private Unix forwarding in parent-created 0700 directories, worker-only HTTPS/CONNECT, cached-retry protection and same-user/root limits. Parent header checks alone SHALL NOT be presented as protection. A later embedded runtime SHALL NOT imply in-process transport.

Documentation SHALL identify the default server root function, shipped `dist/bridge-worker.js` and optional TUI subpath `dist/tui.js`; local TUI commands `/aperture-setup`, `/aperture-status`, `/aperture-disconnect`, `/aperture-forget`; shared `${XDG_CONFIG_HOME:-~/.config}/opencode-aperture/settings.json`; explicit HTTPS gateway, runtime, private absolute stateDir, optional trusted absolute installed JS modulePath and authKeyEnv. It SHALL describe browser URL display only in private DialogAlert and user-key enrollment via environment-variable reference, never unmasked DialogPrompt key input or model tools. Local TUI/server only SHALL be supported; remote attachment/setup SHALL be explicitly unsupported. Disconnect SHALL save disabled settings and require full OpenCode restart, not assume a server RPC or immediate active-helper stop. Forget SHALL require stopped profile, exclusive lock and matching owner marker with safe confirmed deletion. Registry E404, empty upstream releases and local artifact zero-commit provenance SHALL remain disclosed until new evidence; checksum inspection SHALL NOT imply native helper verification.

User documentation SHALL describe native OpenAI subscription login, version-pinned package registration, host/debug configuration, trusted-gateway requirements, restart behavior, supported versions, and removal. It SHALL distinguish package installation from repository-local development loading and SHALL warn against loading both together. It SHALL separately document optional bridge installation, supported host/embedded-runtime versions, private OpenCode enrollment, node-state reuse and locking, disconnect, confirmed local-state removal, and remote revocation. It SHALL explain that bridge operation requires no system Tailscale client but is not a tailnet-only firewall, and that failed setup leaves native routing available.

#### Scenario: Migrate a local installation
- **WHEN** a user follows the migration instructions
- **THEN** the local auto-discovered adapter and explicit local registration are removed from the consumer setup before the package is enabled
- **AND** the instructions require restarting OpenCode without migrating native subscription credentials

#### Scenario: Remove the plugin
- **WHEN** a user follows the removal instructions and restarts OpenCode
- **THEN** no native subscription credential state needs migration or removal
- **AND** instructions distinguish retained optional Tailscale state, explicit safe local-state deletion, and separate remote node/key revocation
- **AND** the instructions explain that native routing resumes intentionally

#### Scenario: Optional bridge setup
- **WHEN** a user follows bridge installation guidance
- **THEN** it distinguishes available pinned releases from unpublished local artifacts, requires explicit enablement and private enrollment, and describes restart and supported-platform limits
