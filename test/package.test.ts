import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { checkout, command, isolatedEnv, packageFiles, temporaryBase } from "../scripts/integration-support";

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

test.each([
  ["valid", ""],
  ["missing-license", "Unexpected tarball contents"],
  ["extra-file", "Unexpected tarball contents"],
  ["private", "must not be private"],
  ["license-metadata", "must declare MIT"],
  ["license-text", "approved MIT license"],
  ["version", "differs from source metadata"],
  ["extra-export", "Unexpected package exports"],
  ["missing-bridge", "Unexpected optional dependencies"],
  ["bridge-range", "Unexpected optional dependencies"],
  ["bridge-version", "Unexpected optional dependencies"],
  ["extra-optional", "Unexpected optional dependencies"],
  ["dependency", "must not declare dependencies"],
  ["peer", "must not declare dependencies"],
  ["bundled", "must not bundle dependencies"],
  ["bundle-alias", "must not bundle dependencies"],
  ["bundle-all", "must not bundle dependencies"],
  ["secret-file", "Unexpected tarball contents"],
  ["invalid-archive", "failed"],
])("supplied candidate: %s, with bounded consumer cleanup", async (scenario, error) => {
  root = await mkdtemp(join(temporaryBase, "aperture-package-fixture-"));
  const audit = join(root, "audit");
  await mkdir(audit);
  const manifest = await Bun.file(join(checkout, "package.json")).json();
  manifest.optionalDependencies = { "@jaxxstorm/bun-tailscale-bridge": "0.1.0" };
  if (scenario === "missing-bridge") delete manifest.optionalDependencies;
  if (scenario === "bridge-range") manifest.optionalDependencies["@jaxxstorm/bun-tailscale-bridge"] = "^0.1.0";
  if (scenario === "bridge-version") manifest.optionalDependencies["@jaxxstorm/bun-tailscale-bridge"] = "0.1.1";
  if (scenario === "extra-optional") manifest.optionalDependencies.unexpected = "1.0.0";
  if (scenario === "dependency") manifest.dependencies = { "@jaxxstorm/bun-tailscale-bridge": "0.1.0" };
  if (scenario === "peer") manifest.peerDependencies = { unexpected: "1.0.0" };
  if (scenario === "bundled") manifest.bundledDependencies = ["@jaxxstorm/bun-tailscale-bridge"];
  if (scenario === "bundle-alias") manifest.bundleDependencies = ["unexpected"];
  if (scenario === "bundle-all") manifest.bundledDependencies = true;
  if (scenario === "private") manifest.private = true;
  if (scenario === "license-metadata") delete manifest.license;
  if (scenario === "version") manifest.version = "999.0.0";
  if (scenario === "extra-export") manifest.exports["./worker"] = "./dist/bridge-worker.js";
  // This bundle differs from dist/index.js, so a repack of the checkout cannot pass.
  const bundle = 'export default async () => ({ fixture: "supplied-tarball-only" });\n';
  const entries: Record<string, string> = Object.fromEntries(packageFiles.map(file => [file, "fixture documentation\n"]));
  entries["package.json"] = JSON.stringify(manifest);
  entries["dist/index.js"] = bundle;
  entries["dist/bridge-worker.js"] = 'await import("@jaxxstorm/bun-tailscale-bridge");\n';
  entries["dist/tui.js"] = 'export default { id: "@jaxxstorm/opencode-aperture", async tui() {} };\n';
  entries.LICENSE = scenario === "license-text" ? "not the approved license" : await Bun.file(join(checkout, "LICENSE")).text();
  if (scenario === "missing-license") delete entries.LICENSE;
  if (scenario === "extra-file") entries["unexpected.txt"] = "not for distribution";
  if (scenario === "secret-file") entries[".env"] = "FIXTURE_SECRET=not-a-real-secret";
  for (const [file, content] of Object.entries(entries)) await Bun.write(join(root, "package", file), content);
  const tarball = join(root, "supplied candidate.tgz");
  if (scenario === "invalid-archive") await Bun.write(tarball, "not a gzip archive");
  else await command(["tar", "-czf", tarball, "-C", root, ...Object.keys(entries).map(file => `package/${file}`)], root, isolatedEnv(root));
  const before = await Bun.file(tarball).arrayBuffer();
  await command([process.execPath, "--eval", `
    import assert from "node:assert/strict";
    import { rm } from "node:fs/promises";
    import { pathToFileURL } from "node:url";
    const { consumer } = await import(${JSON.stringify(join(checkout, "scripts/integration-support.ts"))});
    const expected = ${JSON.stringify(error)};
    if (expected) {
      await assert.rejects(() => consumer(), error => error.message.includes(expected));
    } else {
      const result = await consumer();
      try {
        assert.equal(await Bun.file(result.root + "/work/node_modules/@jaxxstorm/bun-tailscale-bridge/package.json").exists(), false);
        const entry = result.installed + "/dist/index.js";
        assert.equal(await Bun.file(entry).text(), ${JSON.stringify(bundle)});
        const factory = (await import(pathToFileURL(entry).href)).default;
        assert.equal((await factory()).fixture, "supplied-tarball-only");
      } finally { await rm(result.root, { recursive: true, force: true }); }
    }
  `], root, { ...isolatedEnv(root), APERTURE_TEST_TMPDIR: audit, APERTURE_TEST_TARBALL: tarball });
  expect(await readdir(audit)).toEqual([]);
  expect(await Bun.file(tarball).arrayBuffer()).toEqual(before);
}, 30_000);
