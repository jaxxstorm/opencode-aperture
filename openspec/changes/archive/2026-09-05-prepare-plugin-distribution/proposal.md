## Why

The plugin now produces live responses through Aperture on stock OpenCode 1.18.29, including `gpt-5.6-luna` and `gpt-6-astra`, but it is still a private repository-local bootstrap. Users need a self-contained installable package and evidence that its routing, configuration, and failure behavior survive real usage and OpenCode upgrades without taking ownership of OAuth.

## What Changes

- Prepare the existing `opencode-aperture-codex-plugin` package for distribution with a built plugin entrypoint, explicit package contents, installation instructions, and a pack/install smoke test outside this checkout.
- Harden subscription provider discovery, host validation, startup timeouts, model selection, config merging, and safe diagnostics around the existing `/codex` base URL workaround.
- Preserve explicit user model choices and unrelated provider settings; restrict plugin request markers to OpenAI traffic.
- **BREAKING**: Reject chat-only subscription providers and ambiguous discovery results rather than silently choosing the first OpenAI-compatible record. The transport requires Responses compatibility.
- Test gateway and setup failures without breaking the user's configuration on the supported runtime, including OpenCode's tendency to swallow plugin initialization errors; failed setup leaves native OpenAI routing unchanged.
- Extend isolated synthetic integration tests to successful streaming, tool-call round trips, cancellation, concurrency, and packaged loading. Add repeatable CI checks and a versioned compatibility report.
- Document the current HTTP/SSE support boundary, credential trust implications, restart/uninstall procedure, and explicit opt-in live validation of native refresh behavior.
- Reconcile active project guidance with the tested config-only architecture and actual environment variables; do not present the original assumed rewrite hook as implemented behavior.

Non-goals: implementing OAuth, reading auth files, persisting tokens in plugin code, replacing native auth loaders, adding API-key provider behavior, global fetch interception, maintaining a patched OpenCode build, implementing Aperture, or adding WebSocket/residency routing support. This change prepares release artifacts; publishing or choosing a license requires owner approval.

## Capabilities

### New Capabilities

- `installable-aperture-plugin`: A self-contained package, installation and removal documentation, and release preparation that does not require a source checkout.
- `aperture-routing-hardening`: Validated discovery and configuration, native OAuth-preserving routing, scoped headers, safe diagnostics, and observable failure behavior.
- `aperture-compatibility-validation`: Credential-safe packaged integration tests, CI gates, and explicit evidence for supported OpenCode versions and live test coverage.

### Modified Capabilities

None. `openspec/specs/` is empty; the earlier bootstrap specification remains an unarchived change artifact, not an existing main capability to modify.

## Impact

Affected areas include `package.json`, TypeScript/build configuration, the plugin entrypoint and helpers, the local development loader, tests and routing probe, documentation, active OpenSpec project guidance, and new CI configuration. The initial compatibility baseline is stock OpenCode 1.18.29 with HTTP/SSE. No upstream patch, OAuth API change, new token store, or real credentials in CI are required. Publication remains gated on package-name ownership, license approval, and verification results.
