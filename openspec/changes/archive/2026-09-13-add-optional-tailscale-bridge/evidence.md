# Host Compatibility Gate

## Final Production Verification

2026-09-13: the following supplied final actual results were obtained **after continuous state lease and shared runtime pool wiring and source build**. They supersede provisional counts and pending-final-verification statements in the historical checkpoints below. Implementation is complete, including real bridge imports and explicit user-trusted `modulePath` loading in the production worker. This documentation-only finalization does not rerun feature tests or alter code, actual user `opencode.json`/`tui.json`, or global settings. Both local registrations and the implemented setup/status/disconnect/forget flow are documented; real interactive UI verification is deferred.

Toolchain: stock OpenCode **1.18.29**, embedded Bun **1.3.14**, external Bun **1.4.2**, darwin-arm64. The recorded external executable is `/Users/lbriggs/.local/share/mise/installs/bun/1.4.2/bin/bun`.

| Command / check | Final actual result |
| --- | --- |
| `bun install --frozen-lockfile` | No changes; 32 installs / 38 packages. |
| `bun run build` | Three entries, eight modules: index 40.89 KB, worker 36.68 KB, TUI 34.22 KB. |
| `bun run typecheck` | Pass. |
| `bun test` | **200 pass, 0 fail, 922 expectations across 12 files.** |
| `bun run test:package` | All three bundles passed in a clean consumer. |
| `bun scripts/probe-routing.ts --bridge-production` | All five installed native HTTPS text/tool/concurrency/cancellation/other-provider scenarios passed; exactly one proxied discovery precedes activation. |
| `bun scripts/probe-routing.ts --bridge-production-errors` | 429 -> native retry passed, two gateway requests; 307 containment passed, one gateway request and zero redirect-sink requests; untrusted fixture-CA rejection passed, zero inference gateway requests. |
| `bun run test:routing` (default native probe) | All five scenarios passed. |
| `bun scripts/verify-probe-cleanup.ts` | Both failure/interruption scenarios passed. |
| `env BUN_BE_BUN=1 opencode test test/bridge-ingress.test.ts` | Embedded 1.3.14 ingress units: eight pass, 79 expectations. Not embedded CONNECT compatibility. |
| `openspec validate --all --strict` | All six items passed. |

Negative redirect/TLS prompts were still pending after 500 ms and parent-aborted. The observed request counts establish the tested containment assertions, **not completed negative-error UX**. Each native probe cleanup reported TCP-refused recorded listeners, removed isolated storage and stopped children.

Installed production tests execute the real installed index, parent ingress/guard and worker, substituting **only the bridge factory module**. That fake creates a real HTTP proxy fixture and wraps **worker-global fetch** to assert the worker-supplied proxy/fixed target and add the test CA per request. There is no parent/native auth-fetch replacement, production source patch, global trust disabling, or real bridge functional integration claim. Earlier wording that no worker fetch patch was used meant no production source patch; the test-only worker-global wrapper is explicit here.

Real artifact verification remains separate: SHA-256 `a8c6f8d626cc99bb0160f66b848b41d3dc1dd640295bf302e9697067bbac2ab6` matches the reviewed 0.1.0 tarball. Offline/script-free sandbox import of `createBridge` and `BridgeError` passed without invoking `createBridge`; all four helpers were executable (`0755`). The actual darwin-arm64 helper in fresh HOME with deny-all-network containment rejected protocol `999`: `PROTOCOL_ERROR`, exit 1, no timeout, stderr false. This is binary startup/invalid-protocol rejection only. Valid-protocol startup and live integration are unrun by design; all-zero source commit metadata leaves provenance unverified. This digest identifies the real bridge artifact, not a newly checksummed Aperture release candidate.

### Deferred Verification

- 1.3: real interactive OpenCode TUI loading, private browser/reference-input display, cancellation and transcript/privacy observation. Local commands, both registration instructions and mocked TUI/state tests are complete; manual UI behavior is not inferred.
- 1.4: actual other-UID TCP/Unix replacement/connect-race attacks and broader cached-retry/failure/disposal/natural-exit stress. Parent-lifetime guard/0700 architecture, lifecycle units and native embedded 1.3.14 ingress units are proven subsets, not an executed cross-UID attack.
- 1.9: telemetry, transcripts, encoded secrets and exhaustive persisted/error surfaces, plus native login/refresh observations; config APIs/captured logs, settings and provider scoping cover only tested surfaces.
- 1.10: every raw-wire/header/Connection/TLS/redirect variation and adversarial stress, plus completed negative-error UX. Many raw-wire unit cases and installed 307/untrusted-CA containment pass.
- 1.17: sustained native streamed-upload/bounded-memory/backpressure stress and complete cross-runtime comparison. External native all-five and installed retry/TLS/redirect containment do not establish these; embedded ingress proof is not embedded CONNECT proof.
- 5.1: exhaustive installed raw-wire/TLS/redirect/Connection and secrecy-surface variations and completed native negative-error UX beyond the passed discovery/inference/scoping/retry/containment subset.
- 5.2: sustained streaming/backpressure/memory stress, broader gateway-status/helper-worker failure and cached-retry/disposal/natural-exit interleavings, and actual other-UID replacement/race attacks beyond units and bounded native cleanup.
- 5.3: complete omitted/installed/E404/local-module matrix, other-platform helper execution, valid-protocol helper startup, exhaustive package synthetic-secret scans and source provenance beyond clean-consumer/import/invalid-protocol evidence.

Tasks 1.2 and 5.4 are complete from installed composition/retry and final command results. Task 6.4 is complete for scenario reconciliation and strict validation, not completion of deferred scenarios. Final accounting: **35 checked, eight unchecked**, all eight explicitly deferred verification. These are not code implementation blockers or missing implementation authorization. Live credentials, enrollment, tailnet/gateway integration, native refresh, CI/other-platform support and publication are not claimed; no publication or live credential/enrollment/refresh operation occurred. Historical negative gates are preserved below.

