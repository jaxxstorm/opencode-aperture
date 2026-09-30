## ADDED Requirements

### Requirement: General Provider Authentication and Protocol Scope

Enabled server routing SHALL accept per-remote-ID server-plugin tuple options `auth: { [remoteID]: { mode: 'gateway' | 'passthrough' | 'subscription', apiKeyEnv?, protocol? } }`. Server hooks SHALL require `OPENCODE_APERTURE_ENABLE=1`. Gateway mode SHALL default when `requires_client_auth` is absent or false, without treating this as proof of server auth policy. True with Responses SHALL retain legacy native OpenAI subscription selection; true without Responses SHALL require an explicit supported auth selection. At most one enabled nonempty subscription Responses provider SHALL be selected.

Gateway/passthrough providers SHALL use namespaced `aperture-*` IDs, splitting mixed-protocol groups. Supported adapters SHALL be limited to Responses, Chat, Messages, Bedrock Converse, and Gemini. Unsupported protocols, unsafe path models, and ambiguous path-model routing SHALL be skipped with unsupported summaries. Unknown model limits SHALL be documented as overridable estimates of 128000 context and 8192 output tokens.

#### Scenario: Managed and explicit passthrough credentials
- **WHEN** a remote provider selects gateway or passthrough mode
- **THEN** native credentials from other provider IDs SHALL NOT be borrowed and SDK-supplied upstream auth SHALL be stripped
- **AND** passthrough SHALL send only the explicitly selected nonempty environment key, held in runtime closures rather than serialized config
- **AND** Bedrock SigV4 passthrough SHALL be rejected rather than borrowing ambient AWS credentials

#### Scenario: SDK model semantics and wire qualification
- **WHEN** a generated Responses, Chat, or Messages provider serializes an inference request
- **THEN** SDK configuration SHALL retain the raw upstream model ID for reasoning/capability semantics
- **AND** only the fetch boundary SHALL qualify the outgoing JSON model as `<remote-provider-id>/<raw-model-id>` after SDK transformations, without changing native subscription/Codex routing

#### Scenario: Extra catalog metadata
- **WHEN** a gateway catalog includes extra metadata such as `description`
- **THEN** the implementation SHALL project the supported catalog fields into the strict private worker protocol rather than forwarding arbitrary metadata

#### Scenario: Catalog visibility without inference evidence
- **WHEN** supported models appear in the catalog or synthetic probes pass
- **THEN** documentation SHALL NOT imply gateway grants, arbitrary API support, or successful live inference
- **AND** Gemini SDK mocks SHALL remain distinct from native integration evidence

### Requirement: General Provider UX and Launcher Documentation

Documentation SHALL describe refresh readiness across `aperture-*` and native `openai` with an Aperture label. It SHALL describe private enrollment URL display, macOS/Linux auto-opening only for new URLs, and identity reuse without a URL/browser. Passing the URL as an OS opener argument SHALL be disclosed as an explicit exception, not an absolute privacy guarantee; enrollment links SHALL NOT enter plugin logs, chat, or settings.

#### Scenario: Isolated passthrough launch
- **WHEN** documenting environment forwarding for the isolated launcher
- **THEN** `APERTURE_PASSTHROUGH_ENV` SHALL denote explicit comma-delimited existing environment variable names, never inline key values
- **AND** the launcher SHALL pass selected values only through the child environment, not argv, and reject invalid/reserved names and unset or empty values
- **AND** documentation SHALL describe implemented forwarding without global configuration changes or wholesale auth environment inheritance

#### Scenario: Launcher termination
- **WHEN** the launcher receives a termination signal
- **THEN** it SHALL forward the signal and allow a 10-second grace deadline before forced termination to accommodate bridge cleanup of up to seven seconds

#### Scenario: Verification claims
- **WHEN** reporting current verification
- **THEN** four native gateway protocols, five subscription scenarios, and installed refresh passes SHALL be identified as synthetic evidence preceding the latest fetch-boundary qualification change, with the latest installed gateway rerun still pending
- **AND** authorized real-bridge catalog discovery on 2026-09-29 SHALL be recorded separately as eight providers, 10 groups, 42 model entries, zero unsupported, and `subscription: false`, without claiming live inference
- **AND** the resolved TypeScript crash and reported fresh typecheck pass SHALL be distinguished from the still-running final full suite, with no unconfirmed final count
- **AND** native Gemini mock-only coverage and deferred live inference SHALL remain explicit evidence limits, not mandatory unfinished implementation tasks
