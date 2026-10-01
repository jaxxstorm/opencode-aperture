# Verification Scripts

## Local Interactive Launcher

Run the already-prepared isolated local profile from this checkout:

```sh
sh scripts/launch.sh
```

The launcher uses POSIX `sh` on macOS/Linux; zsh is not required. It still needs
Bun, OpenCode, and a prepared isolated profile. Native Windows is not supported.

Debug output is off by default. For troubleshooting only, run
`OPENCODE_APERTURE_DEBUG=1 sh scripts/launch.sh`. Debug lines are written to
stderr and may overlap the TUI; restart without that flag for a quiet session.

This wrapper loads the built plugin registrations from the test project and
isolates HOME, OpenCode configuration, credentials, cache, and node state. It
reads the gateway from that profile's nonsecret settings and strips inherited
auth keys unless explicitly allowlisted by name. The release activates through
server/TUI registration without an `OPENCODE_APERTURE_ENABLE` requirement; an old
launcher flag is not a release prerequisite or a disable switch. Do not add global
or workspace plugin registrations for verification.
Use `/aperture-login` to enroll with the prepared settings, or
`/aperture-setup` to edit them. Browser enrollment displays a private URL and
attempts to open it on macOS/Linux only when a new URL arrives. Reused authorized
identity produces no URL or browser launch. If opening fails, open the displayed
URL manually and keep the dialog open; Enter on **Keep waiting** does not cancel.
The OS opener receives the URL as an argv argument without a shell. This explicit
exception is not an absolute privacy guarantee against process inspection or
browser history; the plugin does not put enrollment links in logs, chat, or settings.
Escape or **Cancel enrollment** stops the attempt with nonsecret feedback.
Successful enrollment closes and cleans up the enrollment worker, saves settings,
then automatically refreshes models on an idle local instance. Busy or failed
refresh leaves enrollment and settings saved; finish active work and use
`/aperture-models`, or quit and relaunch as a fallback. If this profile is already
running older code, relaunch once after installing the new build, then use
`/aperture-models` without re-enrolling. The manual command confirms the local
server and opens the native picker only after readiness for all `aperture-*`
providers and native `openai` with an `Aperture (...)` label. Avoid starting work from
any client during refresh: status checking and directory-scoped disposal are not
atomic. Cancelling stops waiting, not a server reload already accepted. Native
history is not deleted. Remote TUI attachment is unsupported, and disconnect
still requires restart; `/aperture-status` shows saved settings, not live status.
Native OpenAI login is not required for model visibility or gateway-managed/API-key
inference; it remains separate for subscription inference and is also isolated:

```sh
sh scripts/launch.sh auth login
```

The launcher does not create the profile, enroll a device, or alter normal user
configuration. The prepared profile defaults to
`${TMPDIR:-/tmp}/opencode/aperture-local-test`; its sensitive data stays outside
the repository. `APERTURE_LOCAL_PROFILE` overrides that absolute directory;
`APERTURE_TEST_TMPDIR` overrides the short temporary/socket parent. `BUN_BIN`
and `OPENCODE_BIN` can select explicit executable paths instead of PATH lookup.
`APERTURE_TEST_GATEWAY` optionally overrides the saved HTTPS gateway. The current
verified setup uses external Bun 1.4.2 and OpenCode 1.18.29. Temporary profiles
are not durable production storage and may be removed by OS cleanup.

### Provider Auth and Environment Forwarding

