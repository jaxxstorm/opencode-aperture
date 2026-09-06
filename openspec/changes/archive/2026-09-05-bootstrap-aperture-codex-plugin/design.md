## Context

OpenCode owns ChatGPT Plus/Pro OAuth, including token refresh, account selection, and injection of auth-related request headers. Aperture should receive already-authenticated Codex requests and forward them as a passthrough transport.

The plugin therefore sits at the transport boundary. It must identify Codex-bound requests, rewrite only their destination URL to a configured Aperture endpoint, and preserve the headers OpenCode already produced. It must not read local auth files, mint or refresh tokens, persist identity data, or reinterpret ChatGPT subscription auth as an API-key provider.

The initial repository is a Bun/TypeScript plugin project with pure functions for matching, rewriting, header preservation, and redaction so behavior is straightforward to test without depending on a live OpenCode runtime.

## Goals / Non-Goals

**Goals:**

- Bootstrap a minimal Bun/TypeScript OpenCode plugin project.
- Load the local plugin through `opencode.json` from `./.opencode/plugin/aperture-codex.ts`.
- Detect Codex-bound request paths: `/v1/responses`, `/chat/completions`, and `/backend-api/codex/responses`.
- Rewrite Codex-bound requests to `OPENCODE_APERTURE_CODEX_ENDPOINT`.
- Preserve OpenCode-owned auth and session headers.
- Use hook-provided auth only to set missing headers when OpenCode provides it.
- Fail clearly for Codex requests when the Aperture endpoint is not configured.
- Provide optional debug logging with sensitive values redacted.
- Cover observable behavior with Bun tests.

**Non-Goals:**

- Implementing ChatGPT, OpenAI, or OpenCode OAuth.
- Reading OpenCode auth files directly.
- Persisting access tokens, refresh tokens, ID tokens, account IDs, or OAuth payloads.
- Logging bearer tokens or OAuth payloads.
- Replacing OpenCode's native OpenAI or ChatGPT auth flow.
- Providing an OpenAI API-key provider backed by ChatGPT subscription auth.
- Implementing Aperture itself or validating Aperture health.

## Decisions

1. Keep the plugin transport-focused.

   The plugin rewrites Codex-bound destinations and leaves identity ownership to OpenCode. This avoids duplicating OAuth logic and keeps the security boundary clear.

   Alternative considered: implement OAuth/token handling in the plugin. Rejected because it violates the project boundary and creates unnecessary token storage and refresh risk.

2. Match Codex requests by URL pathname.

   The configured Codex paths are stable observable routing inputs and can be tested without inspecting request bodies or auth state.

   Alternative considered: infer Codex requests from model names or request payloads. Rejected because payload inspection is broader than needed and increases the risk of logging or handling sensitive data.

3. Require an explicit Aperture endpoint for Codex rewrites.

   If `OPENCODE_APERTURE_CODEX_ENDPOINT` is missing and a Codex request is detected, the plugin fails instead of silently allowing direct ChatGPT traffic. This makes routing failures visible.

   Alternative considered: fall back to the original destination. Rejected because the user explicitly requested Aperture routing and silent fallback would hide misconfiguration.

4. Preserve headers by default and only fill missing hook-provided auth headers.

   Existing OpenCode-generated headers are the source of truth. Hook-provided auth may be used only to populate missing request headers, and only within the current request handling path.

   Alternative considered: normalize or replace all auth headers from hook auth. Rejected because OpenCode owns auth and may include account/session context that should not be overwritten.

5. Redact debug output at the header/value boundary.

   Debug logging emits sanitized request-routing information only when `OPENCODE_APERTURE_CODEX_DEBUG=1`. Sensitive values such as `Authorization`, `access_token`, `refresh_token`, and `id_token` are redacted before logging.

   Alternative considered: disable debug logging entirely. Rejected because routing diagnostics are useful if they are safe by construction.

## Risks / Trade-offs

