## 1. Command Discovery Fix

- [x] 1.1 Reproduce the missing commands with a test harness that applies the host's palette namespace filter. The targeted regression returned zero commands before the fix.
- [x] 1.2 Register all four commands in the palette namespace and verify their existing private handlers still work. All 10 TUI tests pass with the namespace-filtering harness.
- [x] 1.3 Run tests and typecheck, rebuild the TUI, verify built command registration, and document restart instructions without accessing real credentials. Full suite: 200 pass, 922 expectations; typecheck/build and strict change validation pass. Registration from `dist/tui.js` exposes all four expected slash names under the host's palette filter. Restart the local TUI with `zsh scripts/launch.zsh`; no auth or node-state files were read. Actual interactive confirmation remains with the user.
