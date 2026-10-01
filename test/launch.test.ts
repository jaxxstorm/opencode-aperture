import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function launch(extra: Record<string, string> = {}, args: string[] = []) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aperture-launch-")));
  roots.push(root);
  for (const dir of ["project", "config/opencode-aperture"]) {
    await mkdir(join(root, dir), { recursive: true });
  }
  await writeFile(join(root, "project/opencode.json"), "{}");
  await writeFile(join(root, "project/tui.json"), "{}");
  await writeFile(join(root, "config/opencode-aperture/settings.json"),
    JSON.stringify({ bridge: { gateway: "https://gateway.example" } }));
  const executable = join(root, "fake-opencode");
  await writeFile(executable, `#!${process.execPath} --no-env-file
const env = process.env;
const mode = process.argv[2];
if (mode === "wait" || mode === "stubborn") {
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    console.log(JSON.stringify({ forwarded: true }));
    if (mode === "wait") process.exit(0);
  });
  setInterval(() => {}, 1000);
}
console.log(JSON.stringify({
  key: !!env.PROVIDER_API_KEY,
  secondKey: !!env.SECOND_API_KEY,
  ambient: !!env.AMBIENT_SECRET,
  selector: !!env.APERTURE_PASSTHROUGH_ENV,
  debug: env.OPENCODE_APERTURE_DEBUG === "1",
  isolated: env.HOME === process.cwd().replace(/\\/project$/, "/home") &&
    env.XDG_CONFIG_HOME === process.cwd().replace(/\\/project$/, "/config") &&
    env.OPENCODE_APERTURE_ENABLE === undefined && env.APERTURE_HOST === "https://gateway.example",
  args: process.argv.slice(2).every(arg => !arg.includes("secret-sentinel"))
}));
if (mode === "exit") process.exit(23);
`);
  await chmod(executable, 0o700);
  return Bun.spawn(["/bin/zsh", resolve("scripts/launch.zsh"), ...args], {
    env: {
      PATH: process.env.PATH!,
      APERTURE_LOCAL_PROFILE: root,
      APERTURE_TEST_TMPDIR: root,
      BUN_BIN: process.execPath,
      OPENCODE_BIN: executable,
      PROVIDER_API_KEY: "secret-sentinel-one",
      SECOND_API_KEY: "secret-sentinel-two",
      AMBIENT_SECRET: "secret-sentinel-ambient",
      ...extra,
    },
    stdout: "pipe", stderr: "pipe",
  });
}

test("launch keeps ambient keys out by default", async () => {
  const child = await launch();
  expect(await new Response(child.stdout).json()).toEqual({
    key: false, secondKey: false, ambient: false, selector: false, debug: false, isolated: true, args: true,
  });
  expect(await child.exited).toBe(0);
});

test("launch forwards only explicitly selected keys without exposing values", async () => {
  const child = await launch({ APERTURE_PASSTHROUGH_ENV: "PROVIDER_API_KEY, SECOND_API_KEY" });
  const output = await new Response(child.stdout).text();
  expect(JSON.parse(output)).toEqual({
    key: true, secondKey: true, ambient: false, selector: false, debug: false, isolated: true, args: true,
  });
  expect(output).not.toContain("secret-sentinel");
  expect(await new Response(child.stderr).text()).toBe("");
  expect(await child.exited).toBe(0);
});

test.each(["MISSING_API_KEY", "PROVIDER_API_KEY,", "BAD=secret-sentinel", "HOME", "PATH",
  "XDG_CONFIG_HOME", "OPENCODE_CONFIG", "BUN_OPTIONS", "NODE_OPTIONS", "TS_NODE_PROJECT",
  "APERTURE_HOST", "NPM_CONFIG_PREFIX", "TMPDIR", "DYLD_INSERT_LIBRARIES", "ENV"])(
  "launch rejects missing, malformed or reserved selection %s before spawning", async (name) => {
    const child = await launch({ APERTURE_PASSTHROUGH_ENV: name });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stdout).text()).toBe("");
    const error = await new Response(child.stderr).text();
    expect(error).toContain("APERTURE_PASSTHROUGH_ENV");
    expect(error).not.toContain("secret-sentinel");
  },
);

test.each(["1", "0", "true"])("launcher debug requires explicit value 1: %s", async value => {
  const child = await launch({ OPENCODE_APERTURE_DEBUG: value });
  expect((await new Response(child.stdout).json()).debug).toBe(value === "1");
  expect(await child.exited).toBe(0);
});

test("launch preserves child exit status", async () => {
  const child = await launch({}, ["exit"]);
  expect(await child.exited).toBe(23);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  for (const mode of ["wait", "stubborn"]) {
    test(`launch forwards ${signal} and reaps a ${mode} child`, async () => {
      const child = await launch({}, [mode]);
      const reader = child.stdout.getReader();
      try {
        const ready = await reader.read();
        expect(new TextDecoder().decode(ready.value)).toContain('"isolated":true');
        child.kill(signal);
        expect(await child.exited).toBe(signal === "SIGINT" ? 130 : 143);
        let output = "";
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          output += new TextDecoder().decode(chunk.value);
        }
        expect(output).toContain('"forwarded":true');
      } finally {
        if (child.exitCode === null) child.kill("SIGTERM");
        await child.exited;
        reader.releaseLock();
      }
    }, 15000);
  }
}
