## ADDED Requirements

### Requirement: Test the installed release candidate safely

The automated integration suite SHALL run stock OpenCode against an installed release tarball in isolated config and storage, with synthetic credentials registered through OpenCode's auth API. It SHALL NOT read or modify the user's real auth state. Tests SHALL have bounded waits and SHALL clean up temporary resources on success, failure, and handled termination. Failure diagnostics SHALL be sanitized.

#### Scenario: Isolated packaged routing probe
- **WHEN** a developer or CI runs the documented integration command
- **THEN** the installed package is exercised without the local development adapter or inherited credentials
- **AND** only synthetic identity data is used and no credential values are emitted

#### Scenario: Probe fails or is interrupted
- **WHEN** an assertion fails, a subprocess stalls, or the harness receives handled termination
- **THEN** its child processes and listeners are stopped and temporary storage is removed within bounded cleanup time

### Requirement: Validate successful streaming and tool round trips

The synthetic gateway suite SHALL verify completed Responses SSE text, a deterministic harmless tool-call round trip, cancellation, and concurrent-session isolation through stock OpenCode. A request received followed by intentional HTTP 400 SHALL NOT count as successful inference coverage.

#### Scenario: Streaming text completes
- **WHEN** the mock gateway emits a valid streaming Responses sequence
- **THEN** OpenCode produces the expected final text and completion event

#### Scenario: Tool result returns to the gateway
- **WHEN** the gateway emits a tool call for a permitted deterministic fixture tool
- **THEN** OpenCode executes only that allowed tool and sends the matching result to `/codex/responses`
- **AND** the subsequent response completes normally

#### Scenario: User aborts a delayed response
- **WHEN** the session is cancelled while the mock gateway streams a delayed response
- **THEN** the active request is cancelled and server-side cancellation is observed

#### Scenario: Two concurrent sessions
- **WHEN** two sessions issue requests concurrently
- **THEN** each session receives its own fixture response with distinct session correlation and without cross-session data mixing

### Requirement: Observe packaged routing outcomes

Compatibility tests SHALL cover the installed tarball's routing through the mock gateway, including text streaming, tool-call round trips, concurrency, cancellation, and non-OpenAI provider scoping. Unit tests SHALL cover unreachable/timed-out discovery, malformed and ambiguous catalogs, invalid configuration, and non-destructive setup-error handling. Synthetic credentials SHALL only be sent to a loopback mock gateway and SHALL never reach external services. The plugin SHALL NOT be modified to satisfy tests.

#### Scenario: Setup failure is non-destructive
- **WHEN** a loaded plugin encounters host-validation or discovery failure with an OpenAI default
- **THEN** the plugin reports a sanitized diagnostic without disabling providers and without throwing or blocking during subsequent request handling

#### Scenario: Inference gateway is unavailable
- **WHEN** discovery succeeds but the gateway later refuses or fails an inference request
- **THEN** the error is observable in OpenCode's native session result and the plugin adds no retries, credential repair, or request-time handling

### Requirement: Versioned compatibility gates

CI SHALL run locked dependency installation, typechecking including scripts, unit tests, build/package checks, and packaged integration tests against pinned stock OpenCode 1.18.29. A latest-version canary SHALL report drift separately. Compatibility documentation SHALL list exact tested OpenCode/Bun/platform combinations and SHALL NOT promote a version based on source inspection alone.

#### Scenario: Baseline regression
- **WHEN** a required baseline check fails
- **THEN** the release candidate is not marked verified

#### Scenario: Latest OpenCode changes behavior
- **WHEN** the canary fails on a newer version
- **THEN** the failure is visible and that version is not added to supported combinations without passing evidence

### Requirement: Explicit live validation and coverage limits

Live verification SHALL require explicit user authorization for a trusted gateway, use native OpenCode authentication without inspecting or editing credential storage, and remain outside automatic CI. Results SHALL distinguish routing, text, tool, cancellation, and refresh evidence. WebSockets and residency-sensitive account support SHALL remain outside initial support claims.

#### Scenario: Existing live model evidence
- **WHEN** documentation records the September 5, 2026 tests
- **THEN** it identifies successful text responses for `gpt-5.6-luna` and `gpt-6-astra` on OpenCode 1.18.29
- **AND** it does not label those short responses as proof of refresh, tool-call, or gateway-log correlation coverage

#### Scenario: Native refresh soak test
- **WHEN** an authorized live test spans natural credential expiry
- **THEN** refresh is marked verified only with non-secret evidence of native refresh and subsequent gateway-bound success
- **AND** if such evidence is unavailable the result is explicitly recorded as unverified rather than forcing expiry by editing credentials

#### Scenario: No live authorization
- **WHEN** only automated checks are requested or a trusted gateway is unavailable
- **THEN** synthetic tests remain runnable and no real credentials are sent for live testing
