# Aperture Plugin for OpenCode

Discover Aperture's remote provider catalog and route supported OpenCode models through a trusted gateway, directly or over an optional Tailscale bridge. Gateway-managed credentials are the default when `requires_client_auth` is absent or false; explicit API-key passthrough and native OpenAI subscription Responses routing are also available. OpenCode continues to own subscription OAuth login, refresh, persistence, and authentication headers.

**Local candidate, not yet published.** The owner-approved package is `@jaxxstorm/opencode-aperture@0.1.0`, licensed under MIT, copyright 2026 Lee Briggs. The optional Tailscale bridge is wired, source-built, and verified through installed production bundles with a fake bridge factory; the real bridge is also unpublished and must currently be installed from a separately reviewed local tarball. Authorized live catalog discovery through the real bridge succeeded on 2026-09-29; no live inference was performed. See the [verification boundary](#verification-boundary) and [compatibility evidence](docs/compatibility.md).

## Trust and Support Boundary

The gateway receives request content and, in passthrough or subscription mode, your selected API key or subscription bearer credentials. Gateway-managed mode strips upstream authentication supplied by SDKs rather than borrowing native credentials. Confirm who operates the gateway and that you are authorized to send content and any selected credentials there before starting OpenCode. Bridge mode requires HTTPS. Direct mode retains HTTP support only for an explicitly trusted, independently protected network; the default hostname does not provide encryption.

The earlier direct-routing baseline is stock **OpenCode 1.18.29, Bun 1.3.14, darwin-arm64**, using native OpenAI subscription authentication and HTTP/SSE. The bridge worker requires a separate **Bun 1.4.2** executable. This is a version-sensitive workaround, not a supported upstream transport hook or an open-ended minimum-version guarantee. WebSockets and residency-sensitive accounts are unsupported.

Do not combine this plugin with plugins that replace OpenAI auth/fetch or override its gateway configuration. This plugin configures routing; it is not a security enforcement product and does not guarantee where requests go if loading or setup fails.

## Installation

### Local Candidate

Use the pinned tool versions above. The build sequence in this checkout is:

```sh
bun install --frozen-lockfile
bun run build
```

The build produces three independent Bun ESM bundles: `dist/index.js` (the single default server factory), `dist/bridge-worker.js` (internal worker, not a package export), and `dist/tui.js` (default `{ id, tui }` module). The root and `/server` exports both select the factory; `/tui` selects the TUI module. Package checks passed for all three built entries in a clean consumer. Imports are limited to actual Node builtins (including Bun-normalized bare names) and the worker's external bridge loading; arbitrary imports are not accepted.

In a **separate consumer project**, merge this entry into `opencode.json`, replacing the example path with an absolute path to the build:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/opencode-aperture/dist/index.js"]
}
```

Also register the separate TUI entry in `tui.json` for local setup commands:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///absolute/path/to/opencode-aperture/dist/tui.js"]
}
```

This is local built-file loading, not proof of clean package installation. To produce a local tarball, run `bun run pack`. Install the inspected tarball into the consumer with `bun add /absolute/path/to/jaxxstorm-opencode-aperture-0.1.0.tgz` and use absolute `file://` URLs under its `node_modules/@jaxxstorm/opencode-aperture/dist/` for both registrations. Keep all three bundles together; do not register the worker or put it in an auto-discovered plugin directory. See [developer verification](docs/verification.md) for clean-consumer checks. No registry publication is needed for local testing.

The local setup flow and command registrations are implemented; both files above are required. Building and verifying this candidate did not configure your actual `opencode.json`, `tui.json`, or global settings. Real interactive TUI/browser verification remains deferred.

Server routing also requires **`OPENCODE_APERTURE_ENABLE=1`** in the server process environment. Without that exact value the server plugin installs no hooks. Keep registration and enablement scoped to an explicitly selected consumer/test profile; do not configure your global OpenCode profile for these tests. `scripts/launch.zsh` sets the flag only for its isolated test process.

### After an Approved Release Only

