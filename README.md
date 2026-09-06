# Aperture Codex Plugin for OpenCode

Route native OpenCode OpenAI subscription Responses traffic through a trusted Aperture gateway, while OpenCode continues to own OAuth login, refresh, persistence, and authentication headers.

**Prepared for public distribution, not yet published.** The owner-approved package is `@jaxxstorm/opencode-aperture@0.1.0`, licensed under MIT, copyright 2026 Lee Briggs. Local tests, packaged routing, and workflow lint pass on macOS. CI execution and npm publishing setup remain unverified. See [compatibility evidence](docs/compatibility.md).

## Trust and Support Boundary

The gateway receives your subscription bearer credentials and request content. Confirm who operates it and that you are authorized to send those credentials there before starting OpenCode. Prefer HTTPS. HTTP is suitable only on an explicitly trusted, independently protected network; the default hostname does not provide encryption.

The exact existing baseline is stock **OpenCode 1.18.29, Bun 1.3.14, darwin-arm64**, using native OpenAI subscription authentication and HTTP/SSE. Packaged synthetic text, tools, concurrency, cancellation, and non-OpenAI header scoping pass. This is a version-sensitive workaround, not a supported upstream transport hook or an open-ended minimum-version guarantee. WebSockets and residency-sensitive accounts are unsupported.

Do not combine this plugin with plugins that replace OpenAI auth/fetch or override its gateway configuration. This plugin configures routing; it is not a security enforcement product and does not guarantee where requests go if loading or setup fails.

## Installation

### Local Candidate

Use the pinned tool versions above. The build sequence in this checkout is:

```sh
bun install --frozen-lockfile
bun run build
```

The build produces self-contained ESM at `dist/index.js`. In a **separate consumer project**, merge this entry into `opencode.json`, replacing the example path with an absolute path to the build:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/opencode-aperture/dist/index.js"]
}
```

This is local built-file loading, not proof of clean package installation. To produce a local tarball, run `bun run pack`. Install the inspected tarball into the consumer with `bun add /absolute/path/to/jaxxstorm-opencode-aperture-0.1.0.tgz` and register the absolute `file://` URL of its `node_modules/@jaxxstorm/opencode-aperture/dist/index.js` instead. See [developer verification](docs/verification.md) for the clean-consumer checks. No registry publication is needed for local testing.

### After an Approved Release Only

The following version-pinned registry registration is **not usable until this name and version are published with explicit owner approval**:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@jaxxstorm/opencode-aperture@0.1.0"]
}
```

OpenCode installs registered registry plugins. Do not use an unpinned name or `latest` for a compatibility-sensitive deployment. Keep OpenCode pinned to the exact tested version too; rerun packaged checks before upgrading either component.

### Native Subscription Login

```sh
opencode auth login
```

Choose OpenAI and its ChatGPT subscription/browser OAuth login, not an API key. Complete OpenCode's native login flow. Existing native subscription login can be reused; do not copy, inspect, or migrate auth files. This plugin has no separate credential configuration.

Set a confirmed trusted gateway origin in the environment of the OpenCode process, then launch it:

```sh
export APERTURE_HOST=https://aperture.example.com
opencode
```

`aperture.example.com` is a placeholder, not a provided service. Stop and restart all affected OpenCode processes after installation, configuration changes, host changes, migration, or upgrades. Discovery occurs at initialization, not on every chat turn.

## Configuration

| Setting | Contract |
| --- | --- |
| `APERTURE_HOST` | First nonempty host setting; takes precedence. |
| `OPENCODE_APERTURE_HOST` | Used if `APERTURE_HOST` is empty or unset. |
| Default | `http://ai` if neither host setting is nonempty. Confirm trust before using it. |
| `OPENCODE_APERTURE_DEBUG` | Only the exact value `1` enables plugin debug diagnostics; all other values leave them off. |

Hosts must be HTTP or HTTPS **origins only**, optionally with a trailing slash, for example `https://gateway.example:8443/`. Paths (including `/codex`), embedded credentials, queries, fragments, malformed URLs, and other schemes are rejected. Do not put secrets in host settings. There is no separate endpoint override or shell-propagated endpoint setting.

The plugin discovers `/api/providers` with a 10-second timeout, without redirects or automatic retries. It requires exactly one valid provider with `requires_client_auth: true`, `openai_responses: true`, and a nonempty model list. Chat-only or multiple eligible providers are errors, not fallback choices. Duplicate model IDs are removed in discovery order.

The native provider ID stays `openai`. The plugin configures its base URL to `<origin>/codex`, producing `/codex/responses`. On OpenCode 1.18.29 this avoids the native path rewrite while preserving native OAuth transport. The plugin does not intercept arbitrary URLs, replace fetch, install an auth loader, or turn subscription auth into API-key auth.

An explicit default model is preserved, including a model from another provider. Discovered OpenAI models are intersected with any existing OpenAI whitelist, and user model metadata is retained. An unavailable explicit OpenAI selection or empty whitelist intersection is a configuration error; only an absent default is filled with the first allowed discovered model. For example, retain `"model": "openai/gpt-6-astra"` only if that model is discovered and allowed. Unrelated providers remain unchanged. The optional plugin request marker is OpenAI-only and preserves supplied headers.

Debug output is restricted to allowlisted stage/status/error-category and validated origin/path metadata, not headers, bodies, account IDs, OAuth data, raw discovery responses, or invalid URL values. Review diagnostics before sharing them; these restrictions describe plugin logs, not every upstream component.

## Failures

Invalid host, discovery, or model configuration produces an ordinary sanitized setup error. The plugin does not change `disabled_providers` or install a request-blocking guard. OpenCode may log and ignore plugin errors, leaving native routing available. Check OpenCode logs and restart after correcting setup; do not assume installation alone proves requests use Aperture.

Missing auth and gateway errors remain native OpenCode behavior. The plugin does not repair credentials or manage retries. It provides no fail-closed or no-direct-traffic guarantee; use independent controls if destination enforcement is required.

## Migration and Removal

To switch from source development loading to the package or built artifact:

1. Stop the affected OpenCode instances.
2. Remove explicit local plugin entries from project and user configuration. Remove or move `.opencode/plugins/aperture-codex.ts` outside auto-discovered plugin directories in the consumer; check user-level plugin directories too. A configured entry and an auto-discovered adapter must not cause duplicate loading.
3. Enable exactly one installation method: the source adapter, a built-file entry, or the pinned package. The source adapter is for development and imports the shared implementation; it is not needed by package consumers.
4. Retain intended model settings and host environment variables, then restart. Native OAuth state needs no migration.

To uninstall, stop OpenCode, remove the package/file registration and any auto-discovered adapter, and remove the locally installed dependency if applicable. Restore any gateway-related provider configuration you manually saved and unset plugin environment variables if no longer needed. Restart OpenCode. Plugin config mutations are runtime-only and there is no plugin-owned auth state to clean up; do not delete native credentials as part of removal.

**Removal restores native routing**, which can send requests directly to the native service.

## Further Documentation

- [Exact compatibility and evidence](docs/compatibility.md)
- [Opt-in live text, tool, and refresh validation](docs/live-validation.md)
- [Synthetic and package verification](docs/verification.md)
- [Release checklist and publication gates](docs/release.md)
