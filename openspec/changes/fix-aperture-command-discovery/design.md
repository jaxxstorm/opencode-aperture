## Context

OpenCode 1.18.29 at commit `16747470f976aca3d362ad730bcd3fe82ecc2c9a` filters both palette entries and slash discovery by `namespace: "palette"` in `packages/tui/src/keymap.tsx` and `packages/tui/src/component/command-palette.tsx`. Top-level `slashName` is correct; the current registration simply lacks the namespace. The mocked test harness previously retained every registered command and missed this defect.

## Goals / Non-Goals

Make the four existing commands discoverable without changing their handlers. Do not modify enrollment, transport, persistence, auth ownership, diagnostics, or configuration formats.

## Decisions

Add the required namespace directly to each registration, keeping the existing public keymap API. Filter harness registrations by that namespace to model the observed host behavior rather than accepting hidden commands. Rebuild the bundle used by the prepared local project; the user must restart the TUI to load it.

## Risks / Trade-offs

The harness checks the pinned discovery contract, not a full interactive renderer. Verify the generated bundle registers the same commands and retain live UI confirmation as a separate check. No credentials or personal auth/state files are needed.
