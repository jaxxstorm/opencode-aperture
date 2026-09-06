# aperture-routing-hardening Specification

## Purpose

Define validated Aperture gateway discovery and routing that preserve native OAuth ownership, user configuration, and credential safety without destructive setup failures.

## Requirements

### Requirement: Validated gateway origin

The plugin SHALL resolve the gateway from nonempty `APERTURE_HOST`, then nonempty `OPENCODE_APERTURE_HOST`, then `http://ai`. It SHALL accept HTTP or HTTPS origins with an optional trailing slash and SHALL reject malformed URLs, other schemes, userinfo, queries, fragments, and non-root paths before contacting the gateway.

#### Scenario: Host precedence
- **WHEN** both host environment variables contain valid values
- **THEN** discovery and inference configuration use `APERTURE_HOST`

#### Scenario: Invalid or secret-bearing URL
- **WHEN** the selected URL contains userinfo, query data, a non-root path, or another prohibited component
- **THEN** initialization reports a sanitized configuration failure without contacting that URL
- **AND** the diagnostic does not echo prohibited component values

### Requirement: Bounded subscription Responses discovery

Discovery SHALL complete or fail within a 10-second request timeout, SHALL reject redirects and unsuccessful HTTP responses, and SHALL validate the provider response shape. Selection SHALL require exactly one provider with client authentication enabled, Responses compatibility enabled, and a nonempty list of nonempty string model IDs. Duplicate model IDs SHALL be removed while preserving order.

#### Scenario: One eligible provider
- **WHEN** discovery returns exactly one eligible provider among valid noneligible providers
- **THEN** the plugin selects it and uses its ordered unique model IDs

#### Scenario: Unsupported or ambiguous providers
- **WHEN** discovery returns no eligible providers, only chat-compatible providers, or multiple eligible providers
- **THEN** the plugin reports a selection failure rather than choosing an arbitrary provider

#### Scenario: Invalid discovery response
- **WHEN** discovery returns invalid JSON, an invalid provider shape, a redirect, or an unsuccessful HTTP status
- **THEN** setup fails with a bounded sanitized diagnostic without logging the raw response

#### Scenario: Gateway does not respond
- **WHEN** the discovery request stalls
- **THEN** the request is aborted at the configured 10-second limit without automatic discovery retries

### Requirement: Preserve model selection and unrelated configuration

The plugin SHALL preserve explicit default-model selections, user model overrides, unrelated providers, and OpenAI options unrelated to required gateway routing. It SHALL limit OpenAI models to discovered IDs intersected with any existing whitelist. It SHALL select the first allowed discovered model only when no default model exists. Reapplying its configuration SHALL be idempotent.

#### Scenario: Explicit discovered OpenAI model
- **WHEN** the user selects `openai/gpt-6-astra` and it is discovered and allowed
- **THEN** the plugin retains that selection even if another model is listed first

#### Scenario: Unrelated default provider
- **WHEN** the user's default model belongs to another provider
- **THEN** the plugin leaves that default and the other provider's configuration unchanged

#### Scenario: User selection is unavailable
- **WHEN** an explicit OpenAI model is outside the allowed discovered set or the whitelist intersection is empty
- **THEN** the plugin reports a configuration error rather than silently substituting a model

#### Scenario: Default selection respects whitelist
- **WHEN** no default is configured and a whitelist permits only a subset of discovered models
- **THEN** the first discovered model in that permitted subset becomes the default

#### Scenario: Repeated config application
- **WHEN** equivalent setup is applied twice to a configuration with custom model metadata and unrelated options
- **THEN** the second application does not alter the result or discard those overrides

### Requirement: Native OAuth routing and scoped headers

On the documented supported OpenCode runtime with native subscription authentication, the plugin SHALL configure the trusted gateway's `/codex` base URL so Responses requests reach `/codex/responses`. It SHALL leave OAuth login, refresh, persistence, and auth-header injection to OpenCode. It SHALL NOT implement auth loaders, replace fetch, read auth files, or persist identity data. Any plugin marker SHALL apply only to OpenAI requests and SHALL preserve existing auth and session header values.

#### Scenario: Native OAuth request reaches gateway
- **WHEN** a supported OpenCode instance issues an OpenAI Responses request with synthetic OAuth credentials
- **THEN** the gateway receives `/codex/responses` with OpenCode's bearer, account, session, originator, user-agent, and applicable content headers intact

#### Scenario: Other provider request
- **WHEN** a request belongs to a non-OpenAI provider
- **THEN** the plugin leaves its destination and request headers unchanged and does not add its marker

### Requirement: Non-destructive setup failures

The plugin SHALL route OpenAI requests through a trusted gateway only when its setup completes successfully. When host validation, discovery, selection, or configuration fails, the plugin SHALL leave the user's configuration unchanged, SHALL NOT disable providers, SHALL NOT block or throw during request handling, and SHALL report only a sanitized setup diagnostic. Unrelated providers SHALL remain usable. Documentation SHALL identify plugin load failures, conflicting plugins, and untested upstream versions as outside the plugin's support scope.

#### Scenario: Discovery fails during startup
- **WHEN** a configured OpenAI session starts while discovery is unavailable or malformed
- **THEN** the plugin logs a sanitized setup diagnostic and leaves native OpenAI routing unchanged
- **AND** no plugin crash, disabled provider, or request-blocking error is introduced

#### Scenario: Gateway returns a request error
- **WHEN** the selected gateway responds with 401, 403, 429, or 5xx
- **THEN** OpenCode surfaces the failure using its native error/retry behavior
- **AND** the plugin neither repairs credentials nor adds request-time interception

### Requirement: Credential-safe optional diagnostics

Debug diagnostics SHALL be enabled only by `OPENCODE_APERTURE_DEBUG=1`. Plugin logs and errors SHALL exclude authorization values, account identifiers, OAuth payloads, request bodies, and raw invalid URLs or discovery response bodies. Logging SHALL work with the supported public hook shape.

#### Scenario: Debug mode is disabled
- **WHEN** the debug variable is absent or differs from `1`
- **THEN** no plugin debug messages are emitted

#### Scenario: Debug mode with sensitive fixtures
- **WHEN** discovery and chat hooks execute with debug enabled and synthetic secrets in headers or malformed responses
- **THEN** the hooks do not crash and emitted diagnostics contain none of the synthetic secret values
