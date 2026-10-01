# Compatibility and Evidence

Status: owner-approved `@jaxxstorm/opencode-aperture@0.1.0`, under MIT (copyright 2026 Lee Briggs), **unpublished**. The bridge `@jaxxstorm/bun-tailscale-bridge@0.1.0` is owner-published with registry-confirmed Bun engine requirement `1.4.2`. Previously reported source-built three-entry bridge/TUI results are recorded below, separately from earlier direct-routing evidence. Local release-readiness tests, typecheck, build, workflow lint and clean-consumer checks pass. Ubuntu/macOS hosted CI, plugin publishing access, and external publishing setup are not verified.

## Bridge Candidate

- Server root and `/server`: single default callable factory at `dist/index.js`. `/tui`: separate default `{ id, tui }` module at `dist/tui.js`. `dist/bridge-worker.js` is an internal independently built worker, not an export. All three ship together, without fixtures or development code.
- Installation, build/test, and worker execution require external Bun **1.4.2**. The worker selects an absolute executable or resolves it from `PATH`, and checks the version in the actual spawned process. Stock OpenCode **1.18.29** embeds Bun **1.3.14**; this is not the external Bun version, and is rejected for the bridge worker. Explicit OpenCode-executable mode is only a future option after that exact runtime is verified, not a fallback. Setup does not download or upgrade a runtime or bridge.
- The release contract pins `@jaxxstorm/bun-tailscale-bridge@0.1.0` as an optional dependency, still dynamically imported rather than bundled. Package managers install it by default unless optional dependencies are omitted or installation fails; direct mode does not require it. With normal registered-package installation, leave `modulePath` blank so the worker resolves from within the installed plugin package. A separate trusted runtime may use an explicit absolute path. The earlier npm E404 observation predates publication and is historical, not a current installation restriction.
- Historical local bridge 0.1.0 tarball SHA-256: `a8c6f8d626cc99bb0160f66b848b41d3dc1dd640295bf302e9697067bbac2ab6`. That inspected artifact contains four executable helper entries (darwin-arm64, darwin-x64, linux-arm64, linux-x64), MIT license, and third-party notices. Its release metadata has a zero commit, so source provenance was unverified. This checksum is not asserted to identify the newly published registry tarball. Archive inspection is not native helper execution or a platform support claim.
- Production setup uses HTTPS and local-only TUI dialogs. The public `https://opencode.ai/tui.json` schema was checked for its top-level `plugin` array. Registration belongs in both `opencode.json` and `tui.json`; TUI API/source inspection alone is not interactive end-to-end validation.
- Full-feature tests use fake bridge modules and loopback traffic. Historical real bridge import/helper protocol checks below are not enrollment evidence. Separately, authorized real-bridge catalog discovery on 2026-09-29 reported 10 OpenCode groups and 42 model entries, not live inference. Published-package checks pass for import, helper metadata and default worker module resolution without helper startup; CI must not perform actual enrollment. Native OpenAI OAuth remains independent.
- The configured bridge route uses a parent-owned listener and a private Unix worker socket. Worker death retains the mapping with `503`; instance disposal removes the mapping (`403`) while the listener stays bound for the parent process lifetime. This is a local route guard, not system-wide egress enforcement. Same-user/root attackers are out of scope.

## Historical Production Results

Reported on darwin-arm64 with stock OpenCode **1.18.29**, embedded Bun **1.3.14**, and external worker Bun **1.4.2**; these results have not been rerun by this documentation update:

| Check | Known result and boundary |
| --- | --- |
| Installed `bun scripts/probe-routing.ts --bridge-production` | All five HTTPS scenarios passed: text SSE, tools, concurrency, cancellation, unrelated-provider isolation. Installed index, parent guard, and worker are real; only the bridge module is fake. Exactly one proxied discovery precedes atomic activation. |
| `bun run test:package` | Passed all three built entries and clean-consumer loading. Bun's builtin-prefix normalization is handled with `isBuiltin`, not an arbitrary-import exception. |
| Final `bun test`, after continuous state lease and shared runtime pool wiring | 200 pass, 0 fail, 922 expectations across 12 files. |
| `bun install --frozen-lockfile`; `bun run typecheck`; `bun run build` | Locked install: no changes, 32 installs / 38 packages; typecheck passed; build: three entries, eight modules, index 40.89 KB, worker 36.68 KB, TUI 34.22 KB. |
| Installed `bun scripts/probe-routing.ts --bridge-production-errors` | 429 native retry passed with two gateway requests; 307 containment passed with one gateway request and zero redirect-sink requests; untrusted fixture CA rejected with zero inference gateway requests. Negative prompts were still pending at 500 ms and parent-aborted: no completed negative-error UX claim. |
| Default native probe; cleanup verifier; embedded ingress units | All five default scenarios passed; both failure/interruption cleanup scenarios passed; embedded Bun 1.3.14 ingress units: eight pass, 79 expectations. |
| Production worker/guard, runtime, settings and mocked TUI units | Focused coverage includes shared runtime references, per-instance capabilities, retained TCP port, failure `503`/revoked `403`, private Unix endpoints, locked settings writes, state safety and local commands. Real interactive browser enrollment was not run. |
| Real bridge artifact, isolated offline/script-free install and import | Imported exported `createBridge` and `BridgeError` without calling `createBridge`; sandbox environment empty, network denied. |
| Real darwin-arm64 helper, fresh HOME, deny-all-network sandbox | Deliberately incompatible protocol `999` returned `PROTOCOL_ERROR`, exit 1, no timeout or stderr. This verifies bounded launch/protocol rejection only, not enrollment or live routing. |

The fake bridge uses a real HTTP proxy fixture. Its test-only module wraps worker-global fetch to assert the correct worker-supplied proxy and fixed upstream, then add a per-request fixture CA; there is no parent/native auth-fetch replacement or production source patch. The production worker retains real bridge imports and user-trusted `modulePath` loading. The native sandbox allows localhost TCP and only the specific private `apb.../s` Unix socket paths, not external networking; fixture state lives under its own `0700` parent. Each native probe cleanup reported TCP-refused listeners, removed storage and stopped children. See [verification](verification.md) and the active change evidence for deferred verification.

## Exact Baseline

The following is historical evidence for the earlier direct-only artifact, not the new three-entry candidate. In particular, the old zero-runtime-import assertion has been replaced by an explicit import allowlist: `node:*` builtins in every bundle and the sole external dynamic bridge package import in the worker. Computed `modulePath` loading requires explicit user trust and runtime path validation; a static scanner cannot prove its target safe.

| OpenCode | Bun | Platform | Artifact / check | Evidence |
| --- | --- | --- | --- | --- |
| Stock 1.18.29 | 1.3.14 | darwin | Repository-local synthetic OAuth routing, September 5, 2026 | Verified `/codex/responses` and expected synthetic bearer/account, marker, and session headers; intentional HTTP 400, not inference success. |
| Stock 1.18.29 | 1.3.14 | darwin | Repository-local live `gpt-5.6-luna`, September 5, 2026 | Authorized text response `APERTURE_LIVE_OK`; tools denied and WebSockets disabled. |
| Stock 1.18.29 | 1.3.14 | darwin | Repository-local live `gpt-6-astra`, September 5, 2026 | Authorized successful text response only. |
| Stock 1.18.29 | 1.3.14 | darwin-arm64 | Built tarball, clean-consumer loading, September 5, 2026 | Passed exact package contents, isolated install, single factory export, no runtime imports. |
| Stock 1.18.29 | 1.3.14 | darwin-arm64 | Earlier packaged positive suite, September 5, 2026 | Passed text SSE completion, tool result round trip, concurrent sessions, gateway-observed cancellation, and non-OpenAI header scoping. Native headers and debug hooks checked. |
| Stock 1.18.29 | 1.3.14 | darwin-arm64 | Failure and handled SIGTERM cleanup, September 5, 2026 | Passed injected failure/interruption after startup; child processes, listeners, and temporary storage removed. |
| Stock 1.18.29 | 1.3.14 | darwin-arm64 | Earlier unit suite | 43 passed before the config-only scope amendment. |
| Stock 1.18.29 | 1.3.14 | darwin-arm64 | Revised package/routing suite after non-destructive scope amendment, September 5, 2026 | Passed typecheck, 43 unit tests, exact tarball contents, clean-consumer loading, text SSE, tool round trip, concurrency, cancellation, non-OpenAI header scoping, and failure/SIGTERM cleanup. |
| Stock 1.18.29 | 1.3.14 | Ubuntu and macOS | Baseline CI (workflow in `.github/workflows/verify.yml`) | Pending execution evidence. |
| Stock 1.18.29 | 1.3.14 | darwin-arm64 | Release-workflow revision, September 5, 2026 | Passed locked install, typecheck, 79 tests including archive/release fixtures, build, package/routing/cleanup, and actionlint. Exact candidate SHA-256 and dry-run evidence are recorded in the change's implementation checkpoint outside the tarball. No publication or tag performed. |
| Latest canary, exact version to be recorded | 1.3.14 | To be recorded | Manual-only exploratory upgrade checks | Pending; not a supported-version claim. |

