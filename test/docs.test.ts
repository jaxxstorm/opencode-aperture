import { expect, test } from "bun:test";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { packageFiles } from "../scripts/integration-support";

const root = resolve(import.meta.dir, "..");
const docs = resolve(root, "docs");

test("Docsify has pinned assets, a sidebar, a homepage and a mobile viewport", async () => {
  const html = await readFile(resolve(docs, "index.html"), "utf8");
  expect(html).toContain('name="viewport"');
  expect(html).toContain("loadSidebar: true");
  expect(html).toContain("homepage: 'README.md'");
  expect(html).toContain("docsify@4.13.1/lib/docsify.min.js");
  expect(html).toContain("docsify@4.13.1/lib/plugins/search.min.js");
  await access(resolve(docs, ".nojekyll"));
  const sidebar = await readFile(resolve(docs, "_sidebar.md"), "utf8");
  for (const page of ["how-to-use.md", "build.md", "run-locally.md", "configuration.md", "troubleshooting.md"]) {
    expect(sidebar).toContain(`](${page})`);
  }
});

test("documentation relative links and anchors resolve inside the documentation site", async () => {
  const pages = ["README.md", "scripts/README.md", ...(await readdir(docs)).filter(file => file.endsWith(".md")).map(file => `docs/${file}`)];
  for (const page of pages) {
    const source = (await readFile(resolve(root, page), "utf8")).replace(/```[\s\S]*?```/g, "");
    for (const match of source.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const href = match[1]!;
      if (/^(?:https?:|mailto:|\/)/.test(href)) continue;
      const [path, anchor] = href.split("#");
      const target = path ? resolve(root, dirname(page), decodeURIComponent(path)) : resolve(root, page);
      if (page.startsWith("docs/")) expect(target.startsWith(docs + "/")).toBe(true);
      await access(target);
      if (anchor && target.endsWith(".md")) {
        const content = await readFile(target, "utf8");
        const headings = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map(heading => heading[1]!.toLowerCase()
          .replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-"))
          .map(slug => /^\d/.test(slug) ? `_${slug}` : slug);
        expect(headings).toContain(decodeURIComponent(anchor));
      }
    }
  }
});

test("package allowlist includes every Docsify file", async () => {
  const files = (await readdir(docs)).map(file => `docs/${file}`).sort();
  expect(packageFiles.filter(file => file.startsWith("docs/"))).toEqual(files);
  expect(packageFiles).toEqual([...packageFiles].sort());
});
