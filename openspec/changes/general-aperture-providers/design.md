# Design

## Current Interfaces

`src/index.ts` accepts a server-plugin tuple option `{ auth: { [remoteID]: { mode, apiKeyEnv?, protocol? } } }` and installs hooks only with `OPENCODE_APERTURE_ENABLE=1`. `src/aperture-providers.ts` plans catalog changes before applying them. Gateway and passthrough groups use `aperture-<encoded-remote-id>` with protocol suffixes for mixed groups; subscription retains native `openai` and `/codex` routing.

Missing or false `requires_client_auth` defaults to gateway mode. True with Responses retains legacy subscription selection; true without Responses needs an explicit supported auth selection. Missing flags do not prove server auth policy. Only one enabled nonempty subscription provider is allowed. Passthrough resolves only the explicitly named environment key and keeps its value in fetch closures, not serializable config. Native credentials from other IDs are never borrowed. Managed fetch strips upstream auth; Bedrock SigV4 passthrough is unsupported.

Adapters cover Responses, Chat, Messages, Converse, and Gemini, not arbitrary APIs. Unsupported protocols and unsafe or ambiguous path models are skipped with summaries; current server debug output reports their count. Unknown model limits use overridable estimates of 128000 context and 8192 output tokens.

SDK model IDs remain raw upstream IDs to preserve reasoning/capability semantics. Generated Responses, Chat, and Messages fetch closures qualify the outgoing JSON `model` as `<remote-provider-id>/<raw-model-id>` only after SDK transformations. Bedrock/Gemini remain path-based; native subscription/Codex routing is untouched. Extra remote metadata such as `description` is projected out before the strict private worker catalog protocol, with regression coverage.

## UX and Isolation

Refresh readiness includes `aperture-*` and native `openai` labeled `Aperture (...)`. New browser enrollment URLs are privately displayed and auto-opened on macOS/Linux; repeated URLs are not reopened and reusable authorized identity needs neither a URL nor a browser. Passing a URL to the OS opener's argv is an explicit privacy exception, not a no-process-visibility guarantee. Links remain outside plugin logs, chat, and settings.

The test launcher scopes enablement and HOME/XDG isolation to its child. Implemented `APERTURE_PASSTHROUGH_ENV` accepts an explicit comma-delimited list of existing environment variable names and forwards their values through the child environment, not argv. It rejects invalid/reserved names and unset or empty values. Runtime/isolation prefixes, including `APERTURE_*`, are reserved; examples use `PROVIDER_API_KEY`. Values must come from an existing secure environment mechanism, never inline examples. Termination signals are forwarded with a 10-second grace deadline to accommodate bridge cleanup of up to seven seconds.

## Evidence and Follow-Up

Authorized real-bridge discovery succeeded on 2026-09-29 for `anthropic`, `bedrock`, `bedrock-mantle-anthropic`, `bedrock-mantle-completions`, `bedrock-mantle-openai`, `neuralwatt`, `openai`, and `vercel`: 10 OpenCode groups, 42 model entries, zero unsupported entries, and `subscription: false`. Vercel supplied Messages, Chat, and Responses groups. No live inference was performed.

Before the latest fetch-boundary qualification change, reported installed synthetic passes were `--bridge-production-gateway` for four native protocols and capability/secret-free config checks, `--bridge-production` for five subscription scenarios, and `--bridge-production-refresh`. The latest installed gateway rerun is pending main-workstream verification. Launcher tests reported 22 passes before the subsequent 10-second grace adjustment. The TypeScript internal crash was resolved with an explicit environment `Record<string, string>` annotation and a fresh typecheck passed in the responsible workstream. The final full suite with SDK test environment is still running; no count or result is asserted.

## Evidence Limits

Gemini has SDK mock evidence only, not native OpenCode integration evidence. Catalog discovery does not establish inference grants or successful inference. Live inference is deferred and is not required for implementation completion. Real interactive TUI/browser verification remains separate. These evidence limits are not unfinished mandatory implementation tasks. Existing/archived specifications are intentionally untouched in this documentation pass.
