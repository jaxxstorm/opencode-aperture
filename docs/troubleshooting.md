# Troubleshooting

First distinguish **enrollment**, **model discovery**, and **inference**. Success at
one step does not guarantee the next. Keep the full error code from the persistent
dialog, but never share login URLs, tokens, proxy credentials or identity contents.

## Commands Are Missing

Check both registrations: `opencode.json` loads the server plugin and `tui.json`
loads the TUI commands. Restart OpenCode after changing them. No enable flag is
required. See [How to Use](how-to-use.md).

## Login Succeeds Without a Link

The saved Tailscale identity is already authorized. This is normal; it is not a
cached browser failure. Do not forget the identity just to retry discovery.

For a new identity, the URL remains visible while the plugin attempts to open your
browser. Copy it manually if needed and leave the enrollment dialog open. Escape
cancels. Browser history and OS process inspection can expose an opened URL; the
plugin does not put it in chat, ordinary logs or settings.

## Models Are Missing

For bridge mode, run `/aperture-models` while idle. For direct mode, restart OpenCode.
Check the selected gateway and any `APERTURE_HOST` override. Enrollment into a
tailnet does not prove that tailnet's access rules allow reaching Aperture.

| Error | Next check |
| --- | --- |
| `MODULE_UNAVAILABLE` | Confirm the optional bridge dependency is installed, or correct an explicit module override. Normal installations need no override. |
| `UNSUPPORTED_RUNTIME` | Select external Bun **1.4.2**, not OpenCode's embedded runtime. |
| `STATE_UNSAFE` | Stop affected processes and inspect ownership/permissions and the profile's provenance. Do not fabricate ownership markers or loosen protections. |
| `STATE_LOCKED` | Close other processes using that identity. Never delete a live lock; a stale lease needs manual review after all helpers stop. |
| `DISCOVERY_CONNECTIVITY` / `DISCOVERY_TIMEOUT` | Check the origin, tailnet access, HTTPS reachability, certificates and redirect behavior. |
| `DISCOVERY_UNAUTHORIZED` / `DISCOVERY_FORBIDDEN` | Ask the operator about discovery access and identity grants. |
| `DISCOVERY_NOT_FOUND` | Confirm this is an Aperture origin serving `/api/providers`. |
| `DISCOVERY_INVALID_JSON` / `DISCOVERY_INVALID_CATALOG` | Check gateway API compatibility; do not paste raw responses containing sensitive data. |
| `DISCOVERY_NO_PROVIDER` | An older subscription-only path found no eligible provider. Confirm the installed plugin version and intended authentication mode. |
| `PROTOCOL_ERROR` after rebuilding | Fully restart the test instance so parent and worker use matching builds. If it persists, report the code and versions. |
| `[catalog]` | OpenCode received no valid Aperture model catalog; inspect the accompanying sanitized server error. |
| `[timeout:reload-event]` | The current-instance reload event was not observed before the deadline. Restart the local instance. |

Temporary development profiles may lose files to OS cleanup. The launcher reports
missing files explicitly; a directory existing does not mean its installation or
identity metadata is intact. Use the durable profile in [Run Locally](run-locally.md).

## Models Appear but Requests Fail

Confirm the selected provider is labeled **Aperture (...)**. Check the gateway's
model grants and upstream credentials. Use gateway-managed, explicit API-key, or
subscription authentication as described in [Configuration](configuration.md).
Native OpenAI login is needed only for subscription forwarding.

The plugin is not a network-enforcement boundary. Setup failure may leave native
providers available; their requests can go directly to their normal services.

## Debug Output Overlaps the TUI

`OPENCODE_APERTURE_DEBUG=1` enables diagnostics written to stderr. Omit it for normal
use. In the development checkout, enable it only when needed:

```sh
OPENCODE_APERTURE_DEBUG=1 sh scripts/launch.sh
```

Restart without the flag for a quiet session. An `inference headers attached` line
is informational, not an error. Review diagnostics before sharing them.

## Report a Problem

Include the plugin version, `opencode --version`, external `bun --version`, OS and
architecture, direct/bridge mode, the failing command, and sanitized error code.
Do not include auth files, Tailscale state, raw headers or enrollment links.