The following version-pinned registry registration is **not usable until this name and version are published with explicit owner approval**:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@jaxxstorm/opencode-aperture@0.1.0"]
}
```

Register the same pinned package name in `tui.json` with `"$schema": "https://opencode.ai/tui.json"` and `"plugin": ["@jaxxstorm/opencode-aperture@0.1.0"]`; OpenCode's package TUI resolution selects the separate `/tui` export. Server registration alone does not configure these TUI commands. OpenCode installs registered registry plugins. Do not use an unpinned name or `latest` for a compatibility-sensitive deployment. Keep OpenCode pinned too; rerun packaged checks before upgrading either component.

### Optional Local Bridge Setup

Direct mode needs no bridge installation. For bridge mode, obtain and independently verify the exact trusted bridge tarball and its checksum before installing it. `@jaxxstorm/bun-tailscale-bridge` currently returns npm E404; do not try a guessed registry version. No bridge dependency or optional dependency is declared by this plugin until a registry release is available. The inspected artifact checksum and provenance limits are in [compatibility](docs/compatibility.md).

Install the reviewed artifact in a private per-user runtime outside your project, config, and node identity directory. Replace the tarball placeholder below with the absolute path to that verified artifact; these commands do not download a bridge or upgrade Bun:

```sh
umask 077
APERTURE_RUNTIME="$HOME/.local/share/opencode-aperture-runtime"
mkdir -p "$APERTURE_RUNTIME"
chmod 700 "$APERTURE_RUNTIME"
bun -e 'await Bun.write(process.argv[1], JSON.stringify({ private: true, type: "module" }) + "\n")' "$APERTURE_RUNTIME/package.json"
bun add --offline --ignore-scripts --cwd "$APERTURE_RUNTIME" /absolute/bridge.tgz
```

Use a new dedicated directory for this example so its private package metadata does not overwrite an existing project. Installing this bridge trusts executable JavaScript and native helpers with your user permissions. The plugin does not automatically download, install, or upgrade the bridge or runtime.

1. Install external Bun **1.4.2** yourself. Setup defaults to external mode, resolving `bun` from `PATH` to an absolute executable; an explicit absolute executable is also accepted. The worker checks its own Bun version. The currently embedded OpenCode runtime is rejected; the explicit OpenCode-executable option is reserved for a future verified runtime in that same worker process, with no fallback.
2. Launch a local OpenCode server/TUI and run `/aperture-setup`. Confirm gateway trust, enter a trusted HTTPS origin, choose external Bun, and enter the absolute JS `modulePath`, for example `/absolute/user/runtime/node_modules/@jaxxstorm/bun-tailscale-bridge/dist/index.js`. For the installation above, use the expanded absolute value of `$APERTURE_RUNTIME/node_modules/@jaxxstorm/bun-tailscale-bridge/dist/index.js`, not a literal shell variable. A blank module path relies on package resolution and is not the supported unpublished local-tarball flow.
3. Choose browser enrollment or an `authKeyEnv` reference. When Tailscale supplies a new URL, it appears in a private prompt and the plugin attempts to open the default browser on macOS/Linux; repeated delivery of the same URL does not open it again. If that fails, copy the displayed URL manually. Keep the dialog open while authenticating; Enter keeps waiting and Escape cancels. The URL is passed directly to the OS opener as an argument, without a shell or diagnostic output; it is not saved in settings, chat, or plugin logs. This is an explicit exception to keeping enrollment URLs out of process arguments, not an absolute privacy guarantee against OS process inspection or browser history. For auth keys, enter only an environment variable **name**, such as `TS_AUTHKEY`; supply its value securely in the process environment before launching OpenCode. Never paste a key into a prompt or settings. Its value is not saved.
4. After enrollment succeeds, setup closes the enrollment worker, cleans up, saves settings, and automatically refreshes models if the current local server instance is idle. Success is reported only after the native TUI provider state matches the rebuilt catalog. If refresh is busy or fails, enrollment and saved settings remain intact: finish active work and use `/aperture-models`, or restart OpenCode. Native OpenAI login is not required for selector visibility; it remains a separate inference step below. `/aperture-status` reports local saved settings, not live connectivity. `/aperture-disconnect` still disables the bridge on the next restart; it does not stop an already running worker, delete identity, or revoke the device remotely.

These are TUI-local commands, not agent tools or server RPCs. Remote TUI servers are unsupported. Setup uses the default identity directory without prompting for a state path. Settings are saved to `${XDG_CONFIG_HOME:-$HOME/.config}/opencode-aperture/settings.json` with mode `600` in a `700` directory. Identity defaults to `${XDG_STATE_HOME:-$HOME/.local/state}/opencode-aperture/node` with mode `700`; treat its contents as credentials, not ordinary config. To change nonsecret settings such as `bridge.stateDir`, stop affected processes, edit the existing settings safely without symlinks, retain private ownership and permissions (`chmod 600` on the settings file), and restart. Do not place identity under a project, package runtime, or config tree.

To forget identity, first disable the bridge, quit and restart OpenCode, and stop any other instances/helpers using the profile. `/aperture-forget` requires saved disabled settings, an unlocked private plugin-owned profile, and explicit confirmation. It deletes only that local profile; settings remain disabled, enrollment is required again, and native OpenAI login is unchanged. A live or stale `.aperture-lock` is never removed automatically; stop processes and manually review a stale lease rather than forcing deletion. Forgetting does not revoke the device remotely: use the tailnet admin console separately.

To retry enrollment with a saved connection, use `/aperture-login`. It confirms the saved gateway and bridge code, then asks only for the enrollment method; `/aperture-setup` remains available to edit connection settings. An authorized stored identity is reused without a new URL or browser launch. When fresh authentication is required, the URL stays visible even if automatic browser opening fails. Keep the enrollment dialog open until authentication completes.

### Refreshing Models

If OpenCode is already running older plugin code, restart it **once** after installing the new build, then run `/aperture-models`. Existing enrollment can be reused; do not re-enroll just to populate models. Future successful enrollment attempts refresh automatically.

`/aperture-models` requires enabled local bridge settings, asks you to confirm the local server, and opens the native model picker only after catalog synchronization. Refresh uses public SDK APIs to reload only the current directory's instance, not global disposal, and does not delete native conversation history or read native auth files. It checks session status and skips reload for busy/retrying sessions or unknown status. **Do not start new work from any client on that instance during refresh:** the idle check and disposal are not atomic, so work started between them could be interrupted. Cancelling the refresh dialog stops waiting; it cannot roll back a reload already accepted by the server. Remote TUI servers are unsupported.

Readiness covers all `aperture-*` providers and native `openai` when labeled `Aperture (...)`, not just the legacy subscription provider. Catalog visibility is not proof of gateway grants, valid credentials, or successful inference.

A reused shared worker performs fresh discovery without restarting transport held by another project. A failed catalog request retains the previous valid worker catalog and other owners' transport; it does not establish that the refreshed instance's models are ready. Refresh is not a general promise that all settings changes apply automatically: disconnect, environment changes, and upgrades retain their restart requirements.

### Native Subscription Login

```sh
opencode auth login
```

Choose OpenAI and its ChatGPT subscription/browser OAuth login, not an API key. Complete OpenCode's native login flow. Existing native subscription login can be reused; do not copy, inspect, or migrate auth files. Bridge enrollment is a separate device identity and does not log in to OpenAI.

This login is needed only for native subscription mode, not gateway-managed providers or explicit API-key passthrough.

For direct mode, set a confirmed trusted gateway origin in the environment of the OpenCode process, then launch it. For bridge mode, the saved HTTPS gateway is used unless a host environment override is present:

```sh
export APERTURE_HOST=https://aperture.example.com
OPENCODE_APERTURE_ENABLE=1 opencode
```

`aperture.example.com` is a placeholder, not a provided service. Stop and restart all affected OpenCode processes after installation, manual configuration or host-environment changes, migration, or upgrades. Successful local enrollment now attempts the guarded refresh described above; `/aperture-models` can refresh the catalog manually. Discovery occurs at instance initialization/reload, not on every chat turn.

## Configuration

| Setting | Contract |
| --- | --- |
| `OPENCODE_APERTURE_ENABLE` | Only the exact value `1` enables server routing. Scope it to the selected process/profile, not global configuration. |
| `APERTURE_HOST` | First nonempty host setting; takes precedence. |
| `OPENCODE_APERTURE_HOST` | Used if `APERTURE_HOST` is empty or unset. |
| Saved `bridge.gateway` | Used only when bridge mode is enabled and both host environment settings are empty or unset. |
| Default | `http://ai` if neither host setting is nonempty. Confirm trust before using it. |
| `OPENCODE_APERTURE_DEBUG` | Only the exact value `1` enables plugin debug diagnostics; all other values leave them off. |

