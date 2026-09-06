## 1. Project Scaffold

- [x] 1.1 Create `package.json` for a private Bun/TypeScript plugin project with test and typecheck scripts.
- [x] 1.2 Create `tsconfig.json` for strict TypeScript targeting Bun-compatible execution.
- [x] 1.3 Create `opencode.json` that loads `./.opencode/plugin/aperture-codex.ts`.
- [x] 1.4 Create `.opencode/plugin/aperture-codex.ts` and `test/aperture-codex.test.ts`.

## 2. Routing Implementation

- [x] 2.1 Implement a pure helper that classifies `/v1/responses`, `/chat/completions`, and `/backend-api/codex/responses` as Codex-bound paths.
- [x] 2.2 Implement URL rewriting so Codex-bound requests use `OPENCODE_APERTURE_CODEX_ENDPOINT`.
- [x] 2.3 Ensure non-Codex requests keep their original destination unchanged.
- [x] 2.4 Fail with a clear error when a Codex-bound request is handled without `OPENCODE_APERTURE_CODEX_ENDPOINT`.

## 3. Auth And Header Handling

- [x] 3.1 Preserve existing OpenCode-generated `Authorization` and `ChatGPT-Account-Id` headers during routing.
- [x] 3.2 Preserve `User-Agent`, `session-id`, `originator`, `Content-Type`, and `Accept` headers during routing.
- [x] 3.3 Use hook-provided auth information only to set missing request headers without replacing existing headers.
- [x] 3.4 Confirm the plugin does not read auth files, persist identity data, mint tokens, refresh tokens, or implement OAuth.

## 4. Debug Logging And Redaction

- [x] 4.1 Add debug logging controlled only by `OPENCODE_APERTURE_CODEX_DEBUG=1`.
- [x] 4.2 Implement centralized redaction for `Authorization`, `access_token`, `refresh_token`, and `id_token` values.
- [x] 4.3 Ensure `Authorization: Bearer ...` debug output appears as `Bearer <redacted>` and never includes the real token.

## 5. Tests And Verification

- [x] 5.1 Test that `/v1/responses` requests route to the Aperture endpoint.
- [x] 5.2 Test that `/chat/completions` requests route to the Aperture endpoint.
- [x] 5.3 Test that `/backend-api/codex/responses` requests route to the Aperture endpoint.
- [x] 5.4 Test that non-Codex requests are not rewritten.
- [x] 5.5 Test that `Authorization` is preserved.
- [x] 5.6 Test that `ChatGPT-Account-Id` is preserved.
- [x] 5.7 Test that debug logging redacts bearer tokens.
- [x] 5.8 Test that missing `OPENCODE_APERTURE_CODEX_ENDPOINT` fails clearly for Codex requests.
- [x] 5.9 Verify no test fixture or test literal contains a real token.
- [x] 5.10 Run the full test suite and typecheck, then fix any failures.