Documentation finalization verification executed in this turn: `openspec validate --all --strict` passed all six items (zero failures); `git diff --check` passed for the full worktree. Checkbox counts were independently checked: 35 checked, eight unchecked. No feature tests were rerun during this documentation-only finalization.

## Earlier Production Checkpoint (Provisional, Historical)

2026-09-13 documentation reconciliation: production functionality is wired. This update records known results supplied by main and current implementation, without rerunning feature tests or inventing final counts. Only README.md, docs/compatibility.md, docs/verification.md, scripts/README.md and current change artifacts are edited. Active main specs/config/project, code and historical negative findings are unchanged; no sync, archive, commit or publication is performed. Earlier scope restrictions below are historical, not current authorization blockers.

### Known Results

| Check | Exact known outcome / limit |
| --- | --- |
| Installed `bun scripts/probe-routing.ts --bridge-production` | All five HTTPS scenarios passed: completed text SSE, tools, concurrency, cancellation, unrelated-provider isolation. Stock native OpenCode 1.18.29, embedded Bun 1.3.14, external Bun 1.4.2, darwin-arm64. |
| Production composition | Installed index, parent ingress/guard and worker are real. ONLY the bridge module is fake; exactly one proxied discovery occurs before atomic activation. Native auth fetch is untouched. |
| `bun run test:package` | Passed all three built entries and clean-consumer loading. Earlier missing-node-prefix blocker is fixed using isBuiltin for actual Node builtins, including Bun-normalized bare names; arbitrary imports remain rejected. |
| Last full `bun test` | **200 passed before final prepareAndClaim wiring**. This is provisional, not a post-wiring pass. Main will append final count, commands and regression outcomes. |
| Production worker/guard, runtime, settings and mocked TUI/state units | Focused positive evidence supports implementation tasks 2.2-2.5, 3.1-3.5 and 4.1-4.6. It does not complete broad installed/native/security gates. Real interactive browser enrollment explicitly deferred. |

The fake bridge module creates a real HTTP proxy fixture. Its worker-local fetch instrumentation is test-only: it first asserts the production worker supplied the correct proxy and fixed upstream, then adds the fixture CA per request. Production root/worker code is never fetch-patched; no native auth-fetch replacement or global trust disabling is involved. This instrumentation is not shipped behavior or a real bridge support claim.

The secure node:http Unix path required the native macOS harness sandbox to permit only the specific private `apb.../s` socket endpoints in addition to localhost TCP. External network remains denied; arbitrary Unix sockets are not allowed. Temporary fixture state uses its own owned `0700` parent rather than a shared temporary state parent.

### Implemented Lifecycle and UX

The module-scoped runtime pool uses reference counts to share compatible workers across projects within one loaded server module. Each plugin instance has an independent capability on one shared TCP port held for parent lifetime. Private worker Unix endpoints protect against other-UID replacement; same-user/root are outside the boundary. Worker termination retains a `503` route; disposal revokes that instance's capability (`403`) without releasing the TCP port. Focused production worker/guard units and the installed positive are distinct from exhaustive cross-UID race/native retry verification.

Settings compare-and-swap writes occur inside the lock. Nested profiles and forget with nested leases are rejected. The production worker now uses prepareAndClaimBridgeState to hold a continuous state lease from preparation until the Go helper is confirmed closed; main is validating this final wiring. Default identity paths remain valid when cwd is home or root. Local private TUI implements setup/status/disconnect/forget, named environment-key references and private browser dialogs. Mocked TUI/state tests are not real interactive/browser enrollment evidence.

Supervised production worker loading supports the real optional bridge through an explicit absolute trusted modulePath. Upstream is unpublished/E404: no npm optionalDependencies entry or guessed version is declared. A separately installed reviewed local tarball is supported; no runtime download/build or publication occurs.

### Real Artifact, No Enrollment

The reviewed 0.1.0 tarball SHA-256 is `a8c6f8d626cc99bb0160f66b848b41d3dc1dd640295bf302e9697067bbac2ab6`. Separate safe verification installed it offline with install scripts ignored under an empty-environment, network-denied sandbox. Exported `createBridge` and `BridgeError` imported successfully **without calling createBridge**. All four installed helpers (darwin-arm64, darwin-x64, linux-arm64, linux-x64) have mode `0755`; existing MIT/notices inspection is retained.

The real darwin-arm64 helper was launched with a fresh HOME under a deny-all-network sandbox and deliberately incompatible protocol `999`: returned `PROTOCOL_ERROR`, exit 1, no timeout and no stderr. This is bounded helper launch/protocol-rejection evidence, not valid-protocol startup, live enrollment, tailnet routing or other-platform execution. The release.json commit is still all zeros, so source provenance remains unverified. No publication occurred.

### Remaining Gates

- 1.2: installed production discovery/inference/scoping positive is known; native retry/gateway-status-specific cases await main's results.
- 1.3/1.4/1.9/1.10: mocked private UI and focused guard/security evidence are partial; real interactive loading/browser behavior, exhaustive secret surfaces, cross-UID replacement/races and broader native lifecycle/security checks remain unverified.
- 1.17 and 5.1/5.2: native all-five HTTPS positive and focused streamed/cancel/security units do not establish the full native TLS-negative/redirect matrix or bounded-memory/backpressure stress. Leave broad tasks unchecked.
- 5.3: clean package and real artifact import/incompatible-protocol subset passed; remaining optional/helper/platform and synthetic-secret-scan matrix is not inferred.
- 5.4/6.4: main owns final post-prepareAndClaim full tests, typecheck/build, native regressions, cleanup, exact artifact digest and final result append. Do not promote the prior 200-pass count to a new revision.
- 6.3 is complete as a record of **live NOT RUN by design**, not live verification. Real enrollment/tailnet/gateway operation, native refresh/persistence, other platforms, CI, source provenance and publishing remain separate gates.

Remaining requirements concern verification, not missing authorization to finish implementation. Historical sections below preserve their original observations and negative findings; their then-current statements do not describe today's production wiring.

