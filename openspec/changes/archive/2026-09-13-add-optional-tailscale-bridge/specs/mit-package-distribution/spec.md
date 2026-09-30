## MODIFIED Requirements

### Requirement: Public self-contained package

The reviewed package-content allowlist SHALL include `dist/index.js` with exactly one default server plugin function, self-contained `dist/bridge-worker.js`, and optional TUI subpath `dist/tui.js`, not another root plugin export. Both external and future verified embedded runtime modes SHALL execute the same worker/protocol without consumer builds or runtime downloads. External Bun is an explicitly selected executable prerequisite for enabled worker mode, not a bundled runtime or implicit embedded upgrade. The optional bridge import SHALL occur only inside the enabled worker; synthetic infrastructure SHALL NOT imply verified bridge/helpers. Bridge-disabled server loading SHALL NOT load TUI, spawn or resolve a worker runtime.

The release candidate SHALL use the owner-confirmed package name and source-controlled version, SHALL NOT set `private: true`, and SHALL retain a single default ESM plugin export with a self-contained bridge-disabled path. The documented package manager SHALL match the locked Bun workflow. Verification SHALL assert an explicit package-content allowlist including LICENSE, bundles, manifest, README, and intended docs, with no required runtime dependencies, development scripts, local configuration, or credentials. The sole permitted optional runtime dependency SHALL be exactly `@jaxxstorm/bun-tailscale-bridge@0.1.0`, lazily loaded only when enabled. Registry E404/optional resolution absence SHALL be tolerated for disabled consumers and SHALL NOT be presented as available registry installation. Explicit modulePath SHALL support an absolute trusted JS entry from a separately installed built local tarball. No developer machine-local file dependency SHALL be committed. Its installed distribution SHALL include required native helpers and dependency notices without consumer compilation, runtime downloads, or install scripts. Checksum/content inspection with zero-commit metadata SHALL leave provenance and native helper verification unverified until separately demonstrated. Publication remains separately authorized and gated; no package SHALL be published by implementation or tests.

#### Scenario: Clean consumer installation
- **WHEN** the candidate tarball is installed without repository sources or development dependencies
- **THEN** its root import exposes exactly one default plugin factory and resolves without a consumer build step

#### Scenario: Unexpected package content
- **WHEN** the candidate contains a file outside the reviewed allowlist or remains private
- **THEN** verification fails with an actionable package error

#### Scenario: Optional dependency omitted
- **WHEN** the candidate is installed with optional dependencies omitted
- **THEN** bridge-disabled loading and routing work unchanged without resolving the bridge package

#### Scenario: Optional dependency installed
- **WHEN** the candidate and pinned bridge are installed in a clean supported consumer with scripts disabled
- **THEN** the bridge's native helper is present and executable with its required notices and no Go toolchain or system Tailscale client is needed
- **AND** verification rejects unexpected external runtime imports, optional dependencies, or credential/state files

#### Scenario: Upstream registry release unavailable
- **WHEN** optional 0.1.0 resolution returns E404 or is omitted
- **THEN** clean installation and disabled routing tolerate absence, while enabled setup without a usable module returns a sanitized error without native-config mutation
- **AND** a separately installed checksummed tarball can be explicitly selected by trusted absolute modulePath without runtime compilation/download or a committed developer file dependency
