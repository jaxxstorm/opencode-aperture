# Releases

`@jaxxstorm/opencode-aperture@0.1.0` is prepared for public npm distribution under MIT, copyright 2026 Lee Briggs, but is **unpublished**. The name and license are owner-confirmed; plugin publishing access is not checked. The owner has published `@jaxxstorm/bun-tailscale-bridge@0.1.0`; its registry-confirmed Bun engine requirement is `1.4.2`. Earlier local results are historical, not verification of this release-readiness revision. No plugin tag, publication, release, or account-setting change has been performed by this work. CI execution and real plugin publishing remain unverified.

## Owner Setup

Complete these external prerequisites before authorizing a release. Workflow YAML alone does not establish trust or require human approval.

1. Confirm the publishing owner can publish public packages in npm scope `@jaxxstorm`. Confirm the GitHub repository is public and the manifest repository URL identifies exactly `https://github.com/jaxxstorm/opencode-aperture` (the manifest may use `git+https://github.com/jaxxstorm/opencode-aperture.git`). Public source and an exact repository match are required for provenance.
2. Create the GitHub environment **`npm`** with a **required reviewer** and appropriate release-tag restrictions. Verify that publication actually waits for approval; merely naming the environment is insufficient.
3. In the npm package's trusted-publisher settings, select GitHub Actions: owner **`jaxxstorm`**, repository **`opencode-aperture`**, workflow filename **`release.yml`**, environment **`npm`**. Enable the allowed action for **direct npm publish**; September 2026 defaults may allow staged publishing only, which is not this workflow's publication path.
4. Use GitHub-hosted runners and the pinned Node/npm versions in `release.yml`. npm trusted publishing requires **Node >=22.14.0 and npm >=11.5.1**. Build/test and worker execution use external Bun **1.4.2** with stock OpenCode **1.18.29**, whose embedded Bun **1.3.14** is distinct. OIDC supplies short-lived publishing identity; do not configure a long-lived `NPM_TOKEN` fallback.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for current service prerequisites. Repository visibility, environment protections, npm ownership, and allowed publisher actions must be checked by the owner; none is confirmed by local tests.

## First Publication

If the package does not yet exist and npm cannot expose its trusted-publisher settings, an owner-authenticated initial publication may be necessary. This is a separate, explicitly authorized bootstrap action, not a token fallback in CI.

1. Finish candidate verification below and obtain owner authorization for the **exact tested tarball and checksum**, public name, and version. Use the retained workflow candidate if available; never replace tested bytes by publishing the checkout.
2. Only after authorization, the owner authenticates locally using npm's supported interactive login/2FA and publishes that file with `npm publish /absolute/path/to/jaxxstorm-opencode-aperture-0.1.0.tgz --access public --ignore-scripts --registry=https://registry.npmjs.org`. This is a real publish command, not a verification step. Local bootstrap does not establish GitHub OIDC provenance; do not claim that it does.
3. Verify registry integrity against the tested file, then configure npm trust as above. If a matching tag does not exist, separately authorize creating it at the tested commit. Do not approve an automated attempt to publish the already-published version. Complete the first GitHub release manually with that exact tag, tarball, and checksum using the recovery procedure below.
4. The next automated release needs a **new package version and matching new tag**. Retrying `v0.1.0` after a bootstrap publication of `0.1.0` fails the existing-version check; it is not an OIDC migration test.

## Release Procedure

### Automated Preparation

Commit the release script and any feature changes first: preparation requires a clean worktree and an `origin` remote. Use external Bun 1.4.2. Choose a new stable package version; never reuse a failed or published tag.

```sh
# Read-only preflight: checks local/remote tags and npm availability.
bun run release -- 0.1.2 --dry-run

# Bump, verify, commit, tag, and atomically push to trigger release.yml.
bun run release -- 0.1.2 --commit --push
```

The command updates only this plugin's package version, runs `bun install --ignore-scripts`, typecheck, unit tests, build, and clean-consumer package verification. The bridge dependency version stays unchanged. Before tagging, it verifies that the committed manifest matches the requested version. The push sends only the current branch and requested tag; it never force-pushes or publishes directly to npm. GitHub Actions performs the full routing checks and approval-gated publication.

Without `--push`, `--commit` creates the local release commit and annotated tag only. Without either option, the command leaves the verified manifest/lockfile changes for manual review and commit; it does not support resuming that dirty state automatically. `--dry-run` may be combined with both flags to inspect preflight for the full operation without writing files or refs.

Existing local/remote tags, existing npm versions, registry/network errors, dirty worktrees, detached HEADs, non-increasing versions and failed checks stop preparation. For a push, the remote branch must be an ancestor of local HEAD; fetch/rebase manually if needed. Failures deliberately leave files, commits and tags in place for inspection rather than rolling back or deleting user work. After a commit or push failure, inspect local/remote state and follow Recovery below; do not blindly rerun or force-move tags.

### Candidate Pipeline

