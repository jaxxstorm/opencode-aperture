import { copyFile, mkdtemp, mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { isBuiltin } from "node:module";

export const packageName = "@jaxxstorm/opencode-aperture";
export const packageFiles = ["LICENSE", "README.md", "dist/bridge-worker.js", "dist/index.js", "dist/tui.js", "docs/compatibility.md", "docs/live-validation.md", "docs/release.md", "docs/verification.md", "package.json"];
export const checkout = resolve(import.meta.dir, "..");
export const temporaryBase = process.env.APERTURE_TEST_TMPDIR ?? tmpdir();

export function isolatedEnv(root: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "", HOME: root, TMPDIR: root,
    NPM_CONFIG_USERCONFIG: join(root, "empty-npmrc"), NPM_CONFIG_GLOBALCONFIG: join(root, "empty-global-npmrc"),
    XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_CONFIG_DIR: join(root, "config"),
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_EXPERIMENTAL_WEBSOCKETS: "0",
  };
}

export async function command(args: string[], cwd: string, env?: Record<string, string>, timeout = 60_000) {
  const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
  try {
    const [stdout, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    assert.equal(code, 0, `${args[0]} failed (exit ${code}); subprocess output withheld`);
    return stdout;
  } finally { clearTimeout(timer); }
}

export async function consumer(tarball = process.env.APERTURE_TEST_TARBALL) {
  const root = await realpath(await mkdtemp(join(temporaryBase, "aperture-integration-")));
  try {
    assert(!(await realpath(root)).startsWith(await realpath(checkout)), "Consumer must be outside checkout");
    for (const dir of ["config", "data", "cache", "state", "work", "packed"]) await mkdir(join(root, dir));
    if (tarball !== undefined) {
      assert(tarball.length > 0, "APERTURE_TEST_TARBALL must name a tarball");
      const supplied = await realpath(resolve(tarball));
      tarball = join(root, "packed/candidate.tgz");
      await copyFile(supplied, tarball);
    } else {
      for (const file of packageFiles.filter(file => file.startsWith("dist/"))) {
        assert(await Bun.file(join(checkout, file)).exists(), `Build ${file} before verification`);
      }
      const packed = JSON.parse(await command(["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", join(root, "packed")], checkout, isolatedEnv(root)));
      assert.equal(packed.length, 1);
      tarball = join(root, "packed", packed[0].filename);
    }
    // Inspect the candidate itself before installation, never npm pack a supplied archive.
    const entries = (await command(["tar", "-tzf", tarball!], root, isolatedEnv(root))).trim().split("\n").sort();
    assert.deepEqual(entries, packageFiles.map(file => `package/${file}`), "Unexpected tarball contents; review allowlist explicitly");
    const files = entries.map(entry => entry.slice("package/".length));
    const manifest = JSON.parse(await command(["tar", "-xOf", tarball!, "package/package.json"], root, isolatedEnv(root)));
    assert.equal(manifest.name, packageName);
    assert.equal(manifest.version, (await Bun.file(join(checkout, "package.json")).json()).version, "Candidate version differs from source metadata");
    assert.notEqual(manifest.private, true, "Release package must not be private");
    assert.equal(manifest.license, "MIT", "Release package must declare MIT");
    assert.deepEqual(manifest.files, ["dist/index.js", "dist/bridge-worker.js", "dist/tui.js", "LICENSE", "README.md", "docs/"]);
    const license = await command(["tar", "-xOf", tarball!, "package/LICENSE"], root, isolatedEnv(root));
    assert.equal(license, await Bun.file(join(checkout, "LICENSE")).text(), "Candidate must include the approved MIT license");
    assert.equal(manifest.main.replace(/^\.\//, ""), "dist/index.js");
    assert.deepEqual(manifest.exports, { ".": "./dist/index.js", "./server": "./dist/index.js", "./tui": "./dist/tui.js" }, "Unexpected package exports");
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      assert.equal(Object.keys(manifest[field] ?? {}).length, 0, "Distribution must not declare runtime dependencies");
    }
    await Bun.write(join(root, "work/package.json"), JSON.stringify({ private: true, type: "module" }));
    await command(["npm", "install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", tarball!], join(root, "work"), isolatedEnv(root));
    const installed = join(root, "work/node_modules", packageName);
    assert((await realpath(installed)).startsWith(root));
    for (const file of new Set([...Object.values(manifest.exports) as string[], "./dist/bridge-worker.js"])) {
      assert(await Bun.file(join(installed, file)).exists(), `Missing runtime entry: ${file}`);
      const code = await Bun.file(join(installed, file)).text();
      const transpiler = new Bun.Transpiler({ loader: "js" });
      transpiler.transformSync(code);
      for (const entry of transpiler.scanImports(code)) {
        // Bun may normalize node: imports to equivalent bare builtin specifiers.
        assert(isBuiltin(entry.path)
          || (file === "./dist/bridge-worker.js" && entry.kind === "dynamic-import" && entry.path === "@jaxxstorm/bun-tailscale-bridge"),
        `Unexpected runtime import in ${file}: ${entry.path}`);
      }
      // scanImports cannot see import(expressions). The worker's modulePath is
      // an explicit user-trusted absolute JS path, validated by runtime settings.
    }
    // A separate process has neither checkout-relative resolution nor NODE_PATH.
    await command([process.execPath, "--eval", `
      const m = await import('${packageName}');
      if (Object.keys(m).join() !== 'default' || typeof m.default !== 'function') process.exit(1);
      if ((await import('${packageName}/server')).default !== m.default) process.exit(1);
      const t = await import('${packageName}/tui');
      if (Object.keys(t).join() !== 'default' || t.default?.id !== '${packageName}' || typeof t.default?.tui !== 'function') process.exit(1);
    `], join(root, "work"), isolatedEnv(root));
    return { root, installed, files };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