Hosts must be HTTP or HTTPS **origins only**, optionally with a trailing slash, for example `https://gateway.example:8443/`. Paths (including `/codex`), embedded credentials, queries, fragments, malformed URLs, and other schemes are rejected. Do not put secrets in host settings. There is no separate endpoint override or shell-propagated endpoint setting.

**Host environment variables override the gateway selected in setup.** Review or unset stale overrides before restarting; bridge mode rejects an HTTP override rather than silently downgrading HTTPS.

The plugin discovers `/api/providers` with a 10-second timeout, without redirects or automatic retries. It plans supported providers together before applying configuration and deduplicates model IDs in discovery order. Remote providers become `aperture-<encoded-remote-id>`; mixed-protocol providers receive separate groups such as `aperture-<encoded-remote-id>:responses` and `:messages`. Each group is labeled `Aperture (<remote name or ID>)`. These IDs are separate from native provider IDs.

Supported adapters are OpenAI Responses (`responses`), OpenAI Chat Completions (`chat`), Anthropic Messages (`messages`), Bedrock Converse (`bedrock`), and Gemini generate/streamGenerateContent (`gemini`). This is not support for arbitrary APIs. Vertex-only and invoke-only catalogs, unrepresentable path model IDs, and ambiguous Bedrock/Gemini model IDs shared across remote providers are skipped with unsupported summaries. The server currently logs only the unsupported count in debug mode.