1. Update the source-controlled version and review [verification](verification.md) and [compatibility evidence](compatibility.md). Inspect the three allowlisted bundles, manifest, README, docs, and LICENSE; exclude credentials and development files. Preserve the server factory, separate TUI export, internal worker, and native OAuth ownership. Require the main workstream's exact optional bridge `0.1.0` pin, `packageManager: bun@1.4.2`, lockfile update, removal of server/TUI enable guards, and updated clean-consumer checks before accepting a candidate.
2. Record exact local results, including a credential-free publish dry run against the final candidate. Review the pinned Ubuntu/macOS baseline results separately. Require reported clean-consumer results for the published bridge and omitted-optional-dependency direct mode; do not infer them from workflow edits. Real-package checks are distinct from actual enrollment, which is not performed in CI. Live tests are optional, outside CI; native OAuth refresh/live tools and unsupported WebSockets/residency remain explicit limitations. Synthetic catalog refresh is a separate mandatory check below.
3. After explicit release authorization and owner setup, push `vMAJOR.MINOR.PATCH` for the reviewed commit, with the suffix exactly matching `package.json`. Prerelease, malformed, and mismatched tags are rejected. There is no automatic version bump.
4. `release.yml` requires reusable `verify.yml` baseline checks for that commit, then builds and packs **one** release candidate on mandatory **macOS**. Package, direct routing, cleanup, production gateway (`--bridge-production-gateway`), subscription (`--bridge-production`), and catalog refresh (`--bridge-production-refresh`) checks all consume that same file via `APERTURE_TEST_TARBALL`, without repacking. After checking unchanged bytes, it retains the tarball and SHA-256 checksum as workflow artifacts for 90 days and reports external/embedded runtime versions and artifact identity. The publishing job does not substitute a Linux rebuild.
5. Review the candidate and approve the protected `npm` environment. The publishing job downloads it, verifies the checksum, and publishes unchanged bytes with OIDC and provenance, without rebuilding or repacking. Only after npm succeeds does it create the GitHub release with the same tarball and checksum.

PR/main verification and the separate manual latest-version canary cannot publish. Publication runs are serialized without cancelling an in-progress run. Existing npm versions fail explicitly rather than being overwritten or accepted as success for this run.

## Platform Gates

The Ubuntu/macOS baseline uses external Bun 1.4.2 for locked install, typecheck, unit tests, build, and package inspection. The older direct routing and cleanup probes support Linux using loopback fixtures, but do not enforce a Linux egress sandbox. All three production probe modes explicitly require macOS `sandbox-exec`; they are gated to macOS in the baseline and mandatory in the macOS candidate job, never silently skipped for a release. OpenSSL 3 supplies fixture certificate generation with `req -addext`; `APERTURE_TEST_TMPDIR=/tmp` keeps private randomized Unix socket paths within the worker's 100-byte limit. Production probes use fake bridge modules and synthetic credentials, not real tailnet enrollment or live inference. The Linux-only latest-version canary does not cover production bridge probes.

Workflow wiring is not execution evidence. Main-workstream package/guard changes and their reported verification, successful hosted baseline/candidate runs, and owner approval/OIDC setup remain release prerequisites. Unit tests that require `APERTURE_SDK_TEST_DIR` are not enabled by these workflows; historical SDK-enabled unit counts must not be attributed to CI.

Local release-readiness checks pass: 363 tests with pinned SDK probes enabled, typecheck, build, workflow lint, and clean-consumer checks both including and omitting the published bridge. The manifest and lockfile pin bridge 0.1.0, the toolchain uses Bun 1.4.2, and server/TUI activation needs no environment flag. Published-package verification checks import, matching helper binary metadata and worker resolution without starting a real helper. Hosted CI execution and owner approval/OIDC setup remain unverified.

## Recovery

Before retrying any failed publication, inspect npm to determine whether the version exists. If it does not, fix the cause and recheck the candidate and approval requirements. Never move a released tag or overwrite a published version; code or package changes require a new version and tag.

If npm succeeded but GitHub release creation failed, **do not rerun publication**. Download the tarball and checksum from the original workflow run (`gh run download RUN_ID --repo jaxxstorm/opencode-aperture`, selecting its candidate artifact). Verify SHA-256 with `shasum -a 256 -c CHECKSUM_FILE`. Inspect `npm view @jaxxstorm/opencode-aperture@VERSION dist.integrity dist.tarball --registry=https://registry.npmjs.org` and compare the original tarball's SHA-512 SRI with `dist.integrity`, or download the registry tarball and compare its SHA-256 with the original. npm's SRI and the release SHA-256 are different digest formats, not directly comparable.

Verify the tag still identifies the tested commit and inspect `gh release view vVERSION --repo jaxxstorm/opencode-aperture`. If absent, create it manually with `gh release create vVERSION TARBALL CHECKSUM_FILE --verify-tag --generate-notes --repo jaxxstorm/opencode-aperture`. If the release exists but lacks assets, inspect its existing assets and upload only missing files with `gh release upload vVERSION TARBALL CHECKSUM_FILE --repo jaxxstorm/opencode-aperture`, without `--clobber`. Use actual verified paths/version in these placeholder commands. If original bytes cannot be recovered or integrity differs, stop and investigate; do not repack, retag, or substitute assets.
