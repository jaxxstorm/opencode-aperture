#!/bin/zsh
# Launch the prepared local test profile, not your normal OpenCode installation's data.
set -eu
umask 077

test_root="${APERTURE_TEST_TMPDIR:-${TMPDIR:-/tmp}/opencode}"
profile="${APERTURE_LOCAL_PROFILE:-$test_root/aperture-local-test}"
bun_bin="${BUN_BIN:-$(command -v bun)}"
opencode_bin="${OPENCODE_BIN:-$(command -v opencode)}"

if [[ "$profile" != /* ]]; then
  print -u2 -- "APERTURE_LOCAL_PROFILE must be an absolute directory: $profile"
  exit 1
fi
for required in project/opencode.json project/tui.json config/opencode-aperture/settings.json; do
  if [[ ! -f "$profile/$required" ]]; then
    print -u2 -- "Prepared local test profile is incomplete. Missing: $profile/$required"
    print -u2 -- "Set APERTURE_LOCAL_PROFILE if your prepared profile is elsewhere. Existing settings and identity were not changed."
    exit 1
  fi
done
if [[ "$bun_bin" != /* || ! -x "$bun_bin" || "$opencode_bin" != /* || ! -x "$opencode_bin" ]]; then
  print -u2 -- "Set BUN_BIN and OPENCODE_BIN to absolute executable paths."
  exit 1
fi

# Read only the nonsecret gateway setting; never copy normal auth or user config.
gateway="${APERTURE_TEST_GATEWAY:-$("$bun_bin" --no-env-file --config=/dev/null -e '
  const settings = await Bun.file(process.argv[1]).json();
  const gateway = new URL(settings.bridge.gateway);
  if (gateway.protocol !== "https:" || gateway.username || gateway.password || gateway.pathname !== "/" || gateway.search || gateway.hash) process.exit(1);
  console.log(gateway.origin);
' "$profile/config/opencode-aperture/settings.json")}"

repo="${0:A:h:h}"
exec "$bun_bin" --no-env-file --config=/dev/null "$repo/scripts/launch-env.ts" \
  "$profile" "$test_root" "$bun_bin" "$opencode_bin" "$gateway" "$@"
