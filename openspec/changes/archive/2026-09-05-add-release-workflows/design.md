## Context

At the start of this change, the package already bundled a single self-contained ESM plugin and had synthetic stock-OpenCode tests. `package.json` was private, had no license, and advertised pnpm despite the Bun lockfile and commands. `scripts/integration-support.ts` packed on every consumer invocation and asserted `private: true` and an exact file list without LICENSE.

The existing verification workflow targets Ubuntu and macOS with OpenCode 1.18.29 and Bun 1.3.14. Its manual canary interpolates the version input directly into shell source and only propagates the resolved version to routing, not cleanup verification. CI execution evidence remains separate from local passes. The user approved MIT licensing and requested release automation, not an actual publication in this session.

## Goals / Non-Goals

**Goals:**
- Make a licensed, public npm package installable through OpenCode's ordinary plugin registration.
- Release a verified tarball from an explicit version tag without rebuilding it during publication.
- Reuse current checks and provide simple operator setup and recovery instructions.

**Non-Goals:**
- Changes to plugin loading, routing, headers, native OAuth ownership, or non-destructive setup behavior.
- Real subscription credentials in CI, auth-file access, token persistence, API-key provider behavior, or egress enforcement.
- Automatic version bumping, release bots, prerelease channels, or publishing as part of implementation.

## Decisions

### 1. MIT and public package metadata

The owner confirmed MIT with copyright 2026 Lee Briggs and npm name `@jaxxstorm/opencode-aperture` (normalizing the supplied `jaxxstorm/opencode-aperture` to scoped npm syntax). Add the standard MIT license, set `license: "MIT"`, include LICENSE in the explicit package file list, and remove `private: true`. Keep version `0.1.0`, set repository `https://github.com/jaxxstorm/opencode-aperture`, and align `packageManager` with Bun 1.3.14. Update content assertions to require license text, public metadata, the existing single export, and absence of runtime dependencies. npm scope access remains unverified.

Removing `private` makes publication possible but does not authorize a publication now. Prefer source-controlled release metadata to mutating the manifest during publishing: local and CI tarballs must describe the same package.

### 2. Reusable baseline and separate canary

Allow the existing verification workflow to be called by the release workflow for the tagged commit. Retain PR/main checks and the manual canary; do not let latest-version exploration replace the pinned baseline. Resolve canary input through a quoted environment variable rather than shell interpolation and export the installed exact version for both routing and cleanup. Use explicit tool versions, read-only default permissions, job timeouts, and no registry credentials in verification.

Prefer workflow reuse over duplicating baseline steps that can drift. No network tracing or interception is introduced.

### 3. Stable version tags and exact artifacts

Trigger release preparation on `v*` tag pushes, then validate a stable `vMAJOR.MINOR.PATCH` tag whose suffix exactly equals the checked-out package version. Reject prerelease, malformed, and mismatched tags before publication. Tagging is an explicit maintainer action; implementation creates no tags.

After the pinned baseline succeeds for that commit, build and pack one candidate on Ubuntu. Extend the existing consumer helper and probes to accept a supplied tarball path so the release job can inspect, install, and run routing against that exact file without repacking. Ordinary local tests retain their existing pack-from-checkout behavior. Exercise cleanup using the same candidate. Generate a SHA-256 checksum and upload the verified tarball plus checksum as workflow artifacts.

The publishing job downloads those artifacts and verifies their checksum; it does not rebuild or repack. Publish the tarball explicitly to the public npm registry with provenance, then create the GitHub release for the same tag with the tarball and checksum attached. Record exact tool versions and artifact identity in the workflow summary. Prefer this to publishing a working directory, which could produce bytes different from the tested package.

### 4. Approval and scoped publishing permissions

Use a GitHub `npm` environment with required reviewer approval, configured by the repository owner, for the publishing job. Use npm trusted publishing via GitHub OIDC on a supported GitHub-hosted Ubuntu runner with a pinned supported Node/npm toolchain. Configure the trusted publisher to the exact repository, workflow filename, and environment. Grant `id-token: write` and GitHub release write permissions only where needed, not to baseline/PR/canary jobs. Do not introduce a long-lived npm token fallback.

The environment's protections and npm trust settings are external setup, not guarantees supplied by YAML alone. Configure npm trust for GitHub owner `jaxxstorm`, repository `opencode-aperture`, workflow `release.yml`, environment `npm`, and enable direct npm publish as an allowed action (September 2026 defaults may allow staged publication only). Current [npm guidance](https://docs.npmjs.com/trusted-publishers/) requires npm >=11.5.1, Node >=22.14.0, GitHub-hosted runners, and a public repository with matching package repository metadata for provenance. Pin the supported toolchain in the workflow and document prerequisites before pushing a release tag.

If the package does not exist and its trust settings are unavailable, initial publication may require separately authorized owner authentication and publication of the exact tested tarball. This is not a CI token fallback and does not establish OIDC provenance. Complete the first GitHub release manually from those original bytes and a separately authorized matching tag; the next automated release must use a new package version/tag, since the bootstrap version already exists. Do not attempt account or registry changes during implementation. See `docs/release.md` for operator steps.

Serialize publication runs with non-cancelling concurrency. If a package version already exists, fail clearly without overwriting, silently treating it as published by this run, or creating a misleading GitHub release. Prefer documented manual recovery to an automatic partial-release recovery system: if npm succeeded but GitHub release creation failed, inspect registry integrity and finish the GitHub release with the original verified artifact. Never move a released tag or republish changed bytes under the same version.

## Risks / Trade-offs

- npm name ownership or initial OIDC setup is unavailable -> Keep publication unexecuted and document the required owner actions; do not invent credentials or silently change package names.
- GitHub environment approval is not configured -> Require the owner to configure and verify it before release tags; a workflow environment name alone does not enforce approval.
- Tooling or upstream OpenCode changes -> Pin baseline tools, lint workflows, and record CI results independently of local checks.
- Candidate verification currently repacks -> Add supplied-tarball coverage and assert published bytes match the tested checksum.
- Publishing has external effects that local tests cannot prove -> Use dry runs and fixture tests during implementation; actual npm/GitHub publication needs later explicit authorization.
- npm succeeds but GitHub fails -> Retain workflow artifacts and document completion of the GitHub release without republishing.

## Migration Plan

1. Confirm license notice ownership and package naming, then implement MIT metadata, artifact checks, and workflows.
2. Run locked installation, local verification, workflow linting, release validation tests, and a publish dry run without credentials.
3. Document external setup and pending CI evidence. Update active project guidance without editing previous change artifacts.
4. The owner configures npm publishing and GitHub environment protections and reviews passing baseline CI.
5. On a separately approved release, the owner updates the version if needed and pushes the matching tag, then approves publication.

Before publication, rollback is reverting release-related changes. After publication, fix defects with a new version or an explicitly approved deprecation; do not mutate published versions. Existing local plugin users can switch to the version-pinned registry entry and remove their local adapter to avoid duplicate loading.

## Open Questions

- Does the owner have publish access to npm scope `@jaxxstorm`, and is initial publication needed before trusted publishing can be configured? The scoped name is approved, but access is not checked.
- Are GitHub environment protections available and configured for this repository? This is required operator setup, not an implementation-time account change.
