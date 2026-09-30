import { expect, spyOn, test } from "bun:test";
import { openEnrollmentBrowser } from "../src/browser";

test("browser opener passes HTTPS URL as one argument with no shell or output", async () => {
  const spawn = spyOn(Bun, "spawn").mockReturnValue({ exited: Promise.resolve(0) } as any);
  try {
    const supported = ["darwin", "linux"].includes(process.platform);
    expect(await openEnrollmentBrowser("https://login.test/private?x=1&y=2")).toBe(supported);
    if (supported) expect(spawn).toHaveBeenCalledWith([
      process.platform === "darwin" ? "/usr/bin/open" : "xdg-open", "https://login.test/private?x=1&y=2",
    ], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  } finally { spawn.mockRestore(); }
});

test("unsafe links never invoke an opener; launch errors return false", async () => {
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("private-launch-error"); });
  try {
    for (const url of ["http://login.test", "file:///tmp/link", "https://user:secret@login.test", "https://login.test/\nsecret"]) {
      expect(await openEnrollmentBrowser(url)).toBe(false);
    }
    expect(spawn).not.toHaveBeenCalled();
    expect(await openEnrollmentBrowser("https://login.test/private")).toBe(false);
  } finally { spawn.mockRestore(); }
});