Configure per-remote-provider auth using the server-plugin tuple described in the
[main README](../README.md#per-provider-authentication), not TUI options. Missing
or false `requires_client_auth` defaults to gateway-managed auth; this does not
prove the server needs no key. Explicit passthrough uses only `apiKeyEnv`, never
native credentials belonging to other IDs. Catalog visibility is not proof of
grants or successful inference. Subscription remains native OpenAI/Codex.

The launcher implements `APERTURE_PASSTHROUGH_ENV`, an explicit comma-delimited
list of environment variable names whose values already exist in your securely
populated environment. The helper builds an isolated child environment and passes
selected values through that environment, not process arguments:

```sh
APERTURE_PASSTHROUGH_ENV=PROVIDER_API_KEY,SECOND_PROVIDER_KEY sh scripts/launch.sh
```

Those are names only, not key assignments. Never put key values inline in commands,
configuration, prompts, or documentation. The names must match the tuple's
`apiKeyEnv` references. Invalid/reserved names and unset or empty values are
rejected without printing values. Reserved names include isolation/runtime controls
such as `HOME`, `PATH`, and prefixes including `APERTURE_*`, `OPENCODE_*`, `BUN_*`,
`NODE_*`, `XDG_*`, and `TS_*`; this is not a general-purpose environment override.
Keep the allowlist explicit rather than inheriting all auth or copying native
auth files. Environment changes require restarting the profile.

The launcher forwards termination signals and allows 10 seconds before forced
termination, accommodating bridge cleanup of up to seven seconds. All 22 launcher
tests pass, including explicit environment forwarding and shutdown behavior.

See [developer verification](../docs/verification.md) for prerequisites, commands,
synthetic HOME/XDG isolation, and the distinction between passed and pending checks.
The harness uses stock OpenCode 1.18.29 (embedded Bun 1.3.14) with ordinary POSIX
process spawning; run build/test and the worker with external Bun 1.4.2. On macOS,
credential-bearing routing probes use a localhost-only `sandbox-exec` policy.
The older direct probe and cleanup verifier allow Linux, without equivalent egress
enforcement. All production bridge modes explicitly reject non-macOS platforms.
They also require OpenSSL with `req -addext` support; workflows select OpenSSL 3.
Public dependency preparation occurs before the sandbox. The cleanup verifier
remains part of verification.

Set `APERTURE_TEST_TARBALL` to an absolute candidate tarball path for
`bun run test:package`, `bun run test:routing`,
`bun scripts/verify-probe-cleanup.ts`, and every production probe below to
inspect/install the same artifact without repacking. Unset it to restore ordinary
pack-from-checkout checks. The release job packs once on mandatory macOS and runs
gateway, subscription, and refresh probes against that exact candidate before
retaining and publishing unchanged bytes. Baseline production steps run only on
macOS; the Linux canary covers direct routing, not production bridge modes. See the
[release procedure](../docs/release.md) for checksum, approval, and recovery steps;
these verification scripts do not publish.

The published optional bridge is `@jaxxstorm/bun-tailscale-bridge@0.1.0` (Bun
engine `1.4.2`). The release contract installs it by default through the exact
optional-dependency pin; direct routing can omit it. Normal registered-package
setup leaves `modulePath` blank for resolution by the worker within the installed
package. Clean-consumer checks pass with the published bridge installed and omitted,
including registration without an enable flag and default worker package resolution.
CI production fixtures do not enroll a real
device. SDK-dependent unit probes need `APERTURE_SDK_TEST_DIR`, which these
workflows do not set; do not equate CI unit coverage with historical SDK-enabled runs.

## Installed Production Probe

The installed general-provider check is:

```sh
bun scripts/probe-routing.ts --bridge-production-gateway
```

The final build passed four native
protocols: OpenAI Responses, Chat Completions, Anthropic
Messages, and Bedrock Converse, with capability-protected routing and secret-free
native configuration checks. Gemini has passing SDK mock coverage only, not a
native OpenCode pass. Vertex-only,
invoke-only, and ambiguous path-model entries are unsupported, not arbitrary-API
support. None of these synthetic results proves live inference or gateway grants.

The latest implementation retains raw SDK model IDs for reasoning/capability
semantics and qualifies only outgoing Responses/Chat/Messages JSON `model` values
at the fetch boundary as `<remote-provider-id>/<raw-model-id>`. Native subscription
Codex routing is untouched. Extra gateway metadata such as `description` is
projected out of the strict private worker catalog payload, with regression coverage.

Authorized live catalog discovery through the real bridge succeeded on
**2026-09-29**: `anthropic`, `bedrock`, `bedrock-mantle-anthropic`,
`bedrock-mantle-completions`, `bedrock-mantle-openai`, `neuralwatt`, `openai`,
and `vercel` produced **10 OpenCode groups, 42 model entries, zero unsupported
entries, and `subscription: false`**. Vercel split into Messages, Chat, and Responses.
No live inference was performed. Live inference is deferred, not a mandatory
implementation task; native Gemini remains an evidence limitation, not a claimed pass.

After building, run `bun scripts/probe-routing.ts --bridge-production` to exercise
the installed index, parent guard and worker with only a fake bridge module.
Final result: all five native HTTPS scenarios passed on darwin-arm64, OpenCode
1.18.29 / embedded Bun 1.3.14, external Bun 1.4.2. There is exactly one proxied
discovery before atomic activation. The fake module uses the real HTTP proxy
fixture; test-only worker fetch instrumentation asserts the worker-supplied proxy
and fixed upstream before adding a per-request fixture CA. This wraps worker-global
fetch only inside the fake module, not parent/native auth fetch or production
source. This is not real enrollment.

The macOS sandbox allows localhost TCP plus only the specific private `apb.../s`
Unix endpoints required for the production `node:http` path, with no external
network access. Fixture state uses its own `0700` parent. Retain these narrow
exceptions rather than allowing arbitrary Unix sockets or external networking.
Production runtime sharing is module-scoped/reference-counted across projects;
capabilities remain per-instance on one parent-lifetime TCP port. Worker loss
returns `503`; disposal revokes the old capability with `403` without releasing
that port. Private worker Unix endpoints protect against other-UID replacement.

For optional-feature error verification after building, run:

```sh
bun scripts/probe-routing.ts --bridge-production-errors
```

The installed production error probe passed native retry after 429 (two gateway
requests), 307 redirect containment (one gateway request, zero sink requests), and
untrusted fixture-CA rejection (zero inference gateway requests). Negative prompts
were still pending after 500 ms and parent-aborted; this does not prove completed
negative-error UX. Each cleanup reported TCP-refused listeners, removed storage
and stopped children.

Historical post-continuous-lease/shared-pool verification: 200 tests passed, zero failed,
922 expectations in 12 files; typecheck/build and all-three-bundle clean-consumer
checks passed. Default native routing passed all five scenarios, cleanup verification
passed both failure/interruption scenarios, and embedded Bun 1.3.14 ingress units
passed eight tests with 79 expectations. Full backpressure stress, actual cross-UID
attacks, exhaustive secrecy/raw-wire variations and real interactive UI remain
explicitly deferred. See the active change's `evidence.md`.

Final general-provider verification: 350 tests passed with pinned SDK probes enabled,
2,221 expectations across 17 files. Fresh typecheck, build, package and strict
OpenSpec checks passed. Final installed passes are
`--bridge-production-gateway` (four native protocols), `--bridge-production`
(five subscription scenarios), and `--bridge-production-refresh` (catalog rebuild).

## Installed Model Refresh Probe

After building, run:

```sh
bun scripts/probe-routing.ts --bridge-production-refresh
```

The final installed production probe passed on OpenCode 1.18.29 / embedded Bun 1.3.14,
external Bun 1.4.2, darwin-arm64, using a fake bridge and isolated loopback fixtures.
Without native auth or preseeded models, the first catalog contained one model
and the rebuilt catalog contained two after directory-scoped `instance.dispose`.
The global SSE stream delivered the matching instance-disposal event; no global
disposal was used. Three discoveries and one shared-worker start were observed
while a second project retained its lease. No real gateway, auth files, or user
state were accessed. This proves native SDK catalog rebuild, not actual interactive
picker behavior or live enrollment. Mocked TUI tests cover readiness and commands.

The reported pre-final-recheck unit baseline is 273 passing tests, 1,322 expectations
in 13 files. Final main-workstream validation is still pending. See
[`refresh-aperture-models/evidence.md`](../openspec/changes/refresh-aperture-models/evidence.md)
for coverage, commands, and probe setup/cleanup corrections. If an existing
`APERTURE_PUBLIC_CACHE` lacks package metadata, unset it to let the probe prepare
its isolated public dependency cache.

## Historical Relay Proofs

These are synthetic, test-only fixtures, not shipped bridge functionality. Build
the package first. Native relay modes currently require macOS; HTTPS probes also
require OpenSSL with `req -addext` support. Certificates and keys are generated
only in disposable test storage. No real Tailscale enrollment occurs.

```sh
bun scripts/probe-routing.ts --relay
bun scripts/probe-routing.ts --relay-proxy-http
bun scripts/probe-routing.ts --relay-proxy-https
bun scripts/probe-routing.ts --relay-worker-https
bun scripts/probe-routing.ts --relay-worker-embedded --expect-worker-rejection
bun scripts/probe-connect.ts
env BUN_BE_BUN=1 opencode scripts/probe-connect.ts
```

`--relay-proxy-http` exercises native OAuth inference through an authenticated
reverse relay and forward proxy. The proxy modes also run independent proxied
discovery; the packaged plugin's original discovery is still direct to a loopback
fixture. `--relay-proxy-https` adds TLS/CONNECT using a per-request fixture CA,
without changing global trust or disabling certificate verification.

`probe-connect.ts` compares direct HTTPS and CONNECT discovery, fixed and streamed
uploads, TLS rejection, redirects, and SSE reader cancellation in the runtime
that executes it. It is not a native OpenCode integration test. The commands
deliberately fail when a compatibility check fails; they are not all expected to
pass on every runtime. Bun 1.4.2 passes this differential probe; OpenCode 1.18.29's
embedded Bun 1.3.14 fails streamed CONNECT uploads and reader-cancellation checks.
The in-host `--relay-proxy-https` probe consequently remains blocked on that
embedded runtime. The separate external-worker HTTPS proof passes all five native
scenarios on that host with worker Bun 1.4.2; this is not an embedded HTTPS pass.

`--relay-worker-https` selects external mode and supplies the harness Bun's absolute
`process.execPath`. `--relay-worker-embedded` instead uses the native host's
`process.execPath` with child-only `BUN_BE_BUN=1`. Both copy and run the same
synthetic worker/core/plugin and reusable internal `src/transport-process.ts`
supervisor. These historical modes use copied fixtures, not the shipped bridge
worker; their flags are harness-only, not a consumer worker API. Production now
uses its own wired bridge client/worker. These commands prove fixtures, not real
Tailscale or UX.

The supervisor accepts absolute executable paths only, with no PATH lookup or
silent fallback. `VERIFIED_TRANSPORT_BUN_VERSIONS` currently allows exactly
`1.4.2`; extend it only after exact-version differential and native checks, never
because a version is newer. No future external or embedded positive is verified.
The embedded rejection command passes on 1.3.14 before startup data is sent:
no worker route/capability activates and no external fallback occurs. It preserves
the original packaged gateway route and attempts no inference. This is
non-destructive startup rejection, **not fail-closed routing**.

Children run with `--no-env-file --config=/dev/null`, worker-directory cwd, and
only inherited `PATH` plus `BUN_BE_BUN` in embedded mode, preventing project
dotenv/preloads. Private bounded JSON stdio carries `hello -> start -> ready`;
the worker generates the random capability and returns it privately in `ready`.
Startup carries a synthetic certificate/key for streamed HTTPS CONNECT and
reader-cancellation smoke before proxied discovery and readiness. OpenSSL is a
fixture certificate-generation prerequisite, not an asserted production dependency.
Control lines are limited to 64 KiB, supervisor stdout/stderr to 512 KiB each;
events are allowlisted. `close` is acknowledged by process exit, with no `closed`
frame and bounded termination escalation.

Real-worker tests cover authenticated Host/Origin rejection, streamed delivery,
decoded gzip response headers, stdin EOF, and upstream loss returning 502 then
retaining a bound 503 relay with zero requests to a recovered gateway. Worker
death in this historical synthetic worker invalidates liveness/capability access
but releases its port: that proof did not resolve cached native retries. The
production parent-owned guard above retains its port instead. Production retry and
TLS/redirect results are recorded above, separately from these historical fixtures.
Native OAuth refresh, bounded-memory/backpressure stress, real interactive UX, and the
remaining production security matrix are deferred; mocked TUI/state and production
worker/guard unit coverage is separate.

Use `APERTURE_PUBLIC_CACHE` for the existing preinstalled public plugin dependency
cache and `APERTURE_TEST_TMPDIR` for an approved temporary parent directory.
Results and detailed limits are recorded in the active change's `evidence.md`.
