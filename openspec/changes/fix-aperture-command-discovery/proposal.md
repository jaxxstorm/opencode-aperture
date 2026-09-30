## Why

The local TUI registers Aperture commands without the namespace required by OpenCode's command palette and slash-command discovery. Users therefore cannot invoke setup even when the TUI plugin loads successfully.

## What Changes

- Register all four Aperture commands in the public `palette` namespace.
- Make the TUI test harness apply the host's namespace filter, preventing tests from invoking commands that users cannot discover.
- Rebuild the local TUI bundle without altering the user's profile or credentials.
- Non-goals: OAuth changes, auth-file access, token persistence, API-key behavior, transport changes, or new configuration fields.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `optional-tailscale-bridge`: Make the existing local setup and management commands discoverable through the palette and slash list.

## Impact

Changes `src/tui.ts`, `test/tui.test.ts`, and the generated TUI bundle. Native authentication, worker routing, and saved settings remain unchanged.
