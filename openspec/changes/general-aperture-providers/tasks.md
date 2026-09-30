# Tasks

## Documentation Scope

- [x] Inspect current provider, server, refresh, and launcher interfaces.
- [x] Update the main README for provider groups, auth modes, protocol limits, metadata estimates, and enablement.
- [x] Update launcher and verification documentation, distinguishing reported synthetic passes from live and compiler validation.
- [x] Add minimal active change artifacts without editing existing or archived specs.

## Main-Workstream Integration

- [x] Integrate names-only `APERTURE_PASSTHROUGH_ENV` forwarding through the child environment, rejecting invalid/reserved/missing values; record 22 tests passing before the subsequent grace adjustment.
- [x] Set launcher termination grace to 10 seconds to allow up to seven seconds of bridge cleanup.
- [x] Verify the eight remote providers through authorized real-bridge discovery on 2026-09-29: 10 groups, 42 entries, zero unsupported, `subscription: false`.
- [x] Project extra gateway metadata out of the strict private worker catalog protocol and add regression coverage.
- [x] Retain raw SDK model IDs and qualify generated JSON model IDs only at the fetch boundary, preserving native Codex.
- [x] Resolve the TypeScript internal crash using an explicit environment record annotation and record the workstream's fresh typecheck pass.

## Final Verification

- [x] Final full suite with pinned SDK probes: 350 passing tests, 2,221 expectations across 17 files; typecheck, build, packaging and all-items strict validation pass.
- [x] Final installed gateway probe passes four protocol inferences with credentials and capabilities absent from native config and upstream gateway requests. Subscription all-five and model-refresh probes also pass after fetch-boundary qualification changes.

## Evidence Limits (Not Mandatory Implementation Tasks)

- Native Gemini remains SDK-mock-only evidence, not a native integration pass.
- No live inference was performed; live inference is deferred and not required for this change. Catalog visibility is not proof of inference grants.
- Real interactive TUI/browser verification remains separate.
