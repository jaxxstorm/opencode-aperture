# Developer Verification

Use stock OpenCode **1.18.29** and Bun **1.3.14**. Run from a source checkout:

```sh
opencode --version
bun --version
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run test:package
bun run test:routing
bun scripts/verify-probe-cleanup.ts
```

The build produces self-contained `dist/index.js`. Package checks inspect the tarball allowlist, MIT license and public package metadata, install it outside the checkout, and verify a single plugin factory export without runtime imports or a consumer build step. Development scripts, local config, source adapters, fixtures, and credentials must not ship. Verification never publishes.

## Exact Release Candidate

Ordinary local checks pack from the checkout. To test one candidate without repacking, build once as above, then pack once with `npm pack --ignore-scripts` and use the resulting file for all three checks:

```sh
export APERTURE_TEST_TARBALL="$PWD/jaxxstorm-opencode-aperture-0.1.0.tgz"
bun run test:package
bun run test:routing
bun scripts/verify-probe-cleanup.ts
shasum -a 256 "$APERTURE_TEST_TARBALL"
npm publish "$APERTURE_TEST_TARBALL" --dry-run --ignore-scripts --access public --registry=https://registry.npmjs.org
unset APERTURE_TEST_TARBALL
```

Use the actual candidate path/version, or a downloaded workflow candidate without building or packing again. Run the dry run without publication credentials; it is not proof of npm ownership, OIDC, approval protection, provenance, or publication success. Preserve the tarball and checksum for approval and recovery. See [release setup](release.md) for the only authorized publication paths.

## Harness Scope

The harness runs stock OpenCode against the installed tarball using ordinary cross-platform POSIX process spawning, isolated HOME/XDG config and storage, and synthetic auth registered through OpenCode's API. It must not read or modify real user auth. Startup, requests, and cleanup are bounded; the cleanup verifier checks processes, listeners, and temporary storage after failure and handled termination. Diagnostics must not dump credentials or raw logs.

Packaged coverage consists of `/codex/responses` and native headers, the OpenAI-only debug marker, completed Responses SSE text, a harmless tool round trip, concurrency, gateway-observed cancellation, and another provider's isolation. Assert session results, not just CLI exit status. Unit tests cover host, discovery, model/configuration, and non-destructive sanitized setup errors.

This is functional verification, not network enforcement. No egress tracing or blocking environment is required. Forced setup-failure routing, 429/5xx, and connection-failure tracing are not release gates.

## CI and Evidence

The reusable `verify.yml` baseline targets Ubuntu and macOS with OpenCode 1.18.29 and Bun 1.3.14, retaining PR/main checks and serving as a release prerequisite. A latest-version canary is manual-only and separate from release eligibility and baseline support claims; its resolved exact OpenCode version is propagated to routing and cleanup. CI verification uses synthetic credentials, has no publishing permissions, needs no registry credentials, and runs no live tests.

The release-workflow revision passes locked installation, typecheck, 79 tests (including supplied-archive and release fixtures), build, package/routing checks, cleanup, and workflow lint on darwin-arm64. Exact candidate checksums and dry-run results are recorded in the implementation checkpoint in `openspec/changes/archive/2026-09-05-add-release-workflows/tasks.md`, outside the package. CI execution, canary results, and real publishing remain unverified; see [compatibility](compatibility.md).
