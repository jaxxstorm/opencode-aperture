## 1. Enrollment Repair

- [x] 1.1 Replace cancel-on-OK alerts with explicit private wait/cancel state and ownership-safe cleanup; cover Enter before/after URL arrival, explicit cancellation, dismissal, foreign-dialog replacement, and shutdown without spurious toast.
- [x] 1.2 Add saved-settings `/aperture-login` and actionable sanitized failure feedback with tests for saved/missing settings, failure guidance, and private URL exclusion from toasts/settings.
- [x] 1.3 Preserve only explicitly allowlisted upstream enrollment codes and local lock/unsafe-state categories; verify unknown codes/messages retain sanitized stage fallbacks and leases clean up after failed starts.
- [x] 1.4 Full suite: 230 pass, 1051 expectations across 12 files. Typecheck, build, clean-consumer packaging, strict all-items validation (8/8), and whitespace checks pass. The rebuilt TUI registers all five palette commands including `/aperture-login`. Restart with `zsh scripts/launch.zsh` and retry saved-settings login. No actual credentials/identity files were read; live browser enrollment remains user-driven and this does not establish the exact cause of the user's prior attempt.
