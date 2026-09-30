## ADDED Requirements

### Requirement: Automatic and manual model refresh

After successful enrollment, the TUI SHALL close the enrollment worker and save settings before attempting model refresh. It SHALL also expose `/aperture-models` in the palette namespace. Refresh SHALL use only public current-instance disposal and native provider catalog synchronization, never global disposal, private TUI state writes, auth-file access, or persisted runtime configuration. The plugin SHALL refuse reload while any target-instance session is busy or retrying or status cannot be determined. Refresh requests, event waits and catalog-readiness observation SHALL be bounded and cancellable, with listeners cleaned up on every exit.

#### Scenario: Enrollment populates models
- **WHEN** enrollment succeeds, settings are saved, and the current instance is idle
- **THEN** the current instance reloads, discovery runs, and the native model selector receives the resulting Aperture-backed OpenAI catalog
- **AND** success is reported only after the rebuilt native provider catalog contains valid Aperture-backed model IDs and names

#### Scenario: Manual refresh
- **WHEN** an enabled local profile invokes `/aperture-models` while idle
- **THEN** the command requests local-server confirmation before refreshing the current catalog and opens native `model.list` only after synchronization

#### Scenario: Refresh safety limits
- **WHEN** a user refreshes models on the local server
- **THEN** the UX warns against starting new requests during refresh because status checking and disposal are not atomic
- **AND** cancelling stops waiting but cannot roll back a server reload already accepted; native history is not deleted
- **AND** native OAuth login is not required for selector visibility, while inference authentication remains separate

#### Scenario: Active sessions or failed refresh
- **WHEN** sessions are busy/retrying, status is unavailable, discovery fails, or TUI synchronization times out
- **THEN** the plugin reports a deferred or failed refresh without claiming models are ready
- **AND** successful enrollment and saved settings remain intact, with instructions to retry `/aperture-models` or restart

### Requirement: Fresh discovery through shared workers

Recreated instances acquiring an existing shared worker SHALL request a fresh bounded discovery through its proxy without replacing transport used by other instances. Concurrent discovery requests SHALL be coalesced. Discovery failure SHALL reject that refresh without replacing a previously valid model snapshot or terminating other active owners solely because the catalog request failed. Worker exit or shutdown SHALL settle pending discovery requests with sanitized errors.

#### Scenario: Refresh while another project owns the worker
- **WHEN** one instance reloads after the gateway catalog changes while another instance retains the worker
- **THEN** the reloaded instance receives the new valid catalog and the existing worker is not restarted

#### Scenario: Catalog failure
- **WHEN** refresh discovery returns an invalid catalog or times out
- **THEN** refresh fails safely, preserves the previous valid model snapshot, and does not silently retry or bypass the proxy

## MODIFIED Requirements

### Requirement: Private OpenCode enrollment UX

The optional local TUI SHALL provide `/aperture-setup`, `/aperture-login`, `/aperture-models`, `/aperture-status`, `/aperture-disconnect`, and `/aperture-forget` as explicitly invoked commands opening private dialogs through public host interfaces, never model tools. Setup SHALL show the HTTPS gateway and trust implications and offer browser enrollment with URL displayed only in a private `DialogSelect` enrollment dialog, or input of an explicit user-owned `authKeyEnv` reference. The private enrollment dialog SHALL distinguish a default Keep waiting action from explicit cancellation and SHALL NOT cancel on ordinary default confirmation. Because public `DialogPrompt` cannot mask, it SHALL NOT prompt for an unmasked key value. The user's referenced key SHALL be resolved transiently and sent via private control stdin, never inherited by children; only its variable name may be saved. This replaces the earlier masked key-input requirement while preserving explicit user-credential enrollment. Secrets and enrollment URLs SHALL NOT enter model context, chat transcripts, ordinary logs, settings, argv, or child environments. Saving nonsecret settings SHALL be atomic and owner-only. Startup SHALL NOT prompt interactively. Native ChatGPT credentials SHALL never be read or persisted and native login SHALL remain separate and unchanged. Successful enrollment SHALL close and clean up its worker and save settings before attempting guarded current-instance model refresh. Busy or failed refresh SHALL report that enrollment succeeded and settings were saved, with `/aperture-models` or restart as fallback, rather than requiring unconditional restart after enrollment. Saved status SHALL NOT be presented as live connectivity, and disconnect SHALL retain its restart requirement.

#### Scenario: Browser enrollment
- **WHEN** the user explicitly chooses browser enrollment for new state
- **THEN** the enrollment URL is shown only in a private interactive surface and startup is bounded and cancellable
- **AND** completion saves only nonsecret settings and bridge-owned private node state after worker cleanup, then attempts guarded model refresh with manual refresh or restart guidance if readiness cannot be verified

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
