import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRelease, releaseArguments } from "../scripts/prepare-release";

test.each([[], ["0.1"], ["01.2.3"], ["0.1.2-beta"], ["0.1.2", "--push"], ["0.1.2", "--force"]].map(args => ({ args })))("reject invalid release arguments %j", ({ args }) => {
  expect(() => releaseArguments(args)).toThrow();
});

test("accept explicit version, optional v prefix and npm separator", () => {
  expect(releaseArguments(["--", "v0.1.2", "--commit", "--push", "--dry-run"])).toEqual({ version: "0.1.2", commit: true, push: true, dryRun: true });
});

test("release commit and tag atomically reach an isolated local remote", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-release-git-"));
  const work = join(root, "work");
  const remote = join(root, "remote.git");
  await mkdir(work);
  const run = async (args: string[]) => {
    // Actual Git behavior, but no registry access or nested full test suite.
    if (args[0] === process.execPath) {
      if (args[1] === "install") await writeFile(join(work, "bun.lock"), "updated fixture lock\n");
      return "";
    }
    const child = Bun.spawn(args, { cwd: work, stdout: "pipe", stderr: "pipe", env: {
      PATH: process.env.PATH!, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Release Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Release Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    } });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Fixture command failed: ${args.join(" ")}: ${err}`);
    return out;
  };
  try {
    await run(["git", "init", "--bare", remote]);
    await run(["git", "init", "--initial-branch=main"]);
    await writeFile(join(work, "package.json"), JSON.stringify({ name: "@jaxxstorm/opencode-aperture", version: "0.1.0", packageManager: `bun@${Bun.version}` }));
    await writeFile(join(work, "bun.lock"), "fixture lock\n");
    await run(["git", "add", "package.json", "bun.lock"]);
    await run(["git", "commit", "-m", "fixture baseline"]);
    await run(["git", "remote", "add", "origin", remote]);
    await run(["git", "push", "origin", "main"]);
    await prepareRelease(work, releaseArguments(["0.1.2", "--commit", "--push"]), { run, available: async () => {}, log: () => {} });
    const released = JSON.parse(await run(["git", `--git-dir=${remote}`, "show", "v0.1.2:package.json"]));
    expect(released.version).toBe("0.1.2");
    expect(await run(["git", "status", "--porcelain"])).toBe("");
    expect(await run(["git", `--git-dir=${remote}`, "rev-parse", "refs/heads/main"])).toBe(await run(["git", "rev-parse", "HEAD"]));
    expect(await run(["git", `--git-dir=${remote}`, "show", "v0.1.2:bun.lock"])).toBe("updated fixture lock\n");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15000);

test.each(["dry", "prepare", "push", "dirty", "local-tag", "remote-tag", "published", "network", "test-failure", "foreign-change", "commit-failure", "hook-version", "push-failure", "decrease"])("release safety: %s", async scenario => {
  const root = await mkdtemp(join(tmpdir(), "aperture-release-prepare-"));
  const path = join(root, "package.json");
  const original = JSON.stringify({ name: "@jaxxstorm/opencode-aperture", version: "0.1.0", packageManager: `bun@${Bun.version}`,
    optionalDependencies: { "@jaxxstorm/bun-tailscale-bridge": "0.1.0" } }, null, 2);
  await writeFile(path, original);
  const calls: string[][] = [];
  let statusCalls = 0;
  let registryCalls = 0;
  try {
    const options = releaseArguments([scenario === "decrease" ? "0.0.9" : "0.1.2", ...(scenario === "dry" ? ["--dry-run", "--commit", "--push"] : scenario === "prepare" ? [] : ["--commit", "--push"])]);
    const execute = () => prepareRelease(root, options, {
      log: () => {},
      available: async () => { registryCalls++; if (["published", "network"].includes(scenario)) throw new Error(scenario); },
      run: async args => {
        calls.push(args);
        const command = args.join(" ");
        if (args[1] === "status" && args.includes("--porcelain=v1")) {
          statusCalls++;
          if (scenario === "dirty" && statusCalls === 1) return " M user-work.ts";
          if (args.includes("-z")) return scenario === "foreign-change" ? " M unrelated.ts\0" : " M package.json\0";
          return "";
        }
        if (args[1] === "symbolic-ref") return "main\n";
        if (args[1] === "tag" && args[2] === "--list") return scenario === "local-tag" ? "v0.1.2\n" : "";
        if (args[1] === "ls-remote") return scenario === "remote-tag" ? "abc\trefs/tags/v0.1.2\n" : "abc\trefs/heads/main\n";
        if (args[1] === "test" && scenario === "test-failure") throw new Error("tests failed");
        if (args[1] === "commit" && scenario === "commit-failure") throw new Error("hook rejected commit");
        if (command === "git show HEAD:package.json") return scenario === "hook-version" ? original : await readFile(path, "utf8");
        if (args[1] === "push" && scenario === "push-failure") throw new Error("atomic push rejected");
        return "";
      },
    });
    if (["dry", "prepare", "push"].includes(scenario)) await execute();
    else await expect(execute()).rejects.toThrow();
    const manifest = JSON.parse(await readFile(path, "utf8"));
    expect(manifest.optionalDependencies["@jaxxstorm/bun-tailscale-bridge"]).toBe("0.1.0");
    const unchanged = ["dry", "dirty", "local-tag", "remote-tag", "published", "network", "decrease"].includes(scenario);
    expect(manifest.version).toBe(unchanged ? "0.1.0" : "0.1.2");
    if (unchanged) expect(await readFile(path, "utf8")).toBe(original);
    const tagged = calls.some(args => args[1] === "tag" && args[2] === "-a");
    expect(tagged).toBe(["push", "push-failure"].includes(scenario));
    if (scenario === "push") {
      expect(calls.at(-1)).toEqual(["git", "push", "--atomic", "origin", "HEAD:refs/heads/main", "refs/tags/v0.1.2:refs/tags/v0.1.2"]);
      expect(calls).toContainEqual(["git", "add", "--", "package.json", "bun.lock"]);
      expect(registryCalls).toBe(1);
    }
    expect(calls.some(args => args.includes("publish") || args.includes("--force"))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
