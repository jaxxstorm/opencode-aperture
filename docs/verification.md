# Developer Verification

Reference checks and historical evidence, not onboarding: start with [How to Use](how-to-use.md) or [Build from source](build.md). The current npm release is **`@jaxxstorm/opencode-aperture@0.1.4` (published)**. Recorded counts, pending checks, and non-publication statements below refer to their historical runs, not a new verification of 0.1.4.

The release build/test harness and external bridge worker use **Bun 1.4.2**, with stock **OpenCode 1.18.29**. OpenCode's embedded Bun is separate; historical direct-routing checks used embedded Bun **1.3.14**. Run from a source checkout:

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

The build command is:

```sh
bun build ./src/index.ts ./src/bridge-worker.ts ./src/tui.ts --target bun --outdir dist --external @jaxxstorm/bun-tailscale-bridge
```

Package checks inspect the exact tarball allowlist, MIT license and public metadata, then install outside the checkout without a consumer build step. The manifest `files` array is exactly `['dist/index.js', 'dist/bridge-worker.js', 'dist/tui.js', 'LICENSE', 'README.md', 'docs/']`. Exports are exactly `{ '.': './dist/index.js', './server': './dist/index.js', './tui': './dist/tui.js' }`; the worker is internal. Checks validate referenced files, parse each runtime bundle, verify the single default callable root factory and identical `/server` factory, and import the separate default TUI `{ id, tui }` module.

Detected imports may only be actual Node builtins validated by `isBuiltin`, except the worker's dynamic `@jaxxstorm/bun-tailscale-bridge` import. Bun normalizes some `node:` prefixes, so actual bare builtin names are accepted too; arbitrary package names and invented `node:` names remain rejected. TUI SDK type imports must erase during bundling. `Bun.Transpiler.scanImports` does **not** detect computed dynamic expressions: the known worker `import(pathToFileURL(modulePath).href)` is deliberately permitted for explicit user-trusted local code and guarded by runtime absolute-JS-path validation, not certified by the package scanner. Review any new computed imports manually. Do not execute the worker during simple package loading checks.

The only allowed runtime dependency is the exact optional dependency `@jaxxstorm/bun-tailscale-bridge@0.1.0`, published on npm. Package checks install the candidate both with and without it, with install scripts disabled. They verify normal server/TUI registration without an activation flag, installed bridge resolution without `modulePath`, matching helper binary metadata, and direct-mode operation with the bridge omitted. Helper startup and enrollment are not performed by these checks. Development scripts, source adapters, fixtures, test packages/data, local config, and credentials must not ship. Verification never publishes.

For the bounded supplied-archive unit fixtures specifically, run `bun test test/package.test.ts`. Fixtures provide valid runtime JS for all three entries; fixture bytes must come from the supplied archive, not a repack of the checkout. Release scripts consume the shared `packageFiles` list, so the expanded allowlist also applies to candidate and release verification.

The earlier builtin-prefix packaging failure is resolved: `isBuiltin` recognizes actual Node builtins after Bun normalization. `bun run test:package` passed for all three built entries in a clean consumer on Bun 1.4.2, darwin-arm64. This does not waive final artifact verification or publication gates.

## Exact Release Candidate

Ordinary local checks pack from the checkout. To test one candidate without repacking, build once as above, then pack once with `npm pack --ignore-scripts` and use the resulting file for all three checks:

