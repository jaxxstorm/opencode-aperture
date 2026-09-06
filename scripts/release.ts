import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

export function releaseIdentity(tag: string, manifest: { name: string; version: string }) {
  assert(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag) && tag === tag.trim(), "Release tag must be stable vMAJOR.MINOR.PATCH (no prerelease or build suffix)");
  assert.equal(tag.slice(1), manifest.version, "Release tag does not match package version");
  assert.equal(manifest.name, "@jaxxstorm/opencode-aperture", "Unexpected release package name");
  return `jaxxstorm-opencode-aperture-${manifest.version}.tgz`;
}

export function checksum(bytes: Uint8Array, filename: string) {
  return `${createHash("sha256").update(bytes).digest("hex")}  ${basename(filename)}\n`;
}

export function verifyChecksum(bytes: Uint8Array, filename: string, recorded: string) {
  assert.equal(recorded, checksum(bytes, filename), "Release artifact SHA-256 checksum mismatch (or invalid checksum file)");
}

export async function assertVersionAvailable(
  name: string,
  version: string,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  const response = await request(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return;
  if (response.ok) throw new Error(`${name}@${version} already exists on npm; refusing to publish or create a GitHub release`);
  throw new Error(`Cannot establish npm version availability: HTTP ${response.status}; only 404 permits publication`);
}

// Importing this module for fixture tests performs no filesystem or network work.
if (import.meta.main) {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const filename = releaseIdentity(process.env.GITHUB_REF_NAME ?? "", manifest);
  const tarball = resolve("release-artifacts", filename);
  switch (process.argv[2]) {
    case "identity":
      if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `APERTURE_TEST_TARBALL=${tarball}\n`);
      console.log(`${manifest.name}@${manifest.version}: ${filename}`);
      break;
    case "checksum":
      await writeFile(`${tarball}.sha256`, checksum(await readFile(tarball), filename));
      break;
    case "verify":
      verifyChecksum(await readFile(tarball), filename, await readFile(`${tarball}.sha256`, "utf8"));
      console.log(`Verified ${filename}`);
      break;
    case "available":
      await assertVersionAvailable(manifest.name, manifest.version);
      break;
    default:
      throw new Error("Usage: bun scripts/release.ts identity|checksum|verify|available");
  }
}