Documentation validation executed for this checkpoint: `openspec validate add-optional-tailscale-bridge --strict` passed; `openspec validate --all --strict` passed all six items; scoped `git diff --check` passed. Task accounting is 32 checked and 11 unchecked. Task 6.4 remains partial because structural validation does not complete scenario verification. No feature tests were rerun by this documentation update.

## Earlier Full Production Authorization and Guidance Reconciliation (Historical)

2026-09-12: the owner's explicit "wire it in please, finish the job" authorizes full production feature implementation. This supersedes earlier narrow-only approval statements retained below as historical scope, not historical NO-GO findings. This turn edits only active `openspec/config.yaml`, `openspec/project.md` and this change's proposal/design/specs/tasks/evidence via apply_patch; no code/package/user-doc changes or feature test results are claimed. Main owns actual implementation and final verification.

The selected target is one default server root function, shipped `dist/bridge-worker.js`, optional TUI `dist/tui.js`, parent-owned shared unref'ed raw HTTP loopback ingress until parent exit with per-instance capability route removal, and node:http streaming to worker-only Unix sockets in short parent-created private 0700 directories. Only verified child Bun 1.4.2 performs HTTPS/CONNECT through the bridge proxy. Worker loss must abort/503 or close in-flight work and remove routes for subsequent 403, while parent TCP retention and private Unix ownership protect other-UID port/socket replacement including liveness/connect races. Same-user/root compromise is out of scope. This is an approved design, not tested production containment.

Settings are shared locally at `${XDG_CONFIG_HOME:-~/.config}/opencode-aperture/settings.json`; local TUI/server only, remote attachment unsupported, no assumed RPC. Public DialogPrompt masking is absent as already inspected below; current auth-key requirement uses explicit authKeyEnv reference input instead, preserving user-owned key enrollment without unmasked secret input. Browser URL is private DialogAlert-only. Commands are private TUI actions, never model tools. Disconnect saves disabled settings and requires full OpenCode restart; forget requires stopped profile, exclusive lock, matching owner marker and safe confirmed path deletion. Native ChatGPT credentials remain unread/unpersisted. Runtime modes and private protocol remain separate, explicit, exactly allowlisted, never auto-fallback.

### Artifact Inspection (Task 1.6 Only)

Inspected `/var/folders/_9/zz5h76fj6sg42r_w3n0408mw0000gn/T/opencode/bridge-release-candidate/jaxxstorm-bun-tailscale-bridge-0.1.0.tgz` and sibling `release.json` without extracting/executing helpers or enrolling. `shasum -a 256` returned `a8c6f8d626cc99bb0160f66b848b41d3dc1dd640295bf302e9697067bbac2ab6`, matching the supplied metadata. `tar -tvzf` lists executable darwin-arm64, darwin-x64, linux-arm64 and linux-x64 helper entries, built JS/types, LICENSE and THIRD_PARTY_NOTICES.txt. `tar -xOzf` reviewed package.json, public index/protocol types and MIT license text: package is @jaxxstorm/bun-tailscale-bridge 0.1.0, Bun 1.4.2, default JS export, no install scripts; createBridge exposes hostname/stateDir/authKey/startupTimeoutMs/signal/onAuthRequired, private credential-bearing httpProxyURL(), idempotent lifecycle contract and protocol version 1 with 65536-byte frame bound. No helper launch is implied by archive executable bits or type declarations.

`release.json` has commit `0000000000000000000000000000000000000000`; the named tag is metadata, not verified source provenance. `npm view @jaxxstorm/bun-tailscale-bridge@0.1.0 version --json` returned E404; `gh api repos/jaxxstorm/bun-tailscale-bridge/releases` returned `[]`. No public release is available in these observations. Inspection completes task 1.6 only; provenance, native helper launch/protocol, platforms and live operation remain unverified.

The authorized manifest target is exact optional 0.1.0, with optional-resolution absence tolerated while disabled, and explicit modulePath to a trusted separately installed local tarball's built JS entry. No developer file dependency, runtime compilation/download or publication is authorized. Full production feature tests must use fake bridge modules exclusively against loopback; real artifact import/helper launch-protocol checks may run separately without enrollment or live-tailnet traffic. Those tests were not run by this reconciliation.

### Remaining Verification Gates

Production ingress/Unix race and cached retry containment; multiple instances and natural parent exit; private TUI reference/browser secrecy and cancellation; safe state ownership/lock-marker deletion; full native TLS/redirect/streaming/backpressure/retry/security matrix; script-free optional E404/omitted/installed/local-module clean consumers; real helper launch/protocol and source provenance; exact-toolchain full regression/build/package/routing checks remain pending. Live enrollment, real gateway authorization, refresh, other platforms and publication remain separate gates. Prior checked focused tests below retain only their recorded scope.

Validation executed for this reconciliation: `openspec validate add-optional-tailscale-bridge --strict` passed; `openspec validate --all --strict` passed all six items (the current change plus five main specs); `git diff --check` passed. Task 2.1 is complete for guidance reconciliation/validation only. Together with inspection-only 1.6, these are the only newly checked tasks; new implementation task 4.6 remains unchecked. No feature tests, real helper execution, live enrollment or publication ran in this turn. Structural validity does not establish runtime correctness.

## Earlier Separate-Process Evidence (Historical Scope)

Current scope is implemented process/runtime infrastructure and synthetic native HTTPS proof only. This documentation reconciliation reads `src/transport-process.ts`, fixture worker/core/plugin, main routing probe and focused tests; it does not edit or rerun code/tests owned by main. Results below are reported main results, pending its final verification/count append. Historical results in subsequent sections remain historical, not current negative external-worker results. No real bridge or enrollment UX is implemented.

