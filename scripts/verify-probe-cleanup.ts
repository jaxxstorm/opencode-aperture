import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { checkout, temporaryBase } from "./integration-support";

const root = await mkdtemp(join(temporaryBase, "aperture-cleanup-audit-"));
let checkpoint = "startup";
try {
  for (const flag of ["--fail-after-start", "--interrupt-after-start"]) {
    const child = Bun.spawn([process.execPath, "scripts/probe-routing.ts", flag], {
      cwd: checkout, env: { PATH: process.env.PATH, APERTURE_TEST_TMPDIR: root, APERTURE_TEST_TARBALL: process.env.APERTURE_TEST_TARBALL, OPENCODE_BIN: process.env.OPENCODE_BIN, OPENCODE_EXPECT_VERSION: process.env.OPENCODE_EXPECT_VERSION, APERTURE_PUBLIC_CACHE: process.env.APERTURE_PUBLIC_CACHE }, stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 130_000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      checkpoint = "exit-code";
      assert.equal(code, flag === "--fail-after-start" ? 1 : 130);
      checkpoint = "injected-failure";
      assert(stderr.includes('"phase":"text"'), "Failure must be injected after startup, not during preparation");
      assert(stderr.includes('"injected":true'));
      checkpoint = "cleanup-result";
      assert(stdout.includes('"storageRemoved":true,"childStopped":true'));
      assert(stdout.includes('"listenersStopped":true'));
      checkpoint = "temporary-directory";
      assert.deepEqual(await readdir(root), []);
      console.log(JSON.stringify({ check: flag, status: "pass" }));
    } finally { clearTimeout(timer); clearTimeout(killTimer); }
  }
} catch {
  console.error("FAIL: cleanup verification", checkpoint, "(raw child output withheld)");
  process.exitCode = 1;
} finally { await rm(root, { recursive: true, force: true }); }
