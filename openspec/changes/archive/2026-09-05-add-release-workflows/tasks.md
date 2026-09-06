## 1. MIT Package Metadata

- [x] 1.1 Confirm the copyright holder and intended npm package name with the owner; check current npm trusted-publishing prerequisites and record any required initial-publication setup without changing registry state.
- [x] 1.2 Add the standard MIT LICENSE with the confirmed notice, set MIT metadata, include LICENSE in packaged files, remove the private flag, and align package-manager metadata with Bun 1.3.14; update the lockfile only as needed.
- [x] 1.3 Update package-content and manifest assertions for MIT and public distribution while preserving the single self-contained export; test rejection of missing license, private metadata, and unexpected files.

## 2. Exact Candidate Verification

- [x] 2.1 Extend consumer creation and package/routing/cleanup scripts to accept an explicit tarball path without repacking; preserve ordinary local pack-from-checkout usage.
- [x] 2.2 Test supplied-tarball installation independently of checkout build contents, including invalid candidate rejection and temporary-state cleanup.
- [x] 2.3 Add a small release identity/checksum validation path with tests for matching stable tags, malformed/prerelease/mismatched tags, and checksum mismatches; ensure checks need no publication credentials.

## 3. Reusable Verification

- [x] 3.1 Expose the existing Ubuntu/macOS pinned baseline through workflow_call while retaining PR/main checks; define read-only defaults, pinned tools, and bounded jobs without publishing permissions.
- [x] 3.2 Treat canary version input as quoted environment data, propagate the resolved exact version to routing and cleanup, and keep the manual canary separate from release eligibility.

## 4. Release Workflow

- [x] 4.1 Add the version-tag release workflow with tag/package validation and required reusable baseline checks for the tagged commit; reject invalid release identities before publication.
- [x] 4.2 Build and pack one release candidate, verify that supplied tarball with package/routing/cleanup checks, and upload the candidate plus SHA-256 checksum; report exact tool versions and artifact identity.
- [x] 4.3 Add an approval-gated npm publishing job using the protected npm environment and GitHub OIDC with a supported pinned Node/npm toolchain; restrict permissions, serialize releases without cancellation, verify downloaded checksums, and publish the verified tarball without rebuilding.
- [x] 4.4 Create the GitHub release only after successful npm publication and attach the same tarball and checksum; fail clearly on existing versions and retain artifacts for partial-failure recovery.

## 5. Documentation and Validation

- [x] 5.1 Update README, release/verification/compatibility docs, and active OpenSpec guidance for MIT, public-package preparation, version tags, npm trust/first-publication setup, required environment approvals, and recovery; preserve historical artifacts and do not claim publication has occurred.
- [x] 5.2 Lint workflows and exercise release validation with fixtures or dry runs, covering rejected tags, artifact mismatches, existing versions, permission boundaries, and publish ordering without sending a real publish request or creating tags/releases.
- [x] 5.3 Run locked install, typecheck, unit tests, build, package checks, routing, cleanup, and a credential-free publish dry run against the final candidate; record exact local results and outstanding CI/operator setup separately.

## Implementation Checkpoint (September 5, 2026)

Owner-confirmed copyright: Lee Briggs. Package: `@jaxxstorm/opencode-aperture@0.1.0`, MIT, prepared for public distribution but unpublished. Runtime plugin source was not changed.

Local environment: darwin-arm64, stock OpenCode 1.18.29, Bun 1.3.14, Node 25.9.0, npm 11.12.1. CI separately pins Node 22.14.0/npm 11.5.1; those CI runs and OIDC publication have not been executed here.

Passed:
- `bun install --frozen-lockfile`, `bun run typecheck`, and `bun test`: 79 tests, 283 assertions.
- `actionlint .github/workflows/verify.yml .github/workflows/release.yml` and strict OpenSpec validation.
- `bun run build`, ordinary pack-from-checkout package/routing checks, and cleanup verification.
- Final candidate built with `npm pack --ignore-scripts --pack-destination release-artifacts` after the build. `APERTURE_TEST_TARBALL` selected that unchanged file for `bun run test:package`, `bun run test:routing`, and `bun scripts/verify-probe-cleanup.ts`. All passed, including text, tools, concurrency, cancellation, other-provider scoping, and failure/SIGTERM cleanup.
- Release checksum creation/verification using `GITHUB_REF_NAME=v0.1.0` as a local fixture value only; no git tag was created.
- `npm publish <candidate> --dry-run --ignore-scripts --access public --registry=https://registry.npmjs.org` with an empty inherited environment except PATH, a fresh temporary HOME/workdir, and empty npm user/global config paths. Passed with the expected not-logged-in dry-run warning; no publication occurred. Checksum verification passed again afterward.

Candidate: `release-artifacts/jaxxstorm-opencode-aperture-0.1.0.tgz` (8 files, approximately 13.3 kB). Packaged contents: LICENSE, README.md, dist/index.js, docs/compatibility.md, docs/live-validation.md, docs/release.md, docs/verification.md, package.json.

SHA-256: `ad2a053eef1f3479a34be0f48da88353779c4400e738a44efc04515823775960`. The companion `.tgz.sha256` file is retained with the ignored local artifact. A future build can produce a different checksum and requires its own verification.

Remaining external actions: review actual Ubuntu/macOS CI results; confirm npm scope access and any first-publication bootstrap; configure the `npm` GitHub environment with required reviewers; configure npm trust for owner `jaxxstorm`, repository `opencode-aperture`, workflow `release.yml`, environment `npm`, allowing direct `npm publish`. A public repository is required for provenance. No registry/account settings, tags, commits, pushes, GitHub releases, or live subscription requests were made during this change.