`src/transport-process.ts` exports a reusable internal supervisor unused by the shipped plugin; no consumer API/flags are exposed. The probe copies it and synthetic `transport-worker.ts`, `relay-core.ts`, `relay-plugin.ts` and forward proxy into isolated storage. `--relay-worker-https` selects external mode with the harness Bun's absolute `process.execPath`; `--relay-worker-embedded` selects native host `process.execPath` plus child-only `BUN_BE_BUN=1`. Supervisor input requires absolute paths; it does not implement PATH resolution. Both modes execute the identical separate worker/protocol. `VERIFIED_TRANSPORT_BUN_VERSIONS` is exactly `["1.4.2"]`; extend only after exact-version differential/native checks, never newer semver trust. No future external or embedded positive is verified. Main should append the literal absolute executable path from its final run; it is not inferred here.

Private protocol is `hello -> start -> ready`: validate actual Bun/protocol before any startup bytes; send target and synthetic CA/key privately on stdin; perform bounded streamed HTTPS CONNECT and reader-cancellation smoke, then independent proxied fixture discovery. Worker generates a random 32-byte capability and returns it privately in ready with origin/runtime/protocol. It does not receive a parent-generated capability. Proxy credentials are generated inside the worker. The parent fixture injects capability through native OpenAI `chat.headers`; native auth fetch is untouched. Original packaged discovery remains direct to a loopback fixture, so this is not integrated production discovery/model validation.

Launch uses `--no-env-file --config=/dev/null`, worker-directory cwd, PATH-only environment plus BUN_BE_BUN in embedded mode, preventing project dotenv/preloads. Control/startup lines are limited to 64 KiB; parent cumulative stdout and stderr are each capped at 512 KiB, with strict frames and allowlisted events; stderr is discarded. Worker input has a 128 KiB total cap. Parent timeout defaults to 10 seconds, accepts 1-60000 ms; native fixture and worker use 15 seconds. A close request is acknowledged by process exit, not a closed frame: parent waits 150 ms, then SIGTERM/150 ms, then SIGKILL/300 ms. Worker cleanup has a one-second force-exit deadline. OpenSSL generates disposable fixture certificates outside the worker; no production OpenSSL dependency is asserted.

### Reported Main Results

| Check | Reported outcome |
| --- | --- |
| `bun scripts/probe-routing.ts --relay-worker-https` | All five native scenarios pass: text, tools, concurrency, cancellation, unrelated provider; external worker Bun 1.4.2, OpenCode 1.18.29 / embedded 1.3.14, darwin-arm64 |
| `bun scripts/probe-routing.ts --relay-worker-embedded --expect-worker-rejection` | Pass: incompatible hello rejected before startup data, smoke/proxied discovery/route/capability activation; no external fallback; original packaged gateway route preserved; no inference attempted |
| Current `bun test` on Bun 1.4.2 | 126 passes across seven files, 444 expectations, as reported before main's final verification; not a count of native scenarios or production Tailscale tests |
| Embedded 1.3.14 unit execution | Fake protocol fixtures claim 1.4.2 deliberately; two stdout-EOF cases and all five real-worker tests skip. This is not positive embedded worker evidence |
| Ordinary native routing baseline | All five pass, retained baseline evidence; final regression verification belongs to main |
| Standalone differential | Earlier exact 1.4.2 pass and 1.3.14 streamed-CONNECT/reader-cancellation failures retained below; not represented as a new run by this documentation edit |

An earlier concurrent external native run failed a gateway-observation assertion. Main added bounded waits for asynchronous worker-log observations and reported a subsequent all-five pass. This records the observed failure, change and rerun, not a definitive root cause. Inference tunnel peer ports are correlated independently of discovery; tested gateway native headers and relay/proxy/application credential separation remain asserted. Config API/captured-log checks and unrelated-provider isolation cover only those tested surfaces.

Focused tests include incompatible/newer hello with zero startup bytes, graceful-close marker, strict malformed/oversized/out-of-order frames, environment isolation, dotenv/preload suppression, actual-worker stdin EOF before startup and after ready, valid-capability Host/Origin rejection, streamed first-chunk delivery and corrected decoded-gzip relay response headers (`content-encoding` removed). Real-worker cases run only on 1.4.2. Upstream gateway loss returns 502, then the surviving worker keeps the same bound relay returning 503; a recovered gateway receives zero requests. This is a real synthetic-worker unit test, not native retry/helper-failure proof.

Embedded startup rejection is **not fail-closed**: the original packaged gateway route remains configured and the negative probe deliberately attempts no inference. Worker death invalidates supervisor liveness/capability access but releases its relay port. Cached native bearer headers/capabilities may still reach a replacement listener; parent header checks do not fix that hazard. A parent-owned stable ingress guard remains an unimplemented review candidate.

Tasks 1.14-1.16 and 1.18 record focused implementation/reported evidence only. Task 1.17 stays partial: native five-scenario positive and worker smoke/streaming are completed subsets, not native TLS-negative/redirect or bounded-memory/backpressure stress proof. Task 1.19 awaits main's final verification/count append. Broad gates 1.2/1.4/1.9/1.10 remain open for retries, refresh, full secrecy/security surfaces, ingress/port-reuse/disposal safety and broader native transport checks. Private UX, immutable bridge artifact, real helper integration, production support and other platforms remain unverified. No live enrollment, publication, remote gateway traffic or native auth-file reads occurred; only isolated synthetic OAuth setup through the public API was used.

Earlier artifact-only separate-worker validation passed `openspec validate add-optional-tailscale-bridge --strict`; that historical structural result is not execution evidence.

## Earlier Approval and Pending Relay Proof (Historical Scope)

The user subsequently explicitly approved the plugin-managed numeric-loopback reverse-relay design and native OAuth testing with synthetic loopback fixtures. This supersedes only the approval-pending statements in the historical reviews below, not their technical NO-GO results. Current scope is design and standalone synthetic proof, not full feature implementation. No production relay is implemented or positive relay proof claimed by this artifact revision.

The approved route is untouched native OpenCode OAuth -> authenticated numeric-loopback reverse relay -> bridge HTTP/CONNECT forward proxy -> fixed validated gateway. The reverse relay is not `bridge.httpProxyURL()`. The existing isolated probe may verify synthetic native headers; it cannot by itself establish production capability injection/scoping/secrecy, private UI, or embedded-Bun compatibility. Tasks 1.2-1.4 and new 1.9-1.10 remain unchecked. A private `chat.headers` closure is a possibility to test, not proof that config/provider APIs and other surfaces cannot expose the capability; baseURL must contain no secret.

