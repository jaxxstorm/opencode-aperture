## ADDED Requirements

### Requirement: Release only a matching stable version tag

Release automation SHALL accept only stable `vMAJOR.MINOR.PATCH` tags whose suffix equals the tagged source's package version. Invalid or mismatched tags SHALL fail before publishing. PR, main-branch verification, and manual canary runs SHALL NOT publish packages or create releases.

#### Scenario: Matching stable tag
- **WHEN** an owner pushes `v0.1.0` for source declaring version `0.1.0`
- **THEN** release verification is eligible to run for that tagged commit

#### Scenario: Invalid release identity
- **WHEN** the tag is malformed, is a prerelease, or differs from the package version
- **THEN** the release run fails without publishing to npm or creating a GitHub release

### Requirement: Reuse pinned baseline verification

Release automation SHALL require successful baseline verification of the tagged commit on the documented Ubuntu and macOS runners with OpenCode 1.18.29 and Bun 1.3.14. Checks SHALL include locked installation, typechecking, unit tests, build, package inspection, clean-consumer loading, packaged routing, and cleanup. Tests SHALL use synthetic identity data and isolated user state, without real subscription credentials or publication permissions.

#### Scenario: Baseline fails
- **WHEN** any required baseline check fails
- **THEN** the publishing job cannot run and the failed check is visible in CI

#### Scenario: Manual upgrade canary
- **WHEN** a maintainer requests a different OpenCode version or latest
- **THEN** the version input is treated as data rather than executable shell source and the installed exact version is used for both routing and cleanup verification
- **AND** results remain separate from the supported baseline and cannot trigger publication

### Requirement: Publish the verified tarball unchanged

Release automation SHALL create a single candidate tarball, verify its contents and clean-consumer routing using that file, generate a SHA-256 checksum, and retain both as workflow artifacts. Publication SHALL consume that verified artifact without rebuilding or repacking. The GitHub release SHALL attach the same tarball and checksum after npm publication succeeds.

#### Scenario: Candidate reaches publication
- **WHEN** release verification passes and publication is approved
- **THEN** the downloaded artifact's checksum is checked and the exact verified tarball is published to the public npm registry with provenance
- **AND** the GitHub release identifies the same version tag and contains the same tarball and checksum

#### Scenario: Artifact corruption
- **WHEN** the downloaded tarball does not match its recorded checksum
- **THEN** publication fails without sending the candidate to npm

#### Scenario: Candidate supplied to tests
- **WHEN** package and routing checks are given a release tarball path
- **THEN** they install and exercise that file rather than creating a replacement tarball from the checkout

### Requirement: Explicit approval and scoped publishing identity

The publishing job SHALL require the configured `npm` GitHub environment and documented owner approval. It SHALL authenticate through npm trusted publishing with GitHub OIDC and SHALL NOT use a long-lived npm token fallback. Publication and GitHub release permissions SHALL be limited to the jobs that need them. Release runs SHALL be serialized without cancelling an in-progress publication.

#### Scenario: Approval is pending
- **WHEN** candidate verification succeeds but the protected environment has not been approved
- **THEN** the publishing job waits and no package or GitHub release is created

#### Scenario: Trusted publisher is not configured
- **WHEN** npm cannot authenticate the configured workflow and environment
- **THEN** publication fails visibly without falling back to another credential source

#### Scenario: Ordinary verification
- **WHEN** a pull request, main-branch check, or manual canary runs
- **THEN** the run has no npm publishing identity or GitHub release write permission

### Requirement: Clear setup and failure recovery

Release documentation SHALL describe package-name ownership, GitHub environment protections, npm trusted-publisher setup, initial-publication prerequisites, tag/version preparation, and partial-failure recovery. Existing package versions SHALL fail clearly rather than being overwritten or silently treated as published by the current run. Implementation verification SHALL use dry runs and fixtures, SHALL NOT publish or create tags, and SHALL distinguish local validation from actual CI and publication evidence.

#### Scenario: Package version already exists
- **WHEN** a release attempts to publish an existing name/version
- **THEN** it reports the conflict without overwriting it or creating a new GitHub release that implies successful publication by this run

#### Scenario: npm succeeds but GitHub release creation fails
- **WHEN** the package was published but the GitHub release step fails
- **THEN** the failure is visible and the original tarball and checksum remain available for documented operator recovery without republishing

#### Scenario: First publication requires owner setup
- **WHEN** package ownership or trusted publishing is not yet established
- **THEN** documentation identifies the owner actions still needed and any separately authorized bootstrap publication rather than claiming automation is already operational