- OpenCode plugin hook shape may differ from the initial assumptions -> Keep plugin helpers pure and export them for tests; adapt only the thin hook adapter if runtime integration needs adjustment.
- Header casing can vary across runtimes -> Treat header operations case-insensitively while preserving values.
- Debug logging can accidentally expose secrets if redaction is incomplete -> Centralize redaction and test bearer-token redaction explicitly.
- Path-only matching may miss future Codex endpoints -> Keep the path list explicit and spec-governed before expanding scope.
- Failing on missing endpoint can interrupt Codex requests -> This is intentional to avoid silent direct traffic when Aperture routing is requested.

## Migration Plan

This is a new plugin bootstrap with no existing runtime state or persisted data to migrate.

Implementation steps:

- Add the Bun/TypeScript project scaffold.
- Add `opencode.json` pointing at the local plugin entrypoint.
- Implement pure helpers for Codex path matching, URL rewriting, header preservation/filling, and redaction.
- Wire helpers into the exported plugin hook shape.
- Add Bun tests for routing, preservation, redaction, and failure behavior.

Rollback is deleting or disabling the plugin entry in `opencode.json`; no token or persisted data cleanup is required because the plugin must not persist auth material.

## Open Questions

### Current OpenCode OAuth Routing Gap

**September 5, 2026 update:** The synthetic integration probe in
`scripts/probe-routing.ts` verified a transport-only workaround on stock OpenCode
v1.18.29. The native OAuth fetch attaches bearer/account headers before applying
its path-based rewrite. A `/codex` base URL generates `/codex/responses`, which
does not match its `/v1/responses` or `/chat/completions` rewrite conditions.
The request therefore reaches the configured gateway without replacing the auth
loader. This qualifies the earlier blocker assessment below: general native
baseURL support is still missing, but our non-v1 path works in the tested runtime.
A subsequent authorized live run against `http://ai` returned `APERTURE_LIVE_OK`
from `openai/gpt-5.6-luna` using this configuration. Token refresh, tool calls,
WebSockets, and residency handling remain unverified. See `scripts/README.md`
for scope and reproduction.

As of OpenCode v1.18.10, ChatGPT Plus/Pro Codex OAuth requests are sent to the
hard-coded `https://chatgpt.com/backend-api/codex/responses` endpoint. They do
not honor `provider.openai.options.baseURL`. This means configuring the OpenAI
provider with an Aperture base URL is sufficient for API-key traffic but does
not route ChatGPT subscription traffic through Aperture.

OpenCode PR #31929 proposed deriving the Codex endpoint from `baseURL`, but it
was closed without merge. Its linked issue, #31926, remains open. Native
OpenCode support is therefore still missing.

### Available Plugin Workaround And Its Boundary

An external plugin can register an OpenAI auth loader that returns a custom
`fetch` implementation. That fetch can receive OpenCode's OAuth record, attach
the bearer and account headers, preserve the original method/body/headers/
abort signal, and relay Responses requests through Aperture.

However, the external fetch replaces rather than composes with OpenCode's
built-in Codex OAuth fetch. The built-in fetch currently owns token refresh,
refreshed-token persistence, and auth-header injection. A custom transport
fetch therefore cannot remain transport-only if it must work beyond the
current access-token lifetime: it would need to duplicate the refresh and
persistence behavior, or OpenCode would need to expose a composable built-in
OAuth transport hook.

The following upstream capabilities are missing for a low-risk implementation:

- Native support for routing ChatGPT OAuth/Codex traffic through
  `provider.openai.options.baseURL`.
- A public, stable request URL rewrite hook that runs after OpenCode's OAuth
  refresh and header injection.
- A composable built-in Codex fetch, rather than last-wins replacement by an
  external auth loader.

Until one of these is available, a custom-fetch workaround is viable only if
this plugin explicitly accepts responsibility for OAuth refresh behavior while
never logging credentials or persisting data outside OpenCode's auth store.

### Remaining Design Questions

- Can the plugin boundary expand from transport-only routing to refreshing
  OpenCode-provided OAuth credentials solely to sustain Aperture transport?
- If so, which OpenCode auth persistence API is stable enough to use without
  relying on private built-in Codex helpers?
- Whether Aperture expects all Codex paths to target the same configured
  endpoint or eventually separate endpoints is intentionally out of scope for
  this bootstrap.
