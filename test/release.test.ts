import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertVersionAvailable, checksum, releaseIdentity, verifyChecksum } from "../scripts/release";

const manifest = { name: "@jaxxstorm/opencode-aperture", version: "0.1.0" };

describe("release identity and bytes", () => {
  test("matching stable tag produces the npm tarball filename", () => {
    expect(releaseIdentity("v0.1.0", manifest)).toBe("jaxxstorm-opencode-aperture-0.1.0.tgz");
  });
  test.each(["", "0.1.0", "v01.1.0", "v0.1", "v0.1.0.0", "v0.1.0-beta.1", "v0.1.0+build", "v0.1.0\n", "v0.1.1", "refs/tags/v0.1.0"])("rejects tag %j", (tag) => {
    expect(() => releaseIdentity(tag, manifest)).toThrow();
  });
  test("rejects unexpected package and prerelease manifest", () => {
    expect(() => releaseIdentity("v0.1.0", { ...manifest, name: "another-package" })).toThrow("package name");
    expect(() => releaseIdentity("v0.1.0", { ...manifest, version: "0.1.0-beta.1" })).toThrow("package version");
    expect(() => releaseIdentity("v0.1.0\n", { ...manifest, version: "0.1.0\n" })).toThrow("stable");
  });
  test("accepts exact bytes and rejects corrupt bytes, filename, and checksum", () => {
    const bytes = new TextEncoder().encode("fixture tarball bytes");
    const recorded = checksum(bytes, "candidate.tgz");
    expect(recorded).toMatch(/^[a-f0-9]{64}  candidate\.tgz\n$/);
    expect(() => verifyChecksum(bytes, "candidate.tgz", recorded)).not.toThrow();
    expect(() => verifyChecksum(new Uint8Array([1]), "candidate.tgz", recorded)).toThrow("checksum mismatch");
    expect(() => verifyChecksum(bytes, "other.tgz", recorded)).toThrow("checksum mismatch");
    for (const invalid of ["", "not a checksum", recorded + recorded, recorded.replace(/^[a-f0-9]/, "z")]) {
      expect(() => verifyChecksum(bytes, "candidate.tgz", invalid)).toThrow("checksum mismatch");
    }
  });
});