Authorized live discovery on **2026-09-29**, through the real bridge, returned eight remote providers: `anthropic`, `bedrock`, `bedrock-mantle-anthropic`, `bedrock-mantle-completions`, `bedrock-mantle-openai`, `neuralwatt`, `openai`, and `vercel`. They produced **10 OpenCode provider groups, 42 model entries, zero unsupported entries, and `subscription: false`**. Vercel split into Messages, Chat, and Responses groups. This verifies that catalog snapshot and grouping, not inference authorization or successful live inference.

### Per-Provider Authentication

Use a server-plugin tuple in the selected consumer's `opencode.json`. Keys under `auth` are exact **remote catalog IDs**, not generated `aperture-*` IDs. Replace these placeholders with discovered IDs; unknown IDs are rejected. TUI registration remains separate and takes no auth options.

```json
{
  "plugin": [["file:///absolute/path/to/opencode-aperture/dist/index.js", {
    "auth": {
      "remote-managed-id": { "mode": "gateway" },
      "remote-key-id": { "mode": "passthrough", "apiKeyEnv": "PROVIDER_API_KEY", "protocol": "messages" },
      "remote-subscription-id": { "mode": "subscription", "protocol": "responses" }
    }
  }]]
}
```

- `gateway`: the gateway owns upstream credentials. SDK upstream authentication, cookies, AWS signing headers, and credential query parameters are stripped. No native credentials from other provider IDs are borrowed.
- `passthrough`: `apiKeyEnv` must explicitly name a present, nonempty environment variable. Only that selected key is sent using the protocol's auth header, after removing SDK-supplied auth. Keys stay in runtime fetch closures, not serialized provider configuration; bridge capabilities likewise stay out of serialized config. There is no ambient native-auth lookup or credential fallback. Bedrock AWS SigV4 passthrough is unsupported; use gateway-managed Bedrock.
- `subscription`: retains native `openai` and the existing `/codex/responses` route. Exactly one nonempty, enabled subscription Responses provider may be selected. OpenCode owns OAuth and native fetch; this mode does not turn subscription auth into API-key auth.

Without an explicit override, `requires_client_auth: true` plus Responses selects legacy subscription mode. A client-auth-required provider without Responses is skipped with an unsupported summary until an explicit supported auth mode is configured. A missing or false flag selects gateway mode. **That default is an assumption, not proof that the server needs no client key**: a gateway may actually expect passthrough even when the flag is absent. Confirm the server's policy and select the mode explicitly when needed. Catalog entries are neither proof of authorization grants nor an inference guarantee.

Optional `protocol` must be one of the five adapter names above and must be advertised by that provider. Without it, the plugin groups models by advertised compatibility and model family. Use an override when that inference does not match the gateway's intended API.

