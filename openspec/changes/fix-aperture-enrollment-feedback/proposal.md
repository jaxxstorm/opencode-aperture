## Why

Browser enrollment currently uses an alert whose OK action aborts enrollment silently. Users can mistake it for a continue/open-browser action and see no login link or explanation after completing a lengthy setup flow.

## What Changes

- Replace enrollment alerts with a private waiting/link dialog whose default action keeps waiting and whose cancellation is explicit and acknowledged.
- Preserve the private URL when replacing progress, and do not clear another dialog during cancellation cleanup.
- Add `/aperture-login` to enroll using saved connection settings without repeating configuration prompts.
- Show allowlisted actionable failure categories, retaining upstream bridge error codes without exposing raw errors or credentials.
- Non-goals: automatic browser launch, OAuth implementation, auth-file access, token persistence, API-key behavior, or routing changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `optional-tailscale-bridge`: Explicit enrollment progress/cancellation and saved-settings login.

## Impact

Touches TUI enrollment, sanitized worker failure messages, tests, and built bundles. Does not inspect or modify user identity or native credentials.
