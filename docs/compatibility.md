# Compatibility and Evidence

Status: owner-approved `@jaxxstorm/opencode-aperture@0.1.0`, prepared for public distribution under MIT (copyright 2026 Lee Briggs), **unpublished**. Local release-workflow revision checks pass on darwin-arm64. Ubuntu/macOS CI, npm scope access, and external publishing setup are not verified.

## Exact Baseline

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

- Native OAuth login, header injection, and HTTP/SSE routing are the architecture; native refresh through this gateway and refreshed-token persistence remain **unverified**.
- Live tools, gateway-correlated live text/tools, live cancellation, and live concurrent-session behavior are **unverified**. Synthetic coverage above is separate from live behavior.
- WebSocket transport is **unsupported** and must remain disabled in verification.
- Residency-sensitive accounts are **unsupported**: native residency headers are currently added inside the rewrite branch this route avoids. Do not synthesize headers or infer residency guarantees.
- The plugin reports sanitized setup errors but does not disable providers or block requests. OpenCode may ignore those errors and retain native routing; check logs and restart after fixing configuration.
- Missing/unloadable modules, conflicting OpenAI auth/fetch/config plugins, future versions, and untested platforms are outside the verified boundary.

## Recording New Evidence

Record date, exact OpenCode and Bun versions, OS/platform, candidate version and artifact checksum, command, result, sanitized evidence location, and unresolved failures. Separate source-adapter, built-file, installed-tarball, CI, and live results. Never promote a version from source inspection, a gateway hit followed by HTTP 400, or a CLI exit code without session completion/error assertions.

Only add a tested combination after reviewing its actual results. Keep failing/latest exploratory results separate. No fail-closed or no-direct-traffic guarantee is offered; egress tracing is not a compatibility gate. Live validation requires the [explicit opt-in procedure](live-validation.md), outside CI.