Supply key values through an existing secure environment mechanism, never inline in shell commands, plugin tuples, prompts, or settings. The isolated launcher forwards only explicitly selected variables via `APERTURE_PASSTHROUGH_ENV`, a comma-delimited list of environment variable **names**, never values. Values reach the child through its environment, not argv. Invalid or reserved names and unset or empty values are rejected. Use a name such as `PROVIDER_API_KEY`; `APERTURE_*` and other runtime/configuration prefixes are reserved. See [launcher notes](scripts/README.md#provider-auth-and-environment-forwarding).

### Routing and Metadata

Bridge mode publishes a capability-protected parent loopback ingress, forwarding over a private Unix socket to the worker and then through the bridge proxy to the HTTPS gateway. Discovery uses that bridge too. Managed and passthrough providers use separate bridge routes; subscription keeps `/codex`. On OpenCode 1.18.29 that subscription path avoids the native rewrite while preserving native OAuth transport. Generated providers use protocol-specific SDK fetch closures; native subscription fetch is not replaced.

Generated models retain permitted user metadata and whitelist/blacklist filtering, but conflicting routing overrides are rejected. Unknown limits are **estimates: 128,000 context tokens and 8,192 output tokens**, not advertised catalog facts. Override `provider[generatedID].models[modelID].limit.context` and `.limit.output` with verified values. Metadata reuse does not borrow native credentials, headers, fetch, or provider options.

SDK configuration retains raw upstream model IDs so SDK reasoning and capability detection still recognize them. For generated Responses, Chat, and Messages providers, the fetch boundary qualifies only the outgoing JSON `model` as `<remote-provider-id>/<raw-model-id>`, after SDK transformations. Bedrock/Gemini retain their path-based routing; native subscription/Codex behavior is untouched. Extra gateway catalog metadata such as `description` is projected out before the strict private worker catalog protocol; regression coverage protects this boundary.

An explicit default model is preserved. The legacy subscription path intersects discovery with the OpenAI whitelist, rejects an unavailable explicit OpenAI selection or empty intersection, and fills an absent default from allowed subscription models. Gateway-only discovery does not promise to choose a default; select a discovered generated provider/model in the picker or consumer configuration. Unrelated providers remain unchanged. The plugin request marker applies to configured Aperture provider IDs, including native `openai` when subscription routing is selected.

### Verification Boundary

Final installed synthetic checks passed: `--bridge-production-gateway` exercised four native protocols (Responses, Chat, Messages, Converse), including capability-protected routing and secret-free native config; `--bridge-production` passed all five subscription scenarios; `--bridge-production-refresh` passed catalog refresh. These runs include the fetch-boundary model-qualification change.

Final verification: 350 tests passed with pinned SDK probes enabled, 2,221 expectations across 17 files. Typecheck, build, package checks and strict OpenSpec validation passed. Launcher tests cover explicit environment forwarding and the 10-second shutdown grace, allowing up to seven seconds for bridge cleanup.

Evidence limits are separate from implementation completion: Gemini has passing SDK mock coverage only, not native OpenCode integration evidence. Live catalog discovery succeeded as recorded above, but catalog visibility and synthetic probes do not prove inference grants. **No live inference was performed**; live inference remains deferred and is not required to complete this change. Real interactive TUI/browser verification remains separate.

Debug output is restricted to allowlisted stage/status/error-category and validated origin/path metadata, not headers, bodies, account IDs, OAuth data, raw discovery responses, or invalid URL values. Review diagnostics before sharing them; these restrictions describe plugin logs, not every upstream component.

## Failures

Invalid host, discovery, model configuration, or bridge startup produces a sanitized setup error without changing `disabled_providers`. Initial setup failure leaves native configuration unchanged, so native routing may remain available. Check OpenCode logs and restart after correcting setup; do not assume installation alone proves requests use Aperture.

After bridge routing is configured, one parent-owned listener remains bound for the parent process lifetime. Worker death retains its mapping as a `503` denial; disposing a profile/plugin instance revokes that mapping (`403` for its old capability) without releasing the port for another process to rebind. In-flight streams may terminate on failure. This guard protects the configured local route, not all possible network traffic. Same-user and root attackers are outside the boundary.

Compatible profiles share a reference-counted worker within the loaded server module across projects, while each plugin instance has its own capability on the shared TCP listener. Separate processes still require exclusive identity-state ownership. Nested profiles are rejected, and forget refuses nested leases. Settings compare-and-swap writes occur under a lock; the worker holds a continuous state lease from preparation until the Go helper is confirmed closed. Default state paths remain valid when OpenCode starts from home or `/`.

Missing auth and gateway errors remain native OpenCode behavior. The plugin does not repair credentials or manage retries. It provides no fail-closed or no-direct-traffic guarantee; use independent controls if destination enforcement is required.

## Migration and Removal

To switch from source development loading to the package or built artifact:

1. Stop the affected OpenCode instances.
2. Remove explicit local plugin entries from project and user configuration. Remove or move `.opencode/plugins/aperture-codex.ts` outside auto-discovered plugin directories in the consumer; check user-level plugin directories too. A configured entry and an auto-discovered adapter must not cause duplicate loading.
3. Enable exactly one installation method: the source adapter, a built-file entry, or the pinned package. The source adapter is for development and imports the shared implementation; it is not needed by package consumers.
4. Retain intended model settings and host environment variables, then restart. Native OAuth state needs no migration.

To uninstall, stop OpenCode, remove both `opencode.json` and `tui.json` registrations and any auto-discovered adapter, and remove the locally installed dependency if applicable. Restore any gateway-related provider configuration you manually saved and unset plugin environment variables if no longer needed. Bridge settings and device identity persist separately; do not delete native OpenAI credentials as part of removal. Disabling or removing the plugin does not revoke the tailnet device. Restart OpenCode.

**Removal restores native routing**, which can send requests directly to the native service.

## Further Documentation

- [Exact compatibility and evidence](docs/compatibility.md)
- [Opt-in live text, tool, and refresh validation](docs/live-validation.md)
- [Synthetic and package verification](docs/verification.md)
- [Release checklist and publication gates](docs/release.md)
