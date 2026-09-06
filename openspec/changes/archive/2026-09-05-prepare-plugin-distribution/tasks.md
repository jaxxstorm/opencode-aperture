## 1. Package Bootstrap

- [x] 1.1 Move the plugin factory into `src/index.ts` with only one runtime root export; convert the local adapter to use the same implementation and verify local loading is not duplicated.
- [x] 1.2 Add compatible public plugin and Bun development types, include scripts in typechecking, and create a reproducible locked dependency installation without runtime SDK imports.
- [x] 1.3 Add the self-contained ESM build, package entrypoint, explicit publish allowlist, and build/pack commands; retain the current package name provisionally and do not publish.
- [x] 1.4 Add a tarball-content assertion and a clean-consumer install/load smoke test that cannot resolve source-checkout files or development-only dependencies.

## 2. Discovery and Configuration

- [x] 2.1 Implement gateway-origin validation with existing host precedence/default; test trailing slashes and rejection of malformed URLs, credentials, queries, fragments, paths, and unsupported schemes without leaking input values.
- [x] 2.2 Bound discovery to 10 seconds, reject redirects and non-success statuses, validate response shapes, and test malformed JSON, invalid records, unavailable hosts, and timeouts.
- [x] 2.3 Require exactly one client-auth Responses-compatible provider, deduplicate model IDs in order, and test empty, chat-only, multiple-candidate, and mixed eligible/noneligible catalogs.
- [x] 2.4 Preserve explicit default models and user model metadata, intersect existing whitelists, select the first allowed default only when absent, and test invalid selections, unrelated providers, and idempotency.
- [x] 2.5 Restrict the plugin marker to OpenAI, preserve supplied headers, remove inert endpoint-variable/shell propagation, and test the actual host/debug configuration contract.

## 3. Non-Destructive Failures and Diagnostics

- [x] 3.1 Register hooks before discovery; capture setup failures in the config lifecycle without disabling providers, without blocking or throwing during request handling, and with unrelated providers unchanged.
- [x] 3.2 Implement allowlisted diagnostics with debug enabled only by `1`; test current hook shapes and absence of synthetic secrets in success, invalid-URL, malformed-response, and setup-error logs.
- [x] 3.3 Review production code to confirm no auth-file access, token persistence, auth loaders, fetch replacement, or other identity/fetch ownership in the plugin.

## 4. Packaged Runtime Verification

- [x] 4.1 Extend the isolated stock-OpenCode harness to load the installed tarball with synthetic auth, bounded startup/request/cleanup deadlines, handled termination, and sanitized failure diagnostics.
- [x] 4.2 Assert the actual `/codex/responses` destination, bearer/account/session/originator/user-agent/content headers, scoped marker, and debug-hook execution through the packaged plugin.
- [x] 4.3 Add a protocol-valid Responses SSE text fixture and assert exact text plus normal session completion rather than treating HTTP 400 receipt as inference success.
- [x] 4.4 Add a deterministic harmless fixture tool, permit only that tool, and assert its call/result correlation and subsequent gateway-bound completion.
- [x] 4.5 Add delayed-stream cancellation with gateway-side abort observation and concurrent-session tests that detect cross-session response or identifier mixing.
- [x] 4.6 Confirm the packaged harness only ever targets the loopback mock gateway and that synthetic credentials never leave localhost.
- [x] 4.7 Confirm setup failures (invalid host, unreachable/timed-out discovery, malformed or ambiguous catalogs) report sanitized diagnostics and leave native configuration unchanged without disabling providers.
- [x] 4.8 Confirm gateway request errors are surfaced by native OpenCode behavior with no plugin response handling, retries, or credential repair.
- [x] 4.9 Exercise harness failure and handled-interruption paths to verify processes, listeners, and synthetic storage are cleaned up and real user state is untouched.

## 5. CI and User Documentation

- [x] 5.1 Add CI for locked installation, typecheck, unit tests, build/pack inspection, and the packaged positive routing suite against pinned stock OpenCode 1.18.29, without real credentials or automatic publication.
- [x] 5.2 Add a scheduled or manually dispatched latest-version canary and an exact-version/runtime/platform compatibility table that distinguishes baseline checks from exploratory results.
- [x] 5.3 Write installation, native subscription login, version pinning, host/debug configuration, restart, local-to-package migration, and removal instructions, including protected-transport and conflicting-plugin warnings.
- [x] 5.4 Reconcile active `openspec/project.md` and configuration guidance with the packaged config-only architecture, actual environment variables, and non-destructive failure behavior without rewriting historical bootstrap artifacts.
- [x] 5.5 Document existing `gpt-5.6-luna` and `gpt-6-astra` text evidence and an opt-in live procedure for gateway-correlated text/tools and natural-expiry refresh; explicitly label unverified refresh, WebSockets, and residency-sensitive accounts.

## 6. Release Readiness

- [x] 6.1 Run the complete clean build/pack/consumer verification sequence and record exact versions, platforms, results, package contents, and unresolved failures.
- [x] 6.2 Add a release checklist that blocks publication pending owner-approved licensing and registry-name ownership, records compatibility limitations, and requires a separate explicit publish action; do not invent legal terms or publish in this change.

## Implementation Checkpoint (September 5, 2026)

The plugin scope was narrowed to ordinary integration: when installed and Aperture is
reachable it routes native OpenAI requests through the gateway; otherwise it reports a
sanitized diagnostic and leaves native OpenCode configuration untouched. The previous
simulation tested disabling providers and request blocking on setup failure; that would
break existing connections and was removed. Packaged positive verification passes on
stock OpenCode 1.18.29, Bun 1.3.14, darwin-arm64: text SSE, tool round trip,
concurrency, cancellation, non-OpenAI header scoping, and failure/SIGTERM cleanup.
Unit tests: 43 passing. A production review confirmed no auth-file access, token
persistence, auth loaders, fetch replacement, or provider disabling. Baseline CI
(Ubuntu and macOS) and the manual latest-version canary are defined in
`.github/workflows/verify.yml` but have not executed yet. No Linux egress suite,
Docker, or strace is required. All 28 tasks are checked; CI execution evidence remains
the only follow-up. No publication or live credential tests were performed.
