import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { newEntry, serializeEntry } from "../src/admin/content.ts";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const site = "https://y4ho0.github.io";
const body = [
  "## Serializer integration",
  "",
  "This **published Markdown** survives the actual Astro pipeline.",
  "",
  "| Feature | Value |", "| --- | --- |", "| Serializer | 中文正文 |",
  "",
  "Inline $x^2$ and display math:", "", "$$", "\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}", "$$",
  "",
  ':::theorem{title="Serializer theorem"}', "A semantic block from the shared plugin.", ":::",
  "",
  "```javascript", 'const fixture = "Astro serialization";', "```", "",
].join("\n");

function fixture(collection, id, data = {}) {
  const entry = newEntry(collection);
  entry.id = id;
  entry.data = {
    ...entry.data,
    title: `CMS fixture ${id}`, description: `摘要 ${id}`, updatedAt: "2026-10-21",
    publishedAt: "2026-10-20", draft: false, tags: ["integration", "中文"], ...data,
  };
  entry.body = body;
  return entry;
}

async function optionalFile(filename) {
  try {
    return await readFile(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

test("CMS-serialized heterogeneous entries build real Astro routes, math, directives, RSS and sitemap", { timeout: 45_000 }, async () => {
  const sharedStore = path.join(root, "node_modules", ".astro", "data-store.json");
  const originalStore = await optionalFile(sharedStore);
  const project = await mkdtemp(path.join(tmpdir(), "garden-admin-astro-"));
  try {
    // Copy only build inputs. Existing repository articles cannot leak into this fixture build.
    await cp(path.join(root, "src"), path.join(project, "src"), {
      recursive: true,
      filter: (source) => !source.startsWith(path.join(root, "src", "content") + path.sep)
        || !/\.(?:md|mdx)$/u.test(source),
    });
    await cp(path.join(root, "public"), path.join(project, "public"), { recursive: true });
    for (const file of ["tsconfig.json", "package.json"]) {
      await cp(path.join(root, file), path.join(project, file));
    }
    await cp(path.join(root, "astro.config.mjs"), path.join(project, "astro.config.original.mjs"));
    // node_modules is shared below: never put Astro's content store or Vite cache inside it.
    await writeFile(path.join(project, "astro.config.mjs"), [
      'import config from "./astro.config.original.mjs";',
      'import { fileURLToPath } from "node:url";',
      "export default {",
      "  ...config,",
      '  cacheDir: fileURLToPath(new URL("./.cache/astro/", import.meta.url)),',
      '  vite: { ...config.vite, cacheDir: fileURLToPath(new URL("./.cache/vite/", import.meta.url)) },',
      "};", "",
    ].join("\n"));
    await symlink(path.join(root, "node_modules"), path.join(project, "node_modules"), "dir");
    await mkdir(path.join(project, "public", "data"), { recursive: true });
    await writeFile(path.join(project, "public", "data", "daily-quote.json"), JSON.stringify({
      date: "2026-10-21", text: "", author: null, source: null, language: "en", status: "hidden",
      provider: null, providerUrl: null,
    }));

    const course = "integration-course";
    const entries = [
      fixture("courses", course),
      fixture("notes", "linked-note", { course, feed: true }),
      fixture("notes", "standalone-note", { feed: false }),
      fixture("labs", "linked-lab", { course }),
      fixture("labs", "standalone-lab"),
      fixture("projects", "linked-project", { course }),
      fixture("essays", "serializer-essay", { related: [{ collection: "notes", entry: "linked-note" }] }),
      fixture("notes", "unpublished-draft", { course, feed: true, draft: true }),
    ];
    for (const entry of entries) {
      const directory = path.join(project, "src", "content", entry.collection);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `${entry.id}.md`), serializeEntry(entry));
    }

    const astroPackage = JSON.parse(await readFile(path.join(root, "node_modules", "astro", "package.json"), "utf8"));
    const astro = path.join(root, "node_modules", "astro", astroPackage.bin.astro);
    try {
      // No npm scripts or quote provider run here; the installed dependencies and assets suffice.
      await execute(process.execPath, [astro, "build"], {
        cwd: project, timeout: 40_000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", CI: "true", NO_COLOR: "1" },
      });
    } catch (error) {
      assert.fail(`Fixture Astro build failed:\n${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message}`);
    }

    await access(path.join(project, ".cache", "astro", "data-store.json"));
    const dist = path.join(project, "dist");
    const routes = [
      `/courses/${course}/`, `/courses/${course}/notes/linked-note/`, "/garden/standalone-note/",
      `/courses/${course}/labs/linked-lab/`, "/labs/standalone-lab/",
      `/courses/${course}/projects/linked-project/`, "/essays/serializer-essay/",
    ];
    for (const route of routes) {
      const html = await readFile(path.join(dist, route.slice(1), "index.html"), "utf8");
      assert.ok(html.includes(`rel="canonical" href="${site}${route}"`), route);
      assert.match(html, /<strong>published Markdown<\/strong>/u, route);
      assert.match(html, /<table>/u, route);
      assert.match(html, /中文正文/u, route);
      assert.match(html, /class="katex"/u, route);
      assert.match(html, /<math\b/u, route);
      assert.match(html, /content-block--theorem/u, route);
      assert.match(html, /aria-label="Serializer theorem"/u, route);
      assert.match(html, /astro-code/u, "production code rendering must use the existing Shiki pipeline");
    }
    const courseHtml = await readFile(path.join(dist, "courses", course, "index.html"), "utf8");
    for (const id of ["linked-note", "linked-lab", "linked-project"]) assert.ok(courseHtml.includes(`CMS fixture ${id}`));
    const essayHtml = await readFile(path.join(dist, "essays", "serializer-essay", "index.html"), "utf8");
    assert.ok(essayHtml.includes(`href="/courses/${course}/notes/linked-note/"`), "related metadata must resolve through Astro references");
    const draftRoute = `/courses/${course}/notes/unpublished-draft/`;
    await assert.rejects(access(path.join(dist, draftRoute.slice(1), "index.html")), { code: "ENOENT" });
    const archive = await readFile(path.join(dist, "archive", "index.html"), "utf8");
    assert.equal(archive.includes("CMS fixture unpublished-draft"), false);

    const rss = await readFile(path.join(dist, "rss.xml"), "utf8");
    const rssLinks = [...rss.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/gu)].map((match) => match[1]);
    const expectedFeed = routes.filter((route) => ![`/courses/${course}/`, "/garden/standalone-note/"].includes(route));
    assert.deepEqual(rssLinks.sort(), expectedFeed.map((route) => site + route).sort());
    assert.equal(rss.includes("unpublished-draft"), false, "feed=true cannot publish a draft");

    const sitemap = await readFile(path.join(dist, "sitemap.xml"), "utf8");
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
    const staticRoutes = ["/", "/garden/", "/courses/", "/labs/", "/essays/", "/archive/", "/search/", "/about/"];
    assert.deepEqual(locations.sort(), [...staticRoutes, ...routes].map((route) => site + route).sort());
    assert.equal(sitemap.includes("/admin/"), false);
    assert.equal(sitemap.includes("unpublished-draft"), false);
  } finally {
    await rm(project, { recursive: true, force: true });
    assert.deepEqual(await optionalFile(sharedStore), originalStore,
      "fixture builds must preserve the repository content cache byte-for-byte, including its absence");
  }
});
