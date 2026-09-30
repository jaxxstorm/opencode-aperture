export async function openEnrollmentBrowser(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || /[\s\0]/.test(url)) return false;
    const command = process.platform === "darwin" ? "/usr/bin/open" : process.platform === "linux" ? "xdg-open" : undefined;
    if (!command) return false;
    // Pass the private URL as one argument, never through a shell or diagnostic output.
    const child = Bun.spawn([command, url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        child.exited.then(code => code === 0),
        new Promise<boolean>(resolve => { timer = setTimeout(() => {
          try { child.kill(); } catch { /* The opener may already have exited. */ }
          resolve(false);
        }, 5000); }),
      ]);
    } finally { clearTimeout(timer); }
  } catch { return false; }
}
