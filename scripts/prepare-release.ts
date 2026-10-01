import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertVersionAvailable, releaseIdentity } from "./release";

export const usage = "bun run release -- <version> [--dry-run] [--commit [--push]]";
export function releaseArguments(args: string[]) {
  if (args[0] === "--") args = args.slice(1);
  const [input, ...flags] = args;
  const version = input?.replace(/^v/, "");
  assert(version && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), usage);
  assert(flags.every(flag => ["--dry-run", "--commit", "--push"].includes(flag)) && new Set(flags).size === flags.length, usage);
  const options = { version, dryRun: flags.includes("--dry-run"), commit: flags.includes("--commit"), push: flags.includes("--push") };
  assert(!options.push || options.commit, "--push requires --commit");
  return options;
}

type Run = (args: string[]) => Promise<string>;
export async function prepareRelease(
  root: string,
  options: ReturnType<typeof releaseArguments>,
  dependencies: { run: Run; available: typeof assertVersionAvailable; log: (message: string) => void },
) {
  const { run, available, log } = dependencies;
  const manifestPath = resolve(root, "package.json");
  const original = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(original);
  const { version, dryRun, commit, push } = options;
  const tag = `v${version}`;
  releaseIdentity(tag, { ...manifest, version });
  releaseIdentity(`v${manifest.version}`, manifest);
  const before = manifest.version.split(".").map(BigInt) as bigint[];
  const after = version.split(".").map(BigInt) as bigint[];
  const changed = after.findIndex((part, i) => part !== before[i]);
  assert(changed >= 0 && after[changed]! > before[changed]!, "Release version must be greater than package.json version");
  assert(manifest.packageManager === `bun@${Bun.version}`, `Use ${manifest.packageManager} for release preparation`);
  assert(!(await run(["git", "status", "--porcelain=v1", "--untracked-files=all"])).trim(), "Worktree must be clean; commit or stash your changes first");
  const branch = (await run(["git", "symbolic-ref", "--short", "HEAD"])).trim();
  assert(branch, "Release preparation requires a checked-out branch");
  assert(!(await run(["git", "tag", "--list", tag])).trim(), `Local tag ${tag} already exists; choose a new version`);
  const remote = await run(["git", "ls-remote", "--heads", "--tags", "origin", `refs/heads/${branch}`, `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  assert(!remote.split("\n").some(line => line.includes(`\trefs/tags/${tag}`)), `Remote tag ${tag} already exists; choose a new version`);
  const remoteHead = remote.split("\n").find(line => line.endsWith(`\trefs/heads/${branch}`))?.split("\t")[0];
  if (push && remoteHead) {
    // Failure (including an unknown remote commit) requires an explicit fetch/rebase by the user.
    await run(["git", "merge-base", "--is-ancestor", remoteHead, "HEAD"]);
  }
  await available(manifest.name, version);
  log(`${manifest.name}: ${manifest.version} -> ${version}; tag ${tag}; branch ${branch}`);
  log(`Plan: update version, synchronize lockfile, typecheck, test, build, verify package${commit ? ", commit and tag" : ""}${push ? ", atomically push branch and tag to origin" : ""}. No direct npm publication.`);
  if (dryRun) { log("Dry run complete; no files or Git refs changed."); return; }

  assert(!(await run(["git", "status", "--porcelain=v1", "--untracked-files=all"])).trim(), "Worktree changed during preflight; stopped before updating files");
  assert.equal(await readFile(manifestPath, "utf8"), original, "Manifest changed during preflight");
  const updated = original.replace(/("version"\s*:\s*")[^"]+("\s*[,}])/, `$1${version}$2`);
  assert.equal(JSON.parse(updated).version, version, "Cannot safely locate the package version field");
  await writeFile(manifestPath, updated);
  await run([process.execPath, "install", "--ignore-scripts"]);
  await run([process.execPath, "run", "typecheck"]);
  await run([process.execPath, "test"]);
  await run([process.execPath, "run", "build"]);
  await run([process.execPath, "run", "test:package"]);
  assert.equal(await readFile(manifestPath, "utf8"), updated, "Verification changed package.json unexpectedly; review before releasing");
  releaseIdentity(tag, JSON.parse(await readFile(manifestPath, "utf8")));
  const status = await run(["git", "status", "--porcelain=v1", "--untracked-files=all", "-z"]);
  assert(status.split("\0").filter(Boolean).every(entry => ["package.json", "bun.lock"].includes(entry.slice(3))),
    "Verification changed files other than package.json/bun.lock; review them manually before releasing");
  if (!commit) {
    log(`Prepared ${version}. Review and commit package.json and any bun.lock change, then tag that commit ${tag}. Nothing was committed, tagged, pushed or published.`);
    return;
  }

  // Show exactly what will be committed, including recent commit style/context.
  log(await run(["git", "status", "--short"]));
  log(await run(["git", "diff", "HEAD", "--", "package.json", "bun.lock"]));
  log(await run(["git", "log", "--oneline", "-10"]));
  await run(["git", "add", "--", "package.json", "bun.lock"]);
  await run(["git", "commit", "-m", `chore(release): ${tag}`]);
  assert(!(await run(["git", "status", "--porcelain=v1", "--untracked-files=all"])).trim(), "Commit hooks left changes; review before tagging");
  const committed = JSON.parse(await run(["git", "show", "HEAD:package.json"]));
  releaseIdentity(tag, committed);
  await run(["git", "tag", "-a", tag, "-m", `Release ${tag}`]);
  if (push) {
    await run(["git", "push", "--atomic", "origin", `HEAD:refs/heads/${branch}`, `refs/tags/${tag}:refs/tags/${tag}`]);
    log(`Pushed ${tag}. GitHub Actions will verify and publish after the configured release approval.`);
  } else log(`Created local commit and ${tag}; nothing pushed or published. Push the branch and tag together when ready.`);
}

if (import.meta.main) {
  if (process.argv.slice(2).some(arg => arg === "--help" || arg === "-h")) {
    console.log(usage);
  } else {
    const root = resolve(import.meta.dir, "..");
    try {
      const options = releaseArguments(process.argv.slice(2));
      await prepareRelease(root, options, {
        available: assertVersionAvailable,
        log: console.log,
        run: async args => {
          console.log(`> ${args.join(" ")}`);
          const child = Bun.spawn(args, { cwd: root, stdin: "inherit", stdout: "pipe", stderr: "inherit" });
          const output = new Response(child.stdout).text();
          const [code, text] = await Promise.all([child.exited, output]);
          if (code !== 0) throw new Error(`Command failed (${code}): ${args.join(" ")}\n${text}`);
          if (args[0] !== "git" && text.trim()) console.log(text.trimEnd());
          return text;
        },
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Release preparation failed");
      console.error("Stopped. Existing changes, commits and tags were not rolled back. Inspect git status and local/remote tags before retrying; never force-push a release tag.");
      process.exitCode = 1;
    }
  }
}
