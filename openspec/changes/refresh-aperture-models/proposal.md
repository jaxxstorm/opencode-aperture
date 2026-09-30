## Why

Successful Tailscale enrollment currently saves settings but leaves the running OpenCode instance and model selector unchanged until restart. Users expect enrollment to make Aperture models available immediately and need an explicit way to refresh the gateway catalog later.

## What Changes

- After enrollment is closed and settings are saved, refresh the idle current instance through the public SDK, allowing native TUI synchronization to populate the model selector.
- Add `/aperture-models` in the palette namespace for manual refresh and native model selection.
- Refuse reload while the current instance has busy or retrying sessions; report saved enrollment separately from deferred or failed refresh.
- Rediscover models through an existing shared worker when an instance is recreated, without restarting transport still used by other projects.
- Non-goals: OAuth implementation, auth-file access, token persistence, API-key changes, global instance disposal, private TUI store mutation, and runtime/provider config persistence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `optional-tailscale-bridge`: Automatic and manual model refresh after enrollment, with safe current-instance reload and fresh shared-worker catalogs.

## Impact

TUI commands, a public-SDK refresh helper, worker discovery protocol/runtime pooling, and tests/probes. Native OpenAI login stays separate and model policy remains unchanged.