Relay failure must retain a rejecting listener until native runtime disposal; normal closure requires proof native traffic/retries have stopped before releasing the port. Missing capability must reject before forwarding. Broader security, TLS, streaming/backpressure, cancellation, and lifecycle proofs remain pending. Same-user compromise is explicitly not defended. Active guidance remains unchanged. The reviews and validation counts below describe earlier revisions and are retained as historical evidence.

Artifact-only revision validation: `openspec validate add-optional-tailscale-bridge --strict` passed. This validates the change structure, not native composition or any relay security/runtime proof. No synthetic proof was executed as part of these artifact edits; script work is separate.

## Original Decision (Historical)

**NO-GO for the original configuration-only design on OpenCode 1.18.29.** Native per-provider proxy forwarding is missing on the inspected path, and string-valued proxy credentials in provider options would be exposed through configuration APIs. This historical gate prohibited custom fetch; the approved adapter review and its separate negative result are recorded below. Dependent implementation remains blocked and bridge credentials must not enter provider options.

Task 1.1 is complete as an interface/runtime inspection. Task 1.5 is complete as a no-go decision. Tasks 1.2 through 1.4 remain incomplete: source inspection identifies blockers, not successful installed-host routing, UI, or lifecycle proofs. No production changes, live enrollment, real gateway requests, or credential reads were performed.

## Versions and Method

- `opencode --version`: `1.18.29`.
- `bun --version`: `1.4.2` (standalone runtime only).
- `env BUN_BE_BUN=1 opencode -e 'console.log(JSON.stringify({bun: Bun.version, platform: process.platform, arch: process.arch}))'`: `{"bun":"1.3.14","platform":"darwin","arch":"arm64"}`. This evaluates runtime metadata in the installed executable without initializing an OpenCode session.
- Installed `@opencode-ai/plugin` and `@opencode-ai/sdk`: `1.18.29`, read from their local package manifests/types.
- Upstream tag `v1.18.29` resolves via GitHub API to commit `16747470f976aca3d362ad730bcd3fe82ecc2c9a`. Source inspection uses that immutable revision; no assertion is made that the local executable was independently reproduced from it.
- A shallow source clone timed out; relevant pinned files were subsequently inspected through GitHub API/raw source. This did not block the source review.

## Native Proxy Forwarding: Blocked

The installed SDK's `ProviderConfig.options` contains `baseURL`, timeout, and other known fields plus arbitrary keys, but no explicit proxy contract (`node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:928-944`). An arbitrary option bag does not establish native transport support.

