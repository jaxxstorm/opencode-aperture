# installable-aperture-plugin Specification

## Purpose

Define self-contained OpenCode plugin packaging, controlled distribution contents, installation and removal guidance, and explicit publication prerequisites.

## Requirements

### Requirement: Self-contained installable package

The package SHALL expose one OpenCode plugin factory as its runtime root export and SHALL load from its distributed ESM build without repository-relative source imports, a consumer-side build, or developer dependencies.

#### Scenario: Clean consumer installation
- **WHEN** a packed release candidate is installed in a temporary consumer directory without the source checkout and registered with stock OpenCode
- **THEN** OpenCode loads the plugin and performs provider discovery against the configured mock gateway
- **AND** no import resolves to this repository's source or hidden development plugin tree

#### Scenario: Loader sees a single plugin
- **WHEN** OpenCode inspects the installed package root exports
- **THEN** helper functions are not interpreted as additional plugins

### Requirement: Controlled package contents

The package SHALL declare an explicit distribution file allowlist and reproducible build/pack commands. The release candidate SHALL contain its runtime build and user documentation, and SHALL exclude local OpenCode configuration, test fixtures, auth material, and development-only artifacts.

#### Scenario: Inspect release tarball
- **WHEN** the build and pack checks run from a clean dependency installation
- **THEN** the tarball contains every referenced runtime file and no excluded development or credential files

### Requirement: Documented installation and removal

User documentation SHALL describe native OpenAI subscription login, version-pinned package registration, host/debug configuration, trusted-gateway requirements, restart behavior, supported versions, and removal. It SHALL distinguish package installation from repository-local development loading and SHALL warn against loading both together.

#### Scenario: Migrate a local installation
- **WHEN** a user follows the migration instructions
- **THEN** the local auto-discovered adapter and explicit local registration are removed from the consumer setup before the package is enabled
- **AND** the instructions require restarting OpenCode without migrating credentials

#### Scenario: Remove the plugin
- **WHEN** a user follows the removal instructions and restarts OpenCode
- **THEN** there is no plugin-owned credential state to remove
- **AND** the instructions explain that native routing resumes intentionally

### Requirement: Publication remains an explicit release action

Release preparation SHALL provide checks for package-name ownership, owner-approved licensing, package contents, and compatibility evidence. Automated verification SHALL NOT publish a package or require registry credentials.

#### Scenario: Owner approvals are outstanding
- **WHEN** the package name or license has not been approved
- **THEN** local build, pack, and installation tests remain runnable
- **AND** release documentation identifies publication as blocked rather than selecting license terms or publishing automatically
