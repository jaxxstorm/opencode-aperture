import { copyFile, mkdtemp, mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

export const packageName = "@jaxxstorm/opencode-aperture";
export const packageFiles = ["LICENSE", "README.md", "dist/index.js", "docs/compatibility.md", "docs/live-validation.md", "docs/release.md", "docs/verification.md", "package.json"];
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
      assert(await Bun.file(join(checkout, "dist/index.js")).exists(), "Build dist/index.js before verification");
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
    assert.deepEqual([...manifest.files].sort(), ["LICENSE", "README.md", "dist/index.js", "docs/"]);
    const license = await command(["tar", "-xOf", tarball!, "package/LICENSE"], root, isolatedEnv(root));
    assert.equal(license, await Bun.file(join(checkout, "LICENSE")).text(), "Candidate must include the approved MIT license");
    assert.equal(manifest.main.replace(/^\.\//, ""), "dist/index.js");
    const entry = typeof manifest.exports === "string" ? manifest.exports : manifest.exports["."];
    assert.equal(entry.replace(/^\.\//, ""), "dist/index.js");
    assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, "Distribution must be self-contained");
    await Bun.write(join(root, "work/package.json"), JSON.stringify({ private: true, type: "module" }));
    await command(["npm", "install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", tarball!], join(root, "work"), isolatedEnv(root));
    const installed = join(root, "work/node_modules", packageName);
    assert((await realpath(installed)).startsWith(root));
    const imports = new Bun.Transpiler({ loader: "js" }).scanImports(await Bun.file(join(installed, "dist/index.js")).text());
    assert.equal(imports.length, 0, "Self-contained factory must not resolve runtime imports");
    // A separate process has neither checkout-relative resolution nor NODE_PATH.
    await command([process.execPath, "--eval", `const m = await import('${packageName}'); if (Object.keys(m).join() !== 'default' || typeof m.default !== 'function') process.exit(1)`], join(root, "work"), isolatedEnv(root));
    return { root, installed, files };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
