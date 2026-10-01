# Script Index

Start with [Build from source](../docs/build.md) and
[Run locally](../docs/run-locally.md). The latter creates a fresh isolated profile;
the launcher below does not create one. Run scripts from the checkout root.

| Script / Command | Purpose |
| --- | --- |
| `launch.sh` | Launch an already-prepared isolated interactive profile |
| `launch-env.ts` | Internal environment and signal-handling helper for `launch.sh` |
| `bun run test:package` | Inspect and install the tarball in clean consumers |
| `bun run test:routing` | Run installed native routing probes |
| `bun scripts/verify-probe-cleanup.ts` | Check cleanup after failure and interruption |
| `bun scripts/probe-connect.ts` | Runtime HTTPS/CONNECT differential probe, not native integration |
| `bun run release -- <version> --dry-run` | Preview release preparation; see release procedure before use |
| `release.ts`, `integration-support.ts` | Shared release and verification utilities |
| `fixtures/` | Synthetic test servers, relay plugins, and workers; not shipped runtime code |

## Launcher Controls

`sh scripts/launch.sh` requires absolute Bun/OpenCode executable paths and existing
`project/opencode.json`, `project/tui.json`, and
`config/opencode-aperture/settings.json` within the profile. It reads only that
profile's nonsecret gateway setting, not normal user settings or auth.

- `APERTURE_LOCAL_PROFILE`: absolute prepared profile; default `${TMPDIR:-/tmp}/opencode/aperture-local-test`.
- `APERTURE_TEST_TMPDIR`: existing short temporary/socket parent; default `${TMPDIR:-/tmp}/opencode`.
- `BUN_BIN`, `OPENCODE_BIN`: absolute executables; otherwise resolved from `PATH`.
- `APERTURE_TEST_GATEWAY`: optional trusted HTTPS gateway override.
- `OPENCODE_APERTURE_DEBUG=1`: opt-in stderr diagnostics, which may overlap the TUI.
- `APERTURE_PASSTHROUGH_ENV`: comma-separated names of already-set nonempty provider-key variables, never inline secret values. Reserved isolation/runtime names are rejected.

The helper isolates HOME/XDG storage and strips inherited credentials. It forces
npm offline mode, disables model fetching, and needs prepared public dependencies
and provider caches. It is not a network sandbox. See the fresh-profile guide for
an online-capable isolated alternative and explicit plugin dependency preparation.
Arguments are forwarded, for example `sh scripts/launch.sh auth login`; any native
login stays in this profile. Termination is forwarded with a ten-second cleanup window.

## Further Reading

- [How to Use](../docs/how-to-use.md) and [configuration](../docs/configuration.md): normal installation, setup, and settings.
- [Troubleshooting](../docs/troubleshooting.md): setup and runtime failures.
- [Developer verification](../docs/verification.md): prerequisites, package/routing/cleanup checks, and evidence boundaries.
- [Compatibility](../docs/compatibility.md): pinned runtimes and transport limitations.
- [Live validation](../docs/live-validation.md): authorized real-gateway checks, separate from synthetic probes.
- [Release procedure](../docs/release.md): candidate tarballs, approval, and publication.

Production routing modes are `--bridge-production-gateway`, `--bridge-production`,
`--bridge-production-errors`, and `--bridge-production-refresh`, passed to
`bun scripts/probe-routing.ts`. They require macOS and OpenSSL with `req -addext`
support; synthetic success does not prove live enrollment or inference.
`APERTURE_TEST_TARBALL` selects an absolute existing candidate for package, routing,
and cleanup checks rather than repacking. Historical `--relay*` modes exercise
test fixtures, not the shipped bridge. Consult verification before interpreting results.
