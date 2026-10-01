import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { constants } from "node:os";

const [profile, testRoot, bun, opencode, gateway, ...args] = process.argv.slice(2);
if (!profile || !testRoot || !bun || !opencode || !gateway) {
  console.error("Use scripts/launch.sh to launch the prepared profile.");
  process.exit(1);
}

const env: Record<string, string> = {
  PATH: `${dirname(bun)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: `${profile}/home`,
  TMPDIR: testRoot,
  XDG_CONFIG_HOME: `${profile}/config`,
  XDG_DATA_HOME: `${profile}/data`,
  XDG_STATE_HOME: `${profile}/state`,
  XDG_CACHE_HOME: `${profile}/cache`,
  OPENCODE_CONFIG_DIR: `${profile}/config/opencode`,
  NPM_CONFIG_USERCONFIG: `${profile}/home/local-npmrc`,
  NPM_CONFIG_GLOBALCONFIG: `${profile}/home/global-npmrc`,
  NPM_CONFIG_CACHE: `${profile}/cache/npm`,
  NPM_CONFIG_OFFLINE: "true",
  TERM: process.env.TERM || "xterm-256color",
  COLORTERM: process.env.COLORTERM || "truecolor",
  LANG: process.env.LANG || "en_US.UTF-8",
  SHELL: "/bin/sh",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_EXPERIMENTAL_WEBSOCKETS: "0",
  OPENCODE_APERTURE_DEBUG: process.env.OPENCODE_APERTURE_DEBUG === "1" ? "1" : "0",
  APERTURE_HOST: gateway,
};

// Explicit names are sufficient consent; values stay in the child environment only.
const names = process.env.APERTURE_PASSTHROUGH_ENV;
for (const name of names ? names.split(",").map((name) => name.trim()) : []) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      Object.hasOwn(env, name.toUpperCase()) ||
      /^(HOME|PATH|TMP|TEMP|TMPDIR|SHELL|ENV|BASH_ENV|CDPATH|IFS|ZDOTDIR|NODE|BUN|TS|NPM|PNPM|YARN|COREPACK|LD|DYLD|XDG|OPENCODE|APERTURE|PYTHON|RUBY|PERL|GIT|SSL_CERT|NODE_EXTRA_CA_CERTS)(_|$)/i.test(name)) {
    console.error("APERTURE_PASSTHROUGH_ENV contains an invalid or reserved name.");
    process.exit(1);
  }
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error("APERTURE_PASSTHROUGH_ENV names an unset or empty variable.");
    process.exit(1);
  }
  env[name] = value;
}

const child = spawn(opencode, args, { cwd: `${profile}/project`, env, stdio: "inherit" });
let timer: ReturnType<typeof setTimeout> | undefined;
let forwarded: "SIGINT" | "SIGTERM" | undefined;
function forward(signal: "SIGINT" | "SIGTERM") {
  forwarded ??= signal;
  child.kill(signal);
  // Give OpenCode's bridge shutdown (up to seven seconds) time to release its lease.
  timer ??= setTimeout(() => child.kill("SIGKILL"), 10000);
}
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
child.on("error", () => {
  console.error("Unable to start the isolated OpenCode process.");
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (timer) clearTimeout(timer);
  process.exit(forwarded ? 128 + constants.signals[forwarded] :
    code ?? (signal ? 128 + constants.signals[signal] : 1));
});
