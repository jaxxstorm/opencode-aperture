# Opt-In Live Validation

Reference procedure, not onboarding: start with [How to Use](how-to-use.md) and [configuration](configuration.md). The current npm release is **`@jaxxstorm/opencode-aperture@0.1.4` (published)**; dated evidence below is historical, not a live-validation claim for that release.

Live testing is optional, sends real subscription credentials to the gateway, and never belongs in automatic CI. The existing September 5, 2026 text evidence for `gpt-5.6-luna` and `gpt-6-astra` is recorded in [compatibility](compatibility.md); it does not verify tools, gateway-log correlation, or refresh.

## Authorization Gate

Before any live request, obtain explicit confirmation of the exact gateway origin, its trusted operator, protected transport, the account owner's authorization, and the intended text/tool/refresh scope. A useful confirmation is: "I authorize native OpenCode subscription requests to this confirmed trusted origin for these tests, and understand the gateway receives bearer credentials and prompt content." Do not infer authorization from a configured host or existing login. Without confirmation, stop and use synthetic tests only.

Use HTTPS or an explicitly trusted independently protected network. Confirm the selected origin after applying `APERTURE_HOST`, then `OPENCODE_APERTURE_HOST`, then `http://ai` precedence; do not accidentally send credentials to the default. Agree on safe gateway telemetry with the operator before testing: timestamps, sanitized correlation IDs, destination path, and status, not authorization/account/session header dumps or request bodies.

## Preparation

1. Record the candidate artifact/checksum, exact OpenCode/Bun versions and platform. Use stock OpenCode 1.18.29 and external Bun 1.4.2; the host's embedded Bun 1.3.14 is separate. Existing live evidence is darwin only.
2. Use exactly one plugin installation, without conflicting auth/fetch/config plugins. Explicitly keep experimental WebSockets disabled. Do not use a residency-sensitive account.
3. Set the confirmed gateway origin and restart OpenCode. Use `opencode auth login` with OpenAI's native subscription/browser flow if login is needed. Do not use an API key or a plugin-owned login.
4. Never read, copy, inspect, export, or edit auth files. Do not expose tokens, account identifiers, OAuth payloads, or raw logs. Do not change credential timestamps or force expiration.
5. Deny tools for the text phase. Use a harmless prompt without private repository or personal data. Confirm the desired `openai/<model-id>` is discovered and allowed; do not silently substitute another model.

## Text and Tools

1. Ask the selected model to return a distinctive harmless text marker. Record final text and normal session completion, not merely HTTP receipt or CLI exit status.
2. Have the gateway operator correlate that session with a sanitized request record for `/codex/responses` and a successful streamed response. Record timing/correlation and model, never credentials. If gateway telemetry is unavailable, label gateway correlation unverified even if text succeeds.
3. With separate tool-test authorization, allow only a reviewed deterministic fixture tool that returns a fixed harmless string and has no file, network, shell, or credential access. Deny every other tool. If no such fixture is available, skip and mark tools unverified.
4. Ask for that tool, verify its call/result correlation, and confirm that the matching result reaches the gateway in a subsequent `/codex/responses` request and that the final answer completes. Redact identifiers as needed; never substitute a general-purpose shell tool for convenience.

## Natural-Expiry Refresh

1. Obtain authorization for a longer-running session and its cost/duration. Establish a gateway-correlated successful native request as a baseline.
2. Let credentials expire naturally during ordinary native OpenCode use. Schedule subsequent harmless requests within the authorized window, without inspecting auth storage to determine expiry or manipulating tokens. A guessed elapsed duration alone is not refresh evidence.
3. Observe a sanitized native refresh event or other non-secret evidence that identifies native refresh, followed by gateway-correlated successful inference. Do not enable indiscriminate credential-bearing trace logs to obtain evidence. Gateway success alone does not prove a refresh occurred.
4. If persistence is in scope, restart OpenCode normally and verify subsequent gateway-bound success without logging in again. Record this separately; restart success alone does not prove refreshed-token persistence without the preceding refresh evidence.
5. If refresh cannot be safely observed, the test window ends before observed expiry, or gateway correlation is unavailable, record refresh as **unverified**. Do not force expiry or inspect credentials to fill the gap.

Stop on unexpected routing, auth behavior, or sensitive logging. Check OpenCode logs and restart after correcting setup. The host may ignore plugin errors and retain native routing; the plugin is not a destination enforcement mechanism.

## Result Record

Record authorization scope (without personal identifiers), date, exact runtime/platform, artifact/checksum, protected-transport assumption, model, and separate pass/fail/unverified outcomes for text, gateway correlation, tools, cancellation, concurrency, native refresh, and persistence. Link only sanitized evidence. Do not mark cancellation or concurrency verified from a sequential text/tool run. WebSockets and residency-sensitive accounts remain unsupported regardless of these results.
