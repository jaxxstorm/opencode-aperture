## ADDED Requirements

### Requirement: Plugin Project Bootstrap
The project SHALL provide a Bun/TypeScript OpenCode plugin scaffold with a local plugin entrypoint and OpenCode configuration.

#### Scenario: Local plugin is configured
- **WHEN** the repository is bootstrapped
- **THEN** `opencode.json` references `./.opencode/plugin/aperture-codex.ts`

#### Scenario: Bun test project exists
- **WHEN** the repository is bootstrapped
- **THEN** the project includes TypeScript configuration, package metadata, and a Bun test file for the plugin behavior

### Requirement: Codex Request Detection
The plugin SHALL treat requests with path `/v1/responses`, `/chat/completions`, or `/backend-api/codex/responses` as Codex-bound requests.

#### Scenario: Responses path is Codex-bound
- **WHEN** a request URL has path `/v1/responses`
- **THEN** the plugin classifies the request as Codex-bound

#### Scenario: Chat completions path is Codex-bound
- **WHEN** a request URL has path `/chat/completions`
- **THEN** the plugin classifies the request as Codex-bound

#### Scenario: Backend Codex responses path is Codex-bound
- **WHEN** a request URL has path `/backend-api/codex/responses`
- **THEN** the plugin classifies the request as Codex-bound

#### Scenario: Other paths are not Codex-bound
- **WHEN** a request URL has a path outside the configured Codex paths
- **THEN** the plugin does not classify the request as Codex-bound

### Requirement: Aperture Routing
The plugin SHALL rewrite Codex-bound request destinations to the URL in `OPENCODE_APERTURE_CODEX_ENDPOINT`.

#### Scenario: Codex request is routed to Aperture
- **WHEN** a Codex-bound request is handled and `OPENCODE_APERTURE_CODEX_ENDPOINT` is set
- **THEN** the resulting request destination is the configured Aperture endpoint

#### Scenario: Non-Codex request is unchanged
- **WHEN** a non-Codex request is handled
- **THEN** the request destination remains unchanged

#### Scenario: Missing endpoint fails clearly
- **WHEN** a Codex-bound request is handled and `OPENCODE_APERTURE_CODEX_ENDPOINT` is not set
- **THEN** the plugin fails with a clear configuration error
- **AND** the plugin does not silently send the request to the original destination

### Requirement: OpenCode Auth And Session Preservation
The plugin SHALL preserve OpenCode-owned auth and session headers when routing Codex requests.

#### Scenario: Authorization header is preserved
- **WHEN** a Codex-bound request includes an `Authorization` header
- **THEN** the routed request includes the same `Authorization` header value

#### Scenario: ChatGPT account header is preserved
- **WHEN** a Codex-bound request includes a `ChatGPT-Account-Id` header
- **THEN** the routed request includes the same `ChatGPT-Account-Id` header value

#### Scenario: Session and content headers are preserved
- **WHEN** a Codex-bound request includes `User-Agent`, `session-id`, `originator`, `Content-Type`, or `Accept` headers
- **THEN** the routed request includes the same header values

#### Scenario: Hook auth only fills missing headers
- **WHEN** OpenCode provides auth information through a plugin hook and a corresponding request header is missing
- **THEN** the plugin may set the missing request header from hook-provided auth
- **AND** the plugin does not replace existing OpenCode-generated auth headers

### Requirement: OAuth Boundary
The plugin SHALL NOT own, read, persist, mint, refresh, or inspect ChatGPT/OpenAI/OpenCode OAuth credentials outside the current hook-provided request context.

#### Scenario: Plugin does not implement OAuth
- **WHEN** the plugin handles a request
- **THEN** it does not mint, refresh, or exchange OAuth tokens

#### Scenario: Plugin does not read auth files
- **WHEN** the plugin needs auth information
- **THEN** it does not read OpenCode auth files directly

#### Scenario: Plugin does not persist identity data
- **WHEN** the plugin receives auth, token, or account information
- **THEN** it does not persist access tokens, refresh tokens, ID tokens, OAuth payloads, or account IDs

### Requirement: Redacted Debug Logging
The plugin SHALL provide optional debug logging controlled by `OPENCODE_APERTURE_CODEX_DEBUG=1`, and all debug output SHALL redact sensitive auth values.

#### Scenario: Debug logging is disabled by default
- **WHEN** `OPENCODE_APERTURE_CODEX_DEBUG` is unset or not `1`
- **THEN** the plugin does not emit debug logs

#### Scenario: Bearer token is redacted
- **WHEN** debug logging includes an `Authorization: Bearer ...` value
- **THEN** the emitted log contains `Bearer <redacted>`
- **AND** the emitted log does not contain the original bearer token

#### Scenario: OAuth payload fields are redacted
- **WHEN** debug logging includes fields named `access_token`, `refresh_token`, or `id_token`
- **THEN** the emitted log redacts those values

### Requirement: Test Safety
The test suite SHALL cover routing, header preservation, redaction, and missing endpoint behavior without containing real tokens.

#### Scenario: Required routing paths are tested
- **WHEN** the test suite runs
- **THEN** it verifies that `/v1/responses`, `/chat/completions`, and `/backend-api/codex/responses` route to the Aperture endpoint

#### Scenario: Non-Codex passthrough is tested
- **WHEN** the test suite runs
- **THEN** it verifies that non-Codex requests are not rewritten

#### Scenario: Header preservation is tested
- **WHEN** the test suite runs
- **THEN** it verifies preservation of `Authorization` and `ChatGPT-Account-Id`

#### Scenario: Real tokens are not present in fixtures
- **WHEN** test fixtures or test literals are inspected
- **THEN** they do not contain real access tokens, refresh tokens, ID tokens, or bearer tokens
