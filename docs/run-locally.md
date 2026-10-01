# Run Locally

First follow [Build from source](build.md), using Bun **1.4.2** and OpenCode
**1.18.29**. These POSIX-shell instructions create a durable, isolated development
profile on macOS/Linux, not a global plugin registration. Native Windows is not
covered. Start in the checkout root; use a new profile path outside any repository
or package directory, with no symlink or group/world-writable ancestors.

## Create the Profile

The command refuses to overwrite an existing profile. It writes two project
registrations with absolute built-file URLs and nonsecret, disabled bridge settings.
The example gateway is a placeholder, not a working service or a trust endorsement.

```sh
export APERTURE_LOCAL_PROFILE="$HOME/.local/share/opencode-aperture-dev"
export BUN_BIN="$(command -v bun)"
export OPENCODE_BIN="$(command -v opencode)"
umask 077
"$BUN_BIN" --no-env-file --config=/dev/null -e '
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.cwd());
const profile = process.env.APERTURE_LOCAL_PROFILE;
if (!profile || !isAbsolute(profile) || existsSync(profile))
  throw new Error("Choose a new absolute APERTURE_LOCAL_PROFILE");
for (const file of ["index.js", "tui.js", "bridge-worker.js"])
  if (!existsSync(join(root, "dist", file))) throw new Error("Build first");
for (const dir of ["", "project/.opencode", "home", "config/opencode",
  "config/opencode-aperture", "data", "cache", "state"])
  mkdirSync(join(profile, dir), { recursive: true, mode: 0o700 });
const write = (name, value) => writeFileSync(join(profile, name),
  JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
write("project/opencode.json", { $schema: "https://opencode.ai/config.json",
  plugin: [pathToFileURL(join(root, "dist/index.js")).href] });
write("project/tui.json", { $schema: "https://opencode.ai/tui.json",
  plugin: [pathToFileURL(join(root, "dist/tui.js")).href] });
write("config/opencode-aperture/settings.json", { version: 1, bridge: {
  enabled: false, gateway: "https://aperture.example.com", hostname: "opencode-aperture-dev",
  stateDir: join(profile, "state/opencode-aperture/node"),
  runtime: { mode: "external", executable: process.env.BUN_BIN }, startupTimeoutMs: 60000
} });
'
```

New directories use `0700`, files `0600`. Identity stays outside both project and
config trees; do **not** manually create the node identity directory or install a
package at the profile root. The plugin creates its private identity when needed.
The worker resolves the optional bridge installed in the checkout from `dist/`;
omit `modulePath`. No separate runtime package installation is needed here.

## First Launch

Keep the exported variables above; both executable paths must be absolute. This
subshell leaves your checkout shell unchanged and does not copy normal auth or
configuration. `env -i` drops inherited credentials and runtime overrides. Network
access remains available for OpenCode to install public plugin/provider dependencies.

```sh
(
  cd "$APERTURE_LOCAL_PROFILE/project" || exit 1
  env -i PATH="$(dirname "$BUN_BIN"):/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    HOME="$APERTURE_LOCAL_PROFILE/home" TMPDIR=/tmp \
    XDG_CONFIG_HOME="$APERTURE_LOCAL_PROFILE/config" \
    XDG_DATA_HOME="$APERTURE_LOCAL_PROFILE/data" \
    XDG_STATE_HOME="$APERTURE_LOCAL_PROFILE/state" \
    XDG_CACHE_HOME="$APERTURE_LOCAL_PROFILE/cache" \
    OPENCODE_CONFIG_DIR="$APERTURE_LOCAL_PROFILE/config/opencode" \
    NPM_CONFIG_USERCONFIG="$APERTURE_LOCAL_PROFILE/home/local-npmrc" \
    NPM_CONFIG_GLOBALCONFIG="$APERTURE_LOCAL_PROFILE/home/global-npmrc" \
    NPM_CONFIG_CACHE="$APERTURE_LOCAL_PROFILE/cache/npm" \
    TERM="${TERM:-xterm-256color}" LANG="${LANG:-en_US.UTF-8}" SHELL=/bin/sh \
    OPENCODE_DISABLE_EXTERNAL_SKILLS=1 OPENCODE_DISABLE_MODELS_FETCH=1 \
    OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_EXPERIMENTAL_WEBSOCKETS=0 \
    "$OPENCODE_BIN"
)
```

Use `/aperture-setup` to confirm a trusted HTTPS gateway and enroll explicitly;
the placeholder cannot provide models. See [How to Use](how-to-use.md) and [configuration](configuration.md)
before sending prompts or credentials. Repeat
the launch block for later runs; keep the durable profile private.

## Prepared-Profile Helper

`sh scripts/launch.sh` from the checkout uses `APERTURE_LOCAL_PROFILE`, but forces
`NPM_CONFIG_OFFLINE=true`. It is **not** the fresh-profile launch above. Its public
plugin dependency must already be installed in both config scopes, for example:

```sh
bun add --exact --cwd "$APERTURE_LOCAL_PROFILE/config/opencode" @opencode-ai/plugin@1.18.29
bun add --exact --cwd "$APERTURE_LOCAL_PROFILE/project/.opencode" @opencode-ai/plugin@1.18.29
```

These public installs alone do not prepare every provider SDK/cache needed by a
first prompt. Use the online-capable isolated launch above if dependencies are
missing. The helper defaults to a temporary profile unless overridden; its separate
`APERTURE_TEST_TMPDIR` is a short existing socket parent, not durable identity storage.

With `APERTURE_LOCAL_PROFILE` still pointing at your prepared durable profile, run:

```sh
APERTURE_TEST_TMPDIR=/tmp sh scripts/launch.sh
```

See the [script index](https://github.com/jaxxstorm/opencode-aperture/blob/main/scripts/README.md) and [verification](verification.md).
For setup failures, see [troubleshooting](troubleshooting.md).
