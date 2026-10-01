#!/bin/sh
# Launch the prepared local test profile, not your normal OpenCode installation's data.
set -eu
umask 077

test_root="${APERTURE_TEST_TMPDIR:-${TMPDIR:-/tmp}/opencode}"
profile="${APERTURE_LOCAL_PROFILE:-$test_root/aperture-local-test}"
bun_bin="${BUN_BIN:-$(command -v bun || true)}"
opencode_bin="${OPENCODE_BIN:-$(command -v opencode || true)}"

case "$profile" in
  /*) ;;
  *) printf '%s\n' "APERTURE_LOCAL_PROFILE must be an absolute directory: $profile" >&2; exit 1 ;;
esac
for required in project/opencode.json project/tui.json config/opencode-aperture/settings.json; do
  if [ ! -f "$profile/$required" ]; then
    printf '%s\n' "Prepared local test profile is incomplete. Missing: $profile/$required" >&2
    printf '%s\n' "Set APERTURE_LOCAL_PROFILE if your prepared profile is elsewhere. Existing settings and identity were not changed." >&2
    exit 1
  fi
done
for executable in "$bun_bin" "$opencode_bin"; do
  case "$executable" in
    /*) if [ -x "$executable" ]; then continue; fi ;;
  esac
  printf '%s\n' "Set BUN_BIN and OPENCODE_BIN to absolute executable paths." >&2
  exit 1
done

# Read only the nonsecret gateway setting; never copy normal auth or user config.
gateway="${APERTURE_TEST_GATEWAY:-$("$bun_bin" --no-env-file --config=/dev/null -e '
  const settings = await Bun.file(process.argv[1]).json();
  const gateway = new URL(settings.bridge.gateway);
  if (gateway.protocol !== "https:" || gateway.username || gateway.password || gateway.pathname !== "/" || gateway.search || gateway.hash) process.exit(1);
  console.log(gateway.origin);
' "$profile/config/opencode-aperture/settings.json")}"

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd -P)
exec "$bun_bin" --no-env-file --config=/dev/null "$script_dir/launch-env.ts" \
  "$profile" "$test_root" "$bun_bin" "$opencode_bin" "$gateway" "$@"
