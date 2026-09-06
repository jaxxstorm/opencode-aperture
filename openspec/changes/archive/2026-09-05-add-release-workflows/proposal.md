## Why

The plugin can be built and installed locally, but users still need a published package and maintainers need a repeatable release process. Add CI-driven releases and the user-approved MIT license without changing the working config-only Aperture integration.

## What Changes

- Add MIT license metadata and a packaged LICENSE file with the owner-confirmed copyright notice, 2026 Lee Briggs.
- Prepare the owner-confirmed `@jaxxstorm/opencode-aperture@0.1.0` for public npm distribution, replacing the private-package assertions with publishable-package checks; npm scope access remains unverified.
- Reuse baseline verification for version-tag releases and retain the separate manual compatibility canary.
- Add a release workflow that validates the tag/version, verifies a single release tarball, and publishes that same artifact to npm with provenance after an approval gate.
- Attach the tarball and checksum to a GitHub release and document npm trusted publishing, first-publication setup, and failure recovery.
- Correct the existing canary's version propagation and unsafe shell interpolation as part of making the workflows reusable.

Non-goals: modifying plugin routing or failure behavior, implementing OAuth, reading auth files, persisting tokens, adding API-key provider behavior, network interception, automatic version bumps, or actually publishing during implementation.

## Capabilities

### New Capabilities
- `mit-package-distribution`: MIT licensing and verified, publishable package contents.
- `verified-package-releases`: Verified version-tag releases to npm and GitHub, with scoped permissions and documented operator setup.

### Modified Capabilities

None. `openspec/specs/` is empty. This change builds on the implementation from `prepare-plugin-distribution` without rewriting that historical change's artifacts.

## Impact

Affected files include `.github/workflows/`, `package.json`, the dependency lockfile if metadata changes require it, a new `LICENSE`, package verification helpers, README and release documentation, and active OpenSpec project guidance. External setup includes npm scope access/trusted publishing and a required-reviewer GitHub `npm` environment for `jaxxstorm/opencode-aperture`. The package remains unpublished; initial owner-authenticated publication may require separate authorization before npm trust can be configured. Native OpenCode OAuth, provider configuration, and the plugin runtime remain unchanged.
