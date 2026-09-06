import { rm } from "node:fs/promises";
import { consumer } from "./integration-support";

try {
  const result = await consumer();
  try { console.log(JSON.stringify({ check: "packed-clean-consumer", status: "pass", files: result.files })); }
  finally { await rm(result.root, { recursive: true, force: true }); }
} catch {
  console.error("FAIL: packed clean-consumer verification; check build, package entrypoints and exact allowlist (raw subprocess output withheld)");
  process.exitCode = 1;
}
