# Model Refresh Evidence

## Scope and Status

This record combines implementation/test inspection with results supplied by the main implementation workstream. Those results predate its final recheck; they are not new live or interactive runs performed by the documentation update. Task 1.5 remains pending final main-workstream validation.

Only README.md, scripts/README.md and this change's artifacts are in scope for the documentation update. Main specs, other active changes and archives are not modified. The MODIFIED enrollment UX requirement carries forward the pending fix-aperture-enrollment-feedback login/private-dialog behavior while replacing unconditional post-enrollment restart with guarded refresh and fallback. That earlier change's standalone restart wording must be reconciled when syncing changes; it is not edited here.

## Reported Validation

- `bun test`: 273 passing unit tests, zero failures, 1,304 expectations in 14 files, after replacing stale TUI-state convergence with rebuilt catalog readiness and adding an isolated server-hook regression for unbridged-to-bridged refresh.
- `bun scripts/probe-routing.ts --bridge-production-refresh`: installed production-bundle probe passed on darwin-arm64, OpenCode 1.18.29 / embedded Bun 1.3.14 with external worker Bun 1.4.2, using a fake bridge and isolated fixtures.
- Final main-workstream commands passed: `bun test`, `bun run typecheck`, `bun run build`, `bun run test:package`, `bun scripts/probe-routing.ts --bridge-production-refresh`, `openspec validate --all --strict`, and `git diff --check`.
- The rebuilt TUI bundle registers `/aperture-models` in the palette namespace.

The installed probe starts without native OAuth authentication or preseeded models. The first native provider catalog contains one model; after directory-scoped `instance.dispose`, the rebuilt catalog contains two. The matching disposal event is observed through global SSE, not a global disposal call. A second project's lease keeps the same shared worker alive: three discoveries and one worker start are observed. This establishes native catalog visibility without native login; inference auth remains separate. No real gateway, real auth files, or real user state were accessed.

Initial probe setup encountered an existing public dependency cache without required package metadata. Running without `APERTURE_PUBLIC_CACHE` allowed the probe to prepare its own isolated cache. SSE cleanup was corrected by using `keepalive: false` on the event fetch. These were harness setup/cleanup issues, not evidence of real enrollment or interactive UI behavior.

## Automated Coverage

- `test/model-refresh.test.ts`: scoped public SDK calls, listeners installed before disposal returns, matching-directory events, rebuilt catalog validation without requiring a fresh TUI-state mirror, busy/retry/unknown status guards, cancellation, timeouts, scope changes, sanitized exceptions and listener cleanup.
- `test/tui.test.ts`: mocked automatic refresh after enrollment cleanup/save, saved-enrollment feedback, manual command confirmation and native picker ordering, saved enabled-settings requirement, cancellation and unchanged private settings. Actual interactive user confirmation and picker rendering were not run.
- `test/bridge-client.test.ts` and `test/bridge-runtime.test.ts`: correlated private discovery, coalescing, catalog replacement only on success, timeout/late response handling, malformed responses, close/EOF settlement, reused-worker ownership and failure preservation. Real-worker fixture coverage checks that catalog errors leave inference usable.
- `test/index-config.test.ts`: isolated regression proving a process that initially configured without saved bridge settings can enable the saved bridge on the refresh-triggered config pass without requiring restart.
- The parent discovery request is bounded to 12 seconds around the 10-second fetch. Failed catalog refresh preserves the previous valid worker snapshot and other owners' transport; it does not imply that the recreated instance or TUI is ready.

## Remaining Limits

The idle check is not atomic with disposal. A different client can start work in between, and that work could be interrupted; users must not start new work during refresh. Cancellation stops waiting and cannot roll back an accepted server reload. Native history is not deleted. The plugin's read-only TUI-state mirror can lag after disposal, so readiness is based on the rebuilt native provider catalog. No global disposal, private TUI-state mutation, native auth-file access or persisted runtime provider configuration is used.

Remote TUI is unsupported. Status remains saved settings rather than live connectivity; disconnect and manual settings/environment changes still require restart. Existing users restart once to load the new code, then use `/aperture-models` without re-enrollment; future successful enrollment refreshes automatically. Real interactive UI/browser confirmation, live gateway enrollment/inference and other platforms are not established by these tests.