```sh
export APERTURE_TEST_TARBALL="/absolute/path/to/verified-candidate.tgz"
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

Historical direct-routing checks are functional verification, not network enforcement. For the bridge candidate, separately verify worker/version/startup failure, private Unix forwarding, native headers and streaming/cancellation, and the parent listener's lifetime: worker death retains a `503` mapping, instance disposal revokes it with `403`, and the port remains bound until parent exit. Initial plugin setup failure still leaves native configuration unchanged. Same-user/root attackers are out of scope.

Keep fake-module loopback checks separate from real bridge artifact import/helper launch-protocol checks. Neither proves live enrollment, tailnet access, or inference. Do not run live enrollment implicitly or inspect native user credentials. The inspected local artifact checksum and unverified provenance are recorded in [compatibility](compatibility.md).

Check TUI setup using both registrations in [How to Use](how-to-use.md) and the settings in [configuration](configuration.md): `/aperture-setup`, `/aperture-status`, and `/aperture-disconnect` operate only locally. Validate browser-link cancellation, environment-variable-name-only enrollment, private `600` settings and `700` identity storage, and restart semantics. Setup has no state-path prompt. `/aperture-forget` must require disabled saved settings, confirmation, and a private plugin-owned unlocked profile, retain disabled settings, refuse unsafe deletion, and leave native auth and remote device revocation untouched. Environment host overrides must still take precedence over the saved HTTPS gateway. TUI tests and package imports do not by themselves prove OpenCode interactive loading.

## CI and Evidence

### Historical Production Verification

`bun scripts/probe-routing.ts --bridge-production` passed all five installed native HTTPS scenarios on OpenCode 1.18.29 / embedded Bun 1.3.14 with external worker Bun 1.4.2, darwin-arm64. Only the bridge factory module is fake: the installed index, guard and worker execute production code, with one proxied discovery before atomic activation. The fake module wraps worker-global fetch to assert the supplied proxy and fixed upstream before adding the per-request fixture CA to a real HTTP proxy fixture request. No parent/native auth-fetch replacement or production source patch is used. The source-built worker retains real bridge imports and explicit user-trusted `modulePath` loading.

The macOS native sandbox permits localhost TCP and the specific private `apb.../s` Unix endpoints needed by `node:http`, with no external networking. Fixture state has a dedicated `0700` parent. Do not broaden this to arbitrary Unix sockets or place state directly under a shared temporary parent.

The following supplied final actual results are **after continuous state lease and shared runtime pool wiring and source build**, superseding provisional/pending counts. This documentation-only update records those runs rather than rerunning feature tests.

| Command | Final result |
| --- | --- |
| `bun install --frozen-lockfile` | No changes; 32 installs / 38 packages. |
| `bun run build` | Three entries, eight modules; index 40.89 KB, worker 36.68 KB, TUI 34.22 KB. |
| `bun run typecheck` | Pass. |
| `bun test` | 200 pass, 0 fail, 922 expectations across 12 files. |
| `bun run test:package` | All three bundles passed clean-consumer checks. |
| `bun scripts/probe-routing.ts --bridge-production` | All five text/tool/concurrency/cancellation/other-provider scenarios passed. |
| `bun scripts/probe-routing.ts --bridge-production-errors` | 429 -> native retry: two gateway requests; 307: one gateway request, zero redirect-sink requests; TLS rejection of untrusted fixture CA: zero inference gateway requests. All containment assertions passed. |
| `bun run test:routing` (default native probe) | All five scenarios passed. |
| `bun scripts/verify-probe-cleanup.ts` | Both failure/interruption scenarios passed. |
| `env BUN_BE_BUN=1 opencode test test/bridge-ingress.test.ts` | Embedded Bun 1.3.14: eight pass, 79 expectations. |
| `openspec validate --all --strict` | All six items passed. |

The error probe's negative prompts remained pending after 500 ms and were parent-aborted. Its redirect/TLS containment assertions are not completed negative-error UX evidence. Each native cleanup reported TCP-refused listeners, removed storage and stopped children. Actual user `opencode.json`, `tui.json` and global settings remain untouched; the local setup flow is implemented, not automatically configured.

The real bridge artifact was separately checksum-verified, installed offline with scripts ignored under an empty-environment, network-denied sandbox, and its `createBridge`/`BridgeError` exports imported without calling `createBridge`. All four helpers were `0755`. The darwin-arm64 helper in a fresh HOME under deny-all-network containment rejected protocol `999` with `PROTOCOL_ERROR`, exit 1, no timeout/stderr. No live enrollment occurred. The all-zero release commit still prevents a source-provenance claim; nothing was published.

Explicitly deferred: real interactive TUI/browser loading, privacy and cancellation; live tailnet/gateway operation; native refresh and persistence; completed negative-error UX and remaining status/TLS/redirect variations; full backpressure/memory stress; telemetry/transcript and encoded/persisted secret scans; exhaustive raw-wire variations; actual cross-UID replacement/race attacks and broader failure/cached-retry lifecycle stress; remaining optional/helper/platform checks and CI. Guard permissions/architecture and embedded ingress units do not establish actual cross-UID attack resistance experimentally. Active tasks 1.3, 1.4, 1.9, 1.10, 1.17 and 5.1-5.3 remain unchecked for these residual checks. Implementation is complete; these are deferred verification, not code blockers or a need for new implementation authorization. No publication, live credentials, enrollment or refresh occurred.

The reusable `verify.yml` baseline targets Ubuntu and macOS with OpenCode 1.18.29 and external Bun 1.4.2, retaining PR/main checks and serving as a release prerequisite. The macOS baseline and release-candidate job also run gateway, subscription, and refresh production probes inside the macOS sandbox. A latest-version canary is manual-only and separate from release eligibility and baseline support claims; its resolved exact OpenCode version is propagated to routing and cleanup. CI verification uses synthetic credentials, has no publishing permissions, needs no registry credentials, and runs no live tests.

The earlier release-workflow revision passed locked installation, typecheck, 79 tests (including supplied-archive and release fixtures), build, package/routing checks, cleanup, and workflow lint on darwin-arm64. Those are historical results, not a full-test claim for this bridge/TUI revision. Historical candidate checksums and dry-run results are recorded in `openspec/changes/archive/2026-09-05-add-release-workflows/tasks.md`, outside the package. Record current commands, exact runtimes, candidate checksum, results and unresolved failures separately before release approval. CI execution, canary results, and real publishing remain unverified; see [compatibility](compatibility.md).
