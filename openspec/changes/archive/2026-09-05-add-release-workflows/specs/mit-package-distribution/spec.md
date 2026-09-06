## ADDED Requirements

### Requirement: Distribute the approved MIT license

The package SHALL declare `license: "MIT"` and include a LICENSE file containing the standard MIT text and an owner-confirmed copyright notice. Package verification SHALL reject missing or inconsistent license metadata or contents.

#### Scenario: Consumer receives the license
- **WHEN** the release candidate is packed and installed outside the checkout
- **THEN** its manifest identifies MIT and its installed LICENSE contains the approved notice and full MIT text

#### Scenario: License omitted from the candidate
- **WHEN** license metadata or the packaged LICENSE is missing or inconsistent
- **THEN** package verification fails before publication

### Requirement: Public self-contained package

The release candidate SHALL use the owner-confirmed package name and source-controlled version, SHALL NOT set `private: true`, and SHALL retain the single self-contained ESM plugin export. The documented package manager SHALL match the locked Bun workflow. Verification SHALL assert an explicit package-content allowlist including LICENSE, the bundle, manifest, README, and intended docs, with no runtime dependencies, development scripts, local configuration, or credentials.

#### Scenario: Clean consumer installation
- **WHEN** the candidate tarball is installed without repository sources or development dependencies
- **THEN** its root import exposes exactly one default plugin factory and resolves without a consumer build step

#### Scenario: Unexpected package content
- **WHEN** the candidate contains a file outside the reviewed allowlist or remains private
- **THEN** verification fails with an actionable package error

### Requirement: Keep runtime behavior unchanged

Release preparation SHALL NOT modify the plugin's native OAuth ownership, Aperture routing, request headers, or non-destructive setup behavior. Documentation SHALL explain version-pinned registry installation after publication and removal of local adapters to prevent duplicate loading.

#### Scenario: Existing routing suite
- **WHEN** package metadata and release workflows change
- **THEN** the existing unit and packaged routing checks continue to pass without adding authentication handling or provider-disabling behavior

#### Scenario: Unpublished candidate
- **WHEN** documentation is read before the first successful publication
- **THEN** it distinguishes local tarball installation from the not-yet-available registry package and does not claim publication has occurred
