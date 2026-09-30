## ADDED Requirements

### Requirement: Discoverable TUI commands

The local TUI SHALL register its setup, status, disconnect, and forget commands in the public palette namespace so OpenCode can discover them through both its command palette and slash list. Discovery SHALL NOT depend on a model tool or custom prompt command.

#### Scenario: Setup command discovery
- **WHEN** the TUI plugin loads on the supported OpenCode host
- **THEN** palette namespace discovery exposes `/aperture-setup`, `/aperture-status`, `/aperture-disconnect`, and `/aperture-forget`
- **AND** selecting setup invokes the existing private setup handler
