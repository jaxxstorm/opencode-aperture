## ADDED Requirements

### Requirement: Explicit enrollment progress and cancellation

Enrollment SHALL show private progress followed by the login URL when received. Its default confirmation action SHALL NOT cancel enrollment. Cancellation SHALL be explicitly labelled, abort worker startup, leave saved settings unchanged, and produce nonsecret feedback unless the TUI is shutting down. Cleanup SHALL NOT clear an unrelated replacement dialog. Login URLs SHALL remain confined to the private dialog, never logs, toasts, model context or persisted settings. Known failure categories SHALL give actionable guidance without raw exception details.

#### Scenario: Confirm while waiting
- **WHEN** the user presses Enter on the default waiting action before or after the login link arrives
- **THEN** enrollment remains active and the private dialog stays available

#### Scenario: Cancel or replace enrollment
- **WHEN** enrollment is explicitly cancelled, dismissed, or replaced by another dialog
- **THEN** startup is aborted and nonsecret cancellation feedback is shown
- **AND** cleanup preserves any unrelated replacement dialog and saved settings

### Requirement: Login using saved settings

The TUI SHALL expose `/aperture-login` in the palette namespace. It SHALL require saved connection settings, confirm trust, and offer enrollment without repeating configuration fields. It SHALL retain the existing private browser/environment-reference handling and restart requirement. Missing saved settings SHALL direct the user to setup without starting a worker.

#### Scenario: Retry browser enrollment
- **WHEN** a configured user invokes `/aperture-login` and chooses browser enrollment
- **THEN** the worker uses the saved gateway, runtime, module, hostname and state path after confirmation without re-prompting for them

## MODIFIED Requirements

### Requirement: Private OpenCode enrollment UX

The optional local TUI SHALL provide `/aperture-setup`, `/aperture-login`, `/aperture-status`, `/aperture-disconnect`, and `/aperture-forget` as explicitly invoked commands opening private dialogs through public host interfaces, never model tools. Setup SHALL show the HTTPS gateway and trust implications and offer browser enrollment with URL displayed only in a private enrollment dialog, or input of an explicit user-owned `authKeyEnv` reference. The private enrollment dialog SHALL distinguish a default Keep waiting action from explicit cancellation and SHALL NOT cancel on ordinary default confirmation. Because public `DialogPrompt` cannot mask, it SHALL NOT prompt for an unmasked key value. The user's referenced key SHALL be resolved transiently and sent via private control stdin, never inherited by children; only its variable name may be saved. This replaces the earlier masked key-input requirement while preserving explicit user-credential enrollment. Secrets and enrollment URLs SHALL NOT enter model context, chat transcripts, ordinary logs, settings, argv, or child environments. Saving nonsecret settings SHALL be atomic and owner-only. Startup SHALL NOT prompt interactively. Native ChatGPT credentials SHALL never be read or persisted and native login SHALL remain separate and unchanged.

#### Scenario: Browser enrollment
- **WHEN** the user explicitly chooses browser enrollment for new state
- **THEN** the enrollment URL is shown only in a private interactive surface and startup is bounded and cancellable
- **AND** completion saves only nonsecret settings and bridge-owned private node state and instructs the user to restart OpenCode

#### Scenario: Auth-key enrollment
- **WHEN** the user supplies an explicit environment-variable name through a private setup dialog
- **THEN** only that reference is saved and its resolved key is passed transiently to bridge enrollment, never saved, echoed or inherited by children, and never reused as an OpenAI credential
- **AND** a missing referenced value produces a sanitized setup-required error without a fallback unmasked key prompt or ambient `TS_*` enrollment

#### Scenario: Setup cancellation
- **WHEN** the user cancels enrollment or its deadline expires
- **THEN** helper work is closed, saved settings remain unchanged, and only a sanitized status is displayed

#### Scenario: Headless enrollment is missing
- **WHEN** enabled startup has no reusable enrollment, no usable explicit authKeyEnv, and no explicit interactive setup underway
- **THEN** setup returns a bounded setup-required diagnostic without waiting for UI input
