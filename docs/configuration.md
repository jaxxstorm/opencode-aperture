# Configuration

Use [How to Use](how-to-use.md) for installation and the first request. These are
optional settings for an already-registered plugin.

## Gateway Address

| Setting | Behavior |
| --- | --- |
| `APERTURE_HOST` | First nonempty gateway override |
| `OPENCODE_APERTURE_HOST` | Fallback if `APERTURE_HOST` is empty or unset |
| Saved `bridge.gateway` | Used with an enabled bridge when neither override is set |
| Default | `http://ai`; set your actual trusted gateway explicitly |
| `OPENCODE_APERTURE_DEBUG=1` | Enable plugin debug output; otherwise disabled |

Specify an origin such as `https://aperture.example.com:8443`, not a URL ending in
`/v1` or `/codex`. Credentials, query parameters and fragments are rejected. Bridge
mode requires HTTPS. Direct HTTP is supported only for an independently protected,
trusted network; it provides no transport encryption itself.

Environment overrides take precedence over the gateway chosen in setup. Restart
OpenCode after changing environment variables or manually editing settings.

## Authentication Modes

Authentication is configured per **remote catalog provider ID**, not the generated
`aperture-*` ID shown by OpenCode. Replace the server plugin's string entry with a
tuple when options are needed. Keep the TUI entry unchanged.

### Gateway-Managed Credentials

Use credentials configured by the gateway operator. Example explicit override:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["@jaxxstorm/opencode-aperture@0.1.4", {
    "auth": { "openai": { "mode": "gateway" } }
  }]]
}
```

Managed routes strip SDK-supplied upstream credentials rather than borrowing native
OpenCode credentials. This is the default when discovery's `requires_client_auth`
flag is absent or false. A missing flag is not proof of the gateway's auth policy;
confirm it with the operator if requests fail.

### Forward an API Key

Provide the key through your existing secure environment mechanism before starting
OpenCode. Reference its **variable name**, never its value:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["@jaxxstorm/opencode-aperture@0.1.4", {
    "auth": {
      "anthropic": {
        "mode": "passthrough",
        "apiKeyEnv": "PROVIDER_API_KEY",
        "protocol": "messages"
      }
    }
  }]]
}
```

The environment variable must be present and nonempty in the **OpenCode server
process**. Only that selected key is forwarded, using the protocol's auth header.
Do not put key values in JSON, command arguments, chat or settings. The key is not
persisted by this plugin. Bedrock AWS SigV4 passthrough is not supported.

The development launcher strips ambient keys. To forward already-populated variables
there, see [Run Locally](run-locally.md) and the [script index](https://github.com/jaxxstorm/opencode-aperture/blob/main/scripts/README.md).

### Forward a ChatGPT Subscription

Use this only when the gateway operator confirms a compatible ChatGPT subscription
passthrough provider and `/codex/responses` route. An ordinary OpenAI platform API
provider is not automatically compatible with ChatGPT credentials.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["@jaxxstorm/opencode-aperture@0.1.4", {
    "auth": { "openai": { "mode": "subscription", "protocol": "responses" } }
  }]]
}
```

Here `openai` must be the actual remote subscription provider ID; change it if needed.
Then run `opencode auth login` in the same OpenCode profile and choose OpenAI's
ChatGPT OAuth login. Existing native login can be reused. OpenCode owns OAuth refresh
and storage; the plugin does not read or migrate auth files.

Exactly one enabled subscription provider can use the native `openai` ID. Gateway
and explicit API-key providers remain separate. For legacy catalogs,
`requires_client_auth: true` plus Responses support selects subscription mode unless
overridden. Other client-auth-required providers need an explicit supported mode.

## Provider and Model Selection

Generated IDs look like `aperture-openai`; mixed-protocol groups can have suffixes
such as `aperture-vercel:messages`. Each model keeps its upstream name. Protocol
adapters preserve SDK model recognition and add the gateway's provider qualifier at
the request boundary for body-based APIs.

An optional `protocol` override must be advertised by that remote provider:

| Value | API |
| --- | --- |
| `responses` | OpenAI Responses |
| `chat` | OpenAI Chat Completions |
| `messages` | Anthropic Messages |
| `bedrock` | Bedrock Converse |
| `gemini` | Gemini generate/streamGenerateContent |

Unknown protocols, Vertex-only or invoke-only entries, and ambiguous path-based
model routing are not silently converted to OpenAI. See [Compatibility](compatibility.md).

Explicit default models and allow/deny lists are preserved. Unknown model limits
use estimates of **128,000 context tokens and 8,192 output tokens**. Override them
with verified values under `provider[generatedID].models[modelID].limit` if needed.

## Stored Bridge Settings

Settings live at `${XDG_CONFIG_HOME:-$HOME/.config}/opencode-aperture/settings.json`.
Identity defaults to `${XDG_STATE_HOME:-$HOME/.local/state}/opencode-aperture/node`.
The identity is sensitive. Keep it outside repositories, package installations and
configuration trees. Settings files use mode `600`; their directories and identity
directory use `700`.

For package installations, leave the module path blank. `modulePath` is an advanced
override that trusts an absolute JavaScript entry. Setup does not install or upgrade
Bun. Manual state-path changes require stopping affected processes and preserving
ownership and permissions; do not move or copy normal OpenCode auth into bridge state.