Pinned [provider.ts:1794-1833](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/provider/provider.ts#L1794-L1833) chooses `options["fetch"]` or global fetch and forwards request init plus `timeout: false`; it does not inject `options.proxy`. Options are passed to the SDK factory, not spread into request init.

The pinned [OpenAI SDK dependency](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/package.json#L70-L71) is `@ai-sdk/openai@3.0.84`. Its [version-specific provider factory](https://unpkg.com/@ai-sdk/openai@3.0.84/src/openai-provider.ts) supplies model URL, headers, and `options.fetch`, not `options.proxy`.

Native [codex.ts:328-435](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/plugin/openai/codex.ts#L328-L435) installs its own auth-loader fetch, preserves native refresh/header behavior and URL rewriting, then calls global fetch with request init. Replacing it is explicitly outside this change's design. Refresh uses a separate global fetch at [lines 135-144](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/plugin/openai/codex.ts#L135-L144).

No installed-host proxy success is claimed. A loopback proof under the proposed configuration-only contract cannot be considered satisfied by supplying an arbitrary `proxy` key.

## Proxy Credential Secrecy: Blocked

The [GET /config handler](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts#L14-L30) returns configuration, and [Config.get](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/config/config.ts#L620-L622) returns the in-memory configuration object.

Runtime providers are also exposed through [toPublicInfo at provider.ts:1117-1130](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/provider/provider.ts#L1117-L1130). Its serialization removes functions, symbols, and undefined values, not secret-bearing strings. A proxy URL placed in provider options would therefore remain API-visible. These routes have authorization middleware; this finding is exposure to API clients, not a claim of unauthenticated access.

No direct provider-options log leak was established in the inspected source. This review does not claim all logging, telemetry, or persistence paths are safe.

## Private UI: Unverified

Installed auth prompt declarations offer text/select fields without an explicit masking field (`node_modules/@opencode-ai/plugin/dist/index.d.ts:65-115`). `TuiDialogPromptProps` likewise has no masking field (`dist/tui.d.ts:98-107`).

However, custom JSX dialog replacement and TUI renderer/routes/slots exist (`dist/tui.d.ts:79-85,459-504`). A custom private masked UI may be possible; absence from standard prompts is not proof that it is impossible. Transcript exclusion, secret-safe input, cancellation, and client/server communication have not been demonstrated. Task 1.3 remains unchecked.

## Lifecycle: Partially Established

The root plugin interface includes `dispose?: () => Promise<void>` (`node_modules/@opencode-ai/plugin/dist/index.d.ts:173-174`). TUI lifecycle also exposes an abort signal and `onDispose` (`dist/tui.d.ts:412-416,503`). Pinned [plugin/index.ts:265-278](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/plugin/index.ts#L265-L278) awaits plugin disposal in a finalizer.

Basic disposal support therefore exists. Active-provider invalidation after helper death, prevention of stale proxy credential reuse, no-direct-retry behavior, stream cleanup, and forced-termination behavior remain unverified. Task 1.4 is not complete.

The installed embedded Bun 1.3.14 also predates the bridge README's reported streamed CONNECT upload fix and Bun 1.4.2 validation baseline. No local regression test was run, and standalone Bun 1.4.2 does not establish compatibility of the OpenCode executable.

## Original Alternatives (Selection Resolved)

1. Preserve the original configuration-only design and pursue a separately approved OpenCode change providing private native per-provider proxy configuration, appropriate credential redaction, and safe lifecycle invalidation; then repeat installed-host gates on a pinned candidate.
2. Revise this change to permit a narrowly scoped transport adapter, with an explicit new security/design review for composing native OAuth, private credential storage in memory, proxy scoping, redirects, and lifecycle. **User selected this option for review before implementation.** It is no longer a pending selection and does not authorize arbitrary host patches or auth takeover.

Bridge artifact verification and downstream implementation remain pending. Live-tailnet validation was not run and remains separately authorized; no test or support claim follows from this source inspection.

## Revised Adapter Static Review

The following additional pinned-source findings record the completed negative static inspection/security review for tasks 1.7/1.8. They are not installed-runtime tests or a functional adapter demonstration. All OpenCode references use immutable commit `16747470f976aca3d362ad730bcd3fe82ecc2c9a`.

- [plugin/index.ts:170-252](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/plugin/index.ts#L170-L252): config hooks execute after built-in and external plugin initialization. Initialization of a plugin is not execution of its auth loader.
- [provider.ts:1436-1487](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/provider/provider.ts#L1436-L1487): config hooks run before provider construction and auth loaders. A config hook therefore cannot capture an already accumulated native auth-loader fetch.
- [provider.ts:1604-1623](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/provider/provider.ts#L1604-L1623): auth loaders receive `toPublicInfo(database)`, not accumulated loader outputs. An additional loader would not supply the proposed composition and is prohibited regardless.
- [provider.ts:1625-1651](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/provider/provider.ts#L1625-L1651): configured provider options are reapplied after auth/custom loaders. `cfg.options.fetch` overwrites native loader fetch; it does not wrap a native fetch captured through the config hook.
- [provider.ts:1794-1835](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/provider/provider.ts#L1794-L1835): the core outer wrapper selects the resulting native OR configured fetch (with global fallback), not a downstream composition of both.
- [codex.ts:330-435](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/plugin/openai/codex.ts#L330-L435): native Codex fetch handles current auth, refresh, and headers, then directly invokes global fetch; it has no transport callback.
- Public [plugin types:56-90](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/plugin/src/index.ts#L56-L90) and [hooks:210-261](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/plugin/src/index.ts#L210-L261) expose the relevant config/auth/provider.models/chat hooks, not a downstream `nextFetch` contract.

**Verdict: revised direct fetch-adapter gate NO-GO at this pin.** A configured fetch cannot both retain the native auth-fetch path and inject the bridge forward proxy using the inspected public interfaces. No adapter is implemented or claimed functional. Tasks 1.1/1.5 remain historical original-gate inspection/no-go; tasks 1.7/1.8 record the revised negative static result. Installed proof tasks 1.2-1.4, including private UI and runtime/lifecycle safety, remain incomplete, not waived by source inspection.

### Historical Adapter Security Boundary

Only a verified public gateway-scoped downstream adapter is permitted. Native ChatGPT login, refresh, persistence, and auth-header ownership must remain intact. Auth loaders/replacement, auth-file access, application-token persistence, global fetch patches, private APIs, global environment proxies, loopback rewriting, and local reverse proxies remain banned. Proxy credentials must exist only in private runtime memory, not serialized configuration, APIs, logs, telemetry, or persisted state. A future candidate must prove bounded invalidation/release on helper death or disconnect, no stale loopback-port reuse or direct retries, redirect credential containment, TLS verification, full SSE consumption, and cancellation safety. Static rejection establishes no positive security/runtime proof.

### Historical Possible Next Designs

- A separately approved upstream public downstream transport/proxy extension could preserve native auth ownership and offer private credential handling and bounded lifecycle invalidation. This review does not authorize patching the host; any candidate must repeat static and installed-host gates.
- A base URL pointing to a separate loopback reverse proxy could retain native fetch, but that reverse proxy is not `bridge.httpProxyURL()` (an HTTP/CONNECT forward proxy). It changes routing, TLS termination, and the application-credential trust boundary and requires additional architectural/security approval before adoption. It is not the currently approved adapter design.

Option 2 has already been selected and reviewed negatively at this pin; do not ask to select it again as though approval were outstanding. Implementation remains paused. Active `openspec/config.yaml` and `openspec/project.md` intentionally remain unreconciled pending task 2.1; production code and other specs are unchanged by this review.

### Artifact Validation

`openspec validate add-optional-tailscale-bridge --strict` passed. `openspec instructions apply --change add-optional-tailscale-bridge --json` reported 31 tasks, 4 complete, and 27 remaining. Its `ready` state describes artifact readiness, not a positive security/feasibility gate or permission to implement through the recorded NO-GO. No installed routing, UI, or runtime proof was run during this artifact revision.

## Preliminary Native-to-Relay Proof: Passed

Following explicit approval for a local relay and synthetic tests, `scripts/probe-routing.ts --relay` now loads the installed Aperture tarball followed by a separate copied test plugin from `scripts/fixtures/relay-plugin.ts`. The fixture is not included in the distributed package and is not the production relay. It leaves native auth loaders and `options.fetch` untouched, changes only the inference base URL, and attaches an independent random capability from a `chat.headers` closure.

The tested path is native OpenCode OAuth -> authenticated numeric-loopback reverse relay -> fixed HTTP loopback gateway. It does **not** yet include an authenticated forward proxy, `bun-tailscale-bridge`, CONNECT, or a real tailnet. Discovery still uses the original packaged plugin's ordinary loopback gateway path.

### Observed Results

- All five relay scenarios passed: completed SSE text, two-request tool round trip, concurrent sessions, gateway-observed cancellation, and unrelated-provider isolation.
- The gateway verified native bearer/account/session/originator/user-agent/content headers and the existing plugin marker. It also required a fixture-only forwarding marker set by the relay for OpenAI traffic, distinguishing actual relay traversal from a direct-gateway bypass. The marker was absent for the unrelated provider.
- The relay capability was required for forwarding, removed before the upstream request, and absent from both `/config` and `/config/providers` responses and captured native stdout/stderr. The unrelated provider received neither capability nor forwarding marker.
- Missing/incorrect capabilities returned 403 without upstream requests. Requests with hostile Host/Origin also returned 403, but lacked valid capabilities; this does not independently prove those protections against authenticated malformed requests.
- Baseline (without `--relay`) passed the same five scenarios after the harness fix below.
- Final cleanup reported removed isolated storage, stopped child process groups, and unreachable recorded listeners. This does not prove orderly native disposal, that listener ports are unbound rather than unresponsive, or resistance to stale-port reuse.

### Harness Fix and Commands

Initial baseline and relay attempts both timed out on session creation before inference. OpenCode independently discovers `XDG_CONFIG_HOME/opencode`, in addition to `OPENCODE_CONFIG_DIR`; the harness seeded only the latter and the project directory. Seeding the additional public-dependency directory and setting `NPM_CONFIG_OFFLINE=true` for the child eliminated the timeout without relaxing the localhost-only macOS sandbox or disabling native plugins.

Successful runs used the existing public dependency cache via `APERTURE_PUBLIC_CACHE` and the approved temporary base via `APERTURE_TEST_TMPDIR`:

```sh
bun run build
bun run typecheck
bun test
bun scripts/probe-routing.ts --relay
bun scripts/probe-routing.ts
```

`bun test`: 79 passed, 0 failed, 283 expectations. Build and typecheck passed. Both routing invocations passed all five scenarios. Host: OpenCode 1.18.29 on darwin-arm64; embedded Bun 1.3.14 as previously measured; harness/build/test Bun 1.4.2. Probe output now labels Bun as the harness version. Relay mode requires macOS because the harness's verified outbound containment uses `sandbox-exec`; there is no claimed equivalent coverage elsewhere. Dependency preparation precedes sandboxed credential-bearing host execution and can use public package networking.

### Remaining Limits

Task 1.11 records only this successful preliminary leg. Full gate tasks remain unchecked. No native login or refresh was exercised: the isolated host received an unexpired synthetic OAuth record via its public API. No auth files were read. Transcripts, telemetry, persisted secret scans, all error paths, native retries, helper failure/disconnect, rejecting-listener retention, absolute/duplicate-Host abuse, Connection nominations, authenticated Host/Origin attacks, redirects, TLS, streamed CONNECT uploads, and bounded backpressure still require proof. Private enrollment UX and upstream bridge artifact verification remain pending. Same-user compromise is not defended by a loopback capability.

The fixture uses simple equality for its test capability and a basic streaming forwarder; it is not a production security implementation. No live enrollment, real credentials, remote Aperture traffic, publication, or production plugin changes occurred. The positive native-header/relay result supersedes the routing dead end only for this newly approved architecture, not the historical config-only or fetch-adapter findings.

## Authenticated Forward Proxy and HTTPS Differential

### Scope and Implementation

Added `scripts/fixtures/forward-proxy.ts`, its loopback unit tests, native routing modes `--relay-proxy-http` / `--relay-proxy-https`, and `scripts/probe-connect.ts`. These remain outside the distributed package. The forward proxy creates independent random Basic credentials privately, permits only the fixed numeric-loopback destination, supports HTTP forwarding and HTTPS CONNECT, strips HTTP private/hop headers, and closes owned sockets/streams. Proxy credentials never enter config options, child environments, or persisted settings.

Native proxy modes perform the packaged plugin's original direct loopback discovery plus an independent discovery through the proxy. This is two fixture discovery requests, not proof that production discovery is integrated. Native inference uses the private-capability reverse relay without modifying native OAuth fetch. HTTP traversal counts must equal proxied discovery plus OpenAI inference requests; unrelated-provider inference adds no proxy traversal. HTTPS assertions correlate gateway peer ports with proxy-owned CONNECT socket ports so discovery alone cannot satisfy inference traversal checks; the failing embedded runtime has not passed these assertions for inference.

### Results

| Check | Outcome |
| --- | --- |
| Native `--relay-proxy-http`, OpenCode 1.18.29 / embedded Bun 1.3.14 | All five scenarios pass: text, tools, concurrency, cancellation, unrelated provider |
| Native `--relay-proxy-https`, same host | Discovery succeeds; first inference times out at the bounded 45-second API deadline; no scenario marked passed |
| Ordinary native routing regression | All five scenarios pass |
| Proxy unit tests on Bun 1.4.2 and embedded 1.3.14 | Five tests, 37 expectations pass on each |
| Full `bun test` on Bun 1.4.2 | 84 tests, 320 expectations pass |
| Typecheck | Pass |

The proxy tests exercise missing/wrong authentication, fixed-target/path rejection before upstream contact, private/hop-header stripping, raw CONNECT authority checks and parser head-byte forwarding, streaming disconnect/disposal, and incomplete-header client cleanup. They do not establish the full production reverse-relay security requirements.

The separate `probe-connect.ts` executes actual Bun fetch against ephemeral TLS servers and the same proxy without OpenCode or the reverse relay:

| Differential case | Bun 1.4.2 | Embedded Bun 1.3.14 |
| --- | --- | --- |
| Direct and CONNECT discovery | Pass | Pass |
| Direct and CONNECT fixed-body POST with payload hash verification | Pass | Pass |
| Direct streamed POST and first chunk before producer completion | Pass | Pass |
| CONNECT streamed POST | Pass | Fails: three-second deadline |
| CONNECT first chunk before producer completion | Pass | Fail; producer completed without successful delivery |
| Explicit streaming-producer abort fixture | Pass | Pass |
| Untrusted certificate and trusted wrong-hostname certificate rejection | Pass | Pass |
| Redirect rejection without contacting redirect sink | Pass | Pass |
| SSE reader cancellation reaches upstream, direct and CONNECT | Pass | Fails: deadline in both modes |
| TCP-refusal port checks and temporary-storage cleanup | Pass | Pass |

This isolates a version-sensitive streamed-CONNECT failure: fixed bodies and direct streaming succeed in the older runtime, and the same proxy/client probe succeeds in 1.4.2. It does not establish the exact internal Bun cause or prove a newer OpenCode binary works. Reader-only SSE cancellation is a separate older-runtime failure, not demonstrated to be CONNECT-specific. The native HTTP session-abort test is a different cancellation path and still passes.

### Reproduction

All runs used darwin-arm64, OpenCode 1.18.29, standalone Bun 1.4.2, embedded Bun 1.3.14, and OpenSSL 3.6.2. Set `APERTURE_TEST_TMPDIR` to the approved temporary parent and `APERTURE_PUBLIC_CACHE` to the existing isolated public dependency cache as in the prior proof.

```sh
bun run typecheck
bun test
env BUN_BE_BUN=1 opencode test test/forward-proxy.test.ts
bun scripts/probe-routing.ts
bun scripts/probe-routing.ts --relay-proxy-http
bun scripts/probe-routing.ts --relay-proxy-https
bun scripts/probe-connect.ts
env BUN_BE_BUN=1 opencode scripts/probe-connect.ts
```

Native HTTPS and the embedded differential intentionally exit nonzero on the observed failures. The differential reports individual sanitized results and continues other cases; no failure is converted into success. No raw exception, application payload, proxy URL, key, or native log is printed. Certificates/private keys are generated in disposable storage, trust is supplied per request, and TLS verification remains enabled.

### Cleanup and Limits

Native probe cleanup now drains child logs, includes proxy and TLS listener ports, and requires TCP connection refusal rather than treating any failed HTTP request as a closed listener. All recorded native attempts reported stopped child processes, removed storage, and refused listener ports. This still does not prove production native-disposal ordering, rejecting-listener retention, helper failure handling, or stale-port safety. The differential explicitly closes sockets and storage then forces process exit; it does not establish natural runtime quiescence. Its emergency watchdog can leave synthetic temporary files if normal bounded cleanup itself stalls.

The producer-abort fixture uses its own signal listener, so it proves fetch rejection and explicit producer cleanup, not independent upstream disconnect or automatic runtime producer cancellation. Secrecy assertions inspect raw capability/password prefixes in config APIs and captured logs, not every encoded form, telemetry, transcript, or persisted surface. CONNECT cannot inspect encrypted application headers; successful gateway assertions verify their separation for the tested native traffic. No real bridge artifact, Tailscale helper, enrollment, remote gateway, native refresh, or native retry policy was tested.

Tasks 1.12 and 1.13 record completed scoped proofs/investigation. Broad tasks 1.2, 1.4, 1.9, 1.10, and production verification remain incomplete. HTTPS is **NO-GO on this embedded runtime** without a newly reviewed and verified runtime/architecture choice. Do not silently buffer whole request bodies, downgrade to HTTP, disable TLS checks, or equate standalone Bun 1.4.2 success with installed OpenCode support.

## Final Separate-Worker Verification

The explicit external worker resolves the streamed-CONNECT incompatibility for the
tested synthetic native path without modifying OpenCode's embedded runtime or
native authentication. The selected executable was
`/Users/lbriggs/.local/share/mise/installs/bun/1.4.2/bin/bun`, reporting Bun 1.4.2.
Host remains OpenCode 1.18.29 / embedded Bun 1.3.14, darwin-arm64. This is a
separate child using the same entrypoint/protocol available to future explicitly
selected embedded mode, not an in-process compatibility workaround.

Final checks after dotenv/preload isolation, compressed-response correction, and
startup streamed-CONNECT plus reader-cancellation smoke:

| Command | Final result |
| --- | --- |
| `bun test` | 126 pass, 0 fail, 444 expectations across seven files |
| `bun run typecheck` | Pass |
| `bun run build` | Pass; default bundle still contains only existing plugin modules |
| `bun scripts/probe-routing.ts --relay-worker-https` | All five native HTTPS scenarios pass |
| `bun scripts/probe-routing.ts --relay-worker-embedded --expect-worker-rejection` | Expected runtime rejection passes; no external runtime fallback |
| `bun scripts/probe-routing.ts` | All five default routing scenarios pass |
| `bun scripts/probe-routing.ts --relay-proxy-http` | All five in-host HTTP proxy regression scenarios pass |
| `env BUN_BE_BUN=1 opencode test test/transport-process.test.ts test/transport-worker.test.ts` | 35 pass, seven intentionally skipped, 68 expectations |

Native probes used the previously documented `APERTURE_PUBLIC_CACHE` and approved
`APERTURE_TEST_TMPDIR`. Each reported removed temporary storage, stopped children,
and TCP-refused recorded listeners. No real enrollment or remote gateway traffic
occurred. The embedded unit run skips five real-worker positives requiring exact
Bun 1.4.2 and two stdout-fd EOF fixtures whose behavior differs on embedded 1.3.14;
the standalone run executes all of them. Fake protocol versions in unit fixtures
are not executable attestation. The actual-worker positive and installed embedded
negative provide the distinct runtime evidence.

The negative preserves the existing packaged gateway configuration and sends no
inference. It establishes rejection before worker activation and absence of
cross-runtime fallback, not fail-closed inference. The original startup-failure
contract still allows existing gateway/native routing.

The supervisor is implemented in `src/transport-process.ts` but is not imported
by the shipped plugin. The worker, shared relay, and proxy remain synthetic
fixtures copied into the isolated installed consumer. Actual bridge loading,
enrollment/configuration UX, release packaging, runtime-path UX, and production
activation remain incomplete. Unexpected worker death still releases the
native-facing relay port, so invalidating a capability getter does not protect
cached native retries; task 1.4 remains open. Task 1.17 retains its untested native
TLS-negative/redirect and bounded-memory/backpressure-stress portions. Focused
tasks 1.14-1.16, 1.18, and 1.19 do not close those broad security/support gates.