describe("registry preflight without publication credentials", () => {
  test("only a missing version (404) permits publication", async () => {
    await assertVersionAvailable(manifest.name, manifest.version, async (url, init) => {
      expect(url).toBe("https://registry.npmjs.org/%40jaxxstorm%2Fopencode-aperture/0.1.0");
      expect(init.redirect).toBe("error");
      expect(init.headers).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(null, { status: 404 });
    });
  });
  test("existing version clearly rejects publication and GitHub release", async () => {
    await expect(assertVersionAvailable(manifest.name, manifest.version, async () => new Response("{}"))).rejects.toThrow("already exists on npm");
  });
  test.each([301, 401, 403, 429, 500, 503])("HTTP %i fails closed", async (status) => {
    await expect(assertVersionAvailable(manifest.name, manifest.version, async () => new Response(null, { status }))).rejects.toThrow(`HTTP ${status}`);
  });
  test("network failure fails closed", async () => {
    await expect(assertVersionAvailable(manifest.name, manifest.version, async () => { throw new Error("fixture network failure"); })).rejects.toThrow("fixture network failure");
  });
});

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string>; if?: string; "continue-on-error"?: boolean };
type Job = { uses?: string; needs?: string | string[]; steps?: Step[]; permissions?: Record<string, string>; env?: Record<string, string>; environment?: string; "runs-on"?: string; "timeout-minutes"?: number; if?: string; strategy?: { matrix: { os: string[] } } };
type Workflow = { on: Record<string, unknown>; jobs: Record<string, Job>; permissions: Record<string, string>; concurrency?: Record<string, unknown> };
const verify = Bun.YAML.parse(await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8")) as Workflow;
const release = Bun.YAML.parse(await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")) as Workflow;
const commands = (job: Job) => job.steps?.map((step) => step.run ?? "").join("\n") ?? "";

describe("release workflow boundaries", () => {
  test("ordinary verification is reusable, read-only, bounded, and pinned", () => {
    expect(Object.keys(verify.on).sort()).toEqual(["pull_request", "push", "workflow_call", "workflow_dispatch"]);
    expect(verify.on.push).toEqual({ branches: ["main"] });
    expect(verify.permissions).toEqual({ contents: "read" });
    expect(verify.jobs.baseline.strategy?.matrix.os).toEqual(["ubuntu-22.04", "macos-14"]);
    expect(verify.jobs.baseline.env?.OPENCODE_EXPECT_VERSION).toBe("1.18.29");
    for (const job of Object.values(verify.jobs)) {
      expect(job.permissions).toBeUndefined();
      expect(job["timeout-minutes"]).toBeGreaterThan(0);
      expect(commands(job)).not.toMatch(/npm publish|gh release|secrets\./);
      expect(job.steps?.some((step) => step.with?.["bun-version"] === "1.3.14")).toBe(true);
      expect(job.steps?.some((step) => step.with?.["node-version"] === "22.14.0")).toBe(true);
      for (const command of ["npm@11.5.1", "bun install --frozen-lockfile", "bun run typecheck", "bun test", "bun run build", "bun run test:package", "bun run test:routing", "bun scripts/verify-probe-cleanup.ts"]) expect(commands(job)).toContain(command);
    }
    expect(commands(verify.jobs.baseline)).toContain("opencode-ai@1.18.29");
  });
  test("canary input is shell data and exact version reaches both later checks", async () => {
    const job = verify.jobs.canary;
    expect(job.if).toBe("github.event_name == 'workflow_dispatch'");
    const install = job.steps!.find((step) => step.env?.OPENCODE_VERSION)!;
    expect(install.env?.OPENCODE_VERSION).toBe("${{ inputs.opencode_version || 'latest' }}");
    expect(commands(job)).not.toContain("${{");
    const root = await mkdtemp(join(tmpdir(), "aperture-release-canary-"));
    try {
      const envFile = join(root, "env");
      const input = '$(printf INJECTED >&2); "arbitrary input"';
      const child = Bun.spawn(["bash", "-euo", "pipefail", "-c", `npm() { printf '%s\\n' "$@"; }; opencode() { printf '9.8.7\\n'; };\n${install.run}`], {
        env: { ...process.env, OPENCODE_VERSION: input, GITHUB_ENV: envFile }, stdout: "pipe", stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code).toBe(0);
      expect(out).toContain(`opencode-ai@${input}`);
      expect(err).toBe("");
      expect(await readFile(envFile, "utf8")).toBe("OPENCODE_EXPECT_VERSION=9.8.7\n");
      for (const command of ["bun run test:routing", "bun scripts/verify-probe-cleanup.ts"]) {
        const step = job.steps!.find((step) => step.run === command)!;
        expect(step).toBeDefined();
        expect(step.env?.OPENCODE_EXPECT_VERSION).toBeUndefined();
        expect(job.steps!.indexOf(step)).toBeGreaterThan(job.steps!.indexOf(install));
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test("tag identity and pinned reusable baseline gate candidate and publication", () => {
    expect(release.on).toEqual({ push: { tags: ["v*"] } });
    expect(commands(release.jobs.identity)).toContain("bun scripts/release.ts identity");
    expect(release.jobs.baseline.needs).toBe("identity");
    expect(release.jobs.baseline.uses).toBe("./.github/workflows/verify.yml");
    expect(release.jobs.candidate.needs).toEqual(["identity", "baseline"]);
    expect(release.jobs.publish.needs).toEqual(["identity", "baseline", "candidate"]);
    for (const job of Object.values(release.jobs)) {
      expect(job.if).toBeUndefined();
      for (const step of job.steps ?? []) {
        expect(step["continue-on-error"]).toBeUndefined();
        if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"]).toBe(false);
      }
    }
  });
  test("one checksummed candidate is exercised and retained for recovery", () => {
    const job = release.jobs.candidate;
    const run = commands(job);
    expect(run.match(/bun run pack/g)).toHaveLength(1);
    expect(run.indexOf("release.ts identity")).toBeLessThan(run.indexOf("bun run pack"));
    const ordered = ["bun run pack", "release.ts checksum", "bun run test:package", "bun run test:routing", "verify-probe-cleanup.ts", "release.ts verify"];
    for (let i = 1; i < ordered.length; i++) expect(run.indexOf(ordered[i])).toBeGreaterThan(run.indexOf(ordered[i - 1]));
    expect(run).toContain('"$APERTURE_TEST_TARBALL"');
    expect(run).toContain("GITHUB_STEP_SUMMARY");
    const upload = job.steps!.find((step) => step.uses?.startsWith("actions/upload-artifact@"))!;
    expect(upload.with).toEqual({ name: "release-candidate", path: "release-artifacts/*", "if-no-files-found": "error", "retention-days": 90 });
    expect(job.steps!.indexOf(upload)).toBe(job.steps!.length - 1);
  });
  test("only approval-gated publish has write permissions, with no token fallback", () => {
    expect(release.permissions).toEqual({ contents: "read" });
    expect(release.concurrency).toEqual({ group: "npm-release", "cancel-in-progress": false });
    for (const [name, job] of Object.entries(release.jobs)) {
      if (name !== "publish") expect(job.permissions).toBeUndefined();
      if (!job.uses) expect(job["timeout-minutes"]).toBeGreaterThan(0);
    }
    const job = release.jobs.publish;
    expect(job.environment).toBe("npm");
    expect(job["runs-on"]).toBe("ubuntu-22.04");
    expect(job.permissions).toEqual({ contents: "write", "id-token": "write" });
    expect(JSON.stringify(release)).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/);
    expect(job.steps!.some((step) => step.with?.["node-version"] === "22.14.0")).toBe(true);
    expect(commands(job)).toContain("npm@11.5.1");
  });
  test("download and checksum precede conflict check, publish, then GitHub release", () => {
    const job = release.jobs.publish;
    const steps = job.steps!;
    const download = steps.findIndex((step) => step.uses?.startsWith("actions/download-artifact@"));
    expect(steps[download].with).toEqual({ name: "release-candidate", path: "release-artifacts" });
    const ordered = ["release.ts identity", "release.ts verify", "release.ts available", 'npm publish "$APERTURE_TEST_TARBALL"', 'gh release create "$GITHUB_REF_NAME"'];
    let previous = download;
    for (const command of ordered) {
      const index = steps.findIndex((step) => step.run?.includes(command));
      expect(index).toBeGreaterThan(previous);
      expect(steps[index].if).toBeUndefined();
      previous = index;
    }
    const run = commands(job);
    expect(run).not.toMatch(/bun run (build|pack)|npm pack|bun install/);
    expect(run).toContain('--ignore-scripts --access public --provenance --registry=https://registry.npmjs.org');
    expect(run).toContain('"$APERTURE_TEST_TARBALL" "$APERTURE_TEST_TARBALL.sha256" --verify-tag');
  });
});
