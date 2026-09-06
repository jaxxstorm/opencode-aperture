# Verification Scripts

See [developer verification](../docs/verification.md) for prerequisites, commands,
synthetic HOME/XDG isolation, and the distinction between passed and pending checks.
The harness uses stock OpenCode with ordinary POSIX process spawning; it does not
enforce or trace network egress. The cleanup verifier remains part of verification.

Set `APERTURE_TEST_TARBALL` to an absolute candidate tarball path for
`bun run test:package`, `bun run test:routing`, and
`bun scripts/verify-probe-cleanup.ts` to inspect/install the same artifact without
repacking. Unset it to restore ordinary pack-from-checkout checks. See the
[release procedure](../docs/release.md) for checksum, approval, and recovery steps;
these verification scripts do not publish.