The original live text checks did not independently inspect gateway-side request logs. They are distinct from the synthetic request-path evidence, not proof of gateway-correlated live execution. The initial `gpt-5.6-luna` attempt exposed a debug-hook shape bug; the retry after using `input.model.providerID` succeeded. These results must not be generalized to arbitrary models or OpenCode versions.

## Coverage Limits

- Release-readiness CI now selects external Bun 1.4.2 on Ubuntu/macOS, with production gateway, subscription, and catalog refresh probes only on macOS. The release candidate is packed once on mandatory macOS and all its probes consume the same `APERTURE_TEST_TARBALL`. This is workflow configuration, not a reported pass. The older direct probe and cleanup verifier allow Linux, but without the macOS network sandbox. The manual Linux canary does not establish production bridge compatibility.
- The exact optional bridge pin and lockfile are updated. Clean-consumer checks pass with and without the published optional dependency, verifying normal registration, direct-mode behavior, module resolution, and matching native-helper metadata. These checks do not execute a real helper or enroll a device.

- Deferred verification includes real interactive TUI/browser behavior, transcript/telemetry secrecy, exhaustive raw-wire variations, bounded-memory/backpressure stress, actual cross-UID replacement/race attacks, the remaining optional/helper/platform matrix, and completed native negative-error UX. Guard permissions/architecture and embedded ingress units are evidence, not an actual cross-UID attack test. Implementation is complete; these are not code or authorization blockers.
- Native OAuth login, header injection, and HTTP/SSE routing are the architecture; native refresh through this gateway and refreshed-token persistence remain **unverified**.
- Live tools, gateway-correlated live text/tools, live cancellation, and live concurrent-session behavior are **unverified**. Synthetic coverage above is separate from live behavior.
- WebSocket transport is **unsupported** and must remain disabled in verification.
- Residency-sensitive accounts are **unsupported**: native residency headers are currently added inside the rewrite branch this route avoids. Do not synthesize headers or infer residency guarantees.
- Initial setup failure reports sanitized errors and leaves native provider configuration unchanged. Native routing may remain available. After successful bridge configuration, the retained local route guard denies requests when its worker dies; it does not turn initial loading failure into a fail-closed guarantee. Check logs and restart after fixing configuration.
- Missing/unloadable modules, conflicting OpenAI auth/fetch/config plugins, future versions, and untested platforms are outside the verified boundary.

## Recording New Evidence

Record date, exact OpenCode and Bun versions, OS/platform, candidate version and artifact checksum, command, result, sanitized evidence location, and unresolved failures. Separate source-adapter, built-file, installed-tarball, CI, and live results. Never promote a version from source inspection, a gateway hit followed by HTTP 400, or a CLI exit code without session completion/error assertions.

Only add a tested combination after reviewing its actual results. Keep failing/latest exploratory results separate. No fail-closed or no-direct-traffic guarantee is offered; egress tracing is not a compatibility gate. Live validation requires the [explicit opt-in procedure](live-validation.md), outside CI.
