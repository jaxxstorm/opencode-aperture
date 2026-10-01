# How to Use

This guide installs the published plugin and takes you to your first model request.
For a source checkout instead, see [Build](build.md) and [Run Locally](run-locally.md).

## 1. Check Prerequisites

- Use OpenCode **1.18.29**, the verified host version.
- Know your trusted Aperture gateway's origin, for example `https://aperture.example.com`.
- For the embedded Tailscale bridge, install external **Bun 1.4.2** on macOS or Linux.
  OpenCode's embedded Bun is not a substitute.
- Confirm that your identity has permission to use the gateway and its models.

The example hostname is a placeholder. The gateway receives your requests and,
in forwarding modes, your selected credentials. Only use a gateway you trust.

## 2. Register the Plugin

In the project where you want to use Aperture, merge this into `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@jaxxstorm/opencode-aperture@0.1.4"]
}
```

Also merge the TUI registration into `tui.json` in that project:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@jaxxstorm/opencode-aperture@0.1.4"]
}
```

Preserve any existing settings and other plugin entries. OpenCode installs the
registered package. Both entries are needed for routing plus the `/aperture-*`
commands; no enable environment variable is required. Restart OpenCode after
registration or upgrades. The optional bridge package is installed by default.

## 3. Choose Your Connection

### Direct Access

Use this when the machine running OpenCode can already reach Aperture. You do not
need bridge enrollment or external Bun for direct access.

```sh
APERTURE_HOST=https://aperture.example.com opencode
```

Discovery runs at instance initialization. If you previously enabled bridge mode,
run `/aperture-disconnect` and restart first. Direct mode does not use
`/aperture-setup`; that command configures the Tailscale bridge.

### Tailscale Bridge

Use this when you want the plugin to run its own Tailscale identity. Your system
Tailscale client does not need to be on the same tailnet, but the **bridge identity**
must be enrolled into a tailnet with access to Aperture, and access rules must permit
HTTPS to the gateway.

1. Start OpenCode in the configured project and run `/aperture-setup`.
2. Confirm local-server setup and gateway trust, then choose **Enable and enroll**.
3. Enter the gateway's HTTPS origin, without an API path.
4. Choose **External Bun**. Leave the executable blank if Bun 1.4.2 is on `PATH`,
   or enter its absolute executable path.
5. Leave the bridge JS module path blank to use the installed dependency.
6. Choose a device hostname and **Browser link**.
7. Open the displayed URL if the browser does not open automatically. Keep the
   dialog open while you authenticate; Enter keeps waiting, Escape cancels.
8. Select the tailnet that can reach your Aperture gateway and complete enrollment.

Successful enrollment saves the local identity and attempts to refresh models.
An already-authorized identity is reused and produces **no new login link**.
Use `/aperture-login` to retry enrollment with saved connection settings, not to
force a new identity. Remote OpenCode server attachment is not supported by setup.

## 4. Select a Model

Run `/models` and select a provider labeled **Aperture (...)**, then select a model
and send a prompt. An existing default model is not automatically replaced, so
check the selected provider before sending your request.

Mixed-protocol gateways can appear as several groups. The plugin supports Responses,
Chat Completions, Anthropic Messages, Bedrock Converse and Gemini where advertised.
An entry in the picker is not proof of inference authorization.

For gateway-managed providers, you do **not** need OpenCode's native OpenAI login.
For an upstream API key or personal ChatGPT subscription, follow
[Authentication Modes](configuration.md#authentication-modes) before sending requests.

## 5. Refresh or Disconnect

| Command | Purpose |
| --- | --- |
| `/aperture-setup` | Configure and enroll the local bridge |
| `/aperture-login` | Enroll using saved settings, reusing authorized identity when possible |
| `/aperture-models` | Reload the current idle instance and refresh its bridge-backed model catalog |
| `/aperture-status` | Show saved settings, not live connectivity |
| `/aperture-disconnect` | Disable the bridge after restarting OpenCode |
| `/aperture-forget` | Delete the disabled, stopped local bridge identity after confirmation |

`/aperture-models` currently requires enabled bridge settings. For direct mode,
restart OpenCode to rediscover models. Do not start new work during refresh: its
idle check and instance reload are not atomic. Cancelling stops waiting, not a
reload already accepted by the server.

Do not forget/re-enroll to fix a catalog error. Read the persistent error dialog
and use [Troubleshooting](troubleshooting.md).

## Remove the Plugin

Remove its entries from both configuration files and restart OpenCode. Bridge
identity persists separately. To delete it intentionally, disconnect, restart,
stop other processes using the profile, and confirm `/aperture-forget` before
removing the registrations. This does not revoke the device remotely; use the
Tailscale admin console for that. Native OpenAI credentials are not deleted.
