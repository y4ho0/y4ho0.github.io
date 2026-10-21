import { test, expect, type Page } from "@playwright/test";

// Every GitHub request is intercepted. These tests never use a real credential or repository write.
const TOKEN = "github_pat_FAKE_BROWSER_TEST_TOKEN_123456789";
const REPO = "/repos/y4ho0/y4ho0.github.io";
const OLD_SHA = "1".repeat(40);
const NEW_SHA = "2".repeat(40);
const COMMIT_SHA = "3".repeat(40);
const OTHER_SHA = "4".repeat(40);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64");

type File = { source: string | Buffer; sha: string };
type Write = { path: string; body: Record<string, any>; authorization?: string };

function article(title = "Existing essay", extra = "", body = "## Remote original\n\nExisting content.\n"): File {
  return { sha: OLD_SHA, source: `---\ntitle: ${title}\ndescription: Existing description\npublishedAt: 2026-01-02T12:30:45.123+08:00\nupdatedAt: 2026-10-21T12:30:45.123+08:00\ntags: [existing]\nstatus: growing\ndraft: false\nrelated: []\ncustomMeta:\n  preserved: true\n${extra}---\n\n${body}` };
}

async function mockGitHub(page: Page, initial: Record<string, File> = {}) {
  const state = {
    files: new Map(Object.entries(initial)), requests: [] as { method: string; path: string; authorization?: string }[],
    puts: [] as Write[], deletes: [] as Write[], invalidToken: false, writePermission: true,
    putStatus: 200, treeStatus: 200, deployment: "pending" as "pending" | "success" | "failure",
  };
  await page.route("https://api.github.com/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname);
    const method = request.method();
    const authorization = request.headers().authorization;
    state.requests.push({ method, path, authorization });
    const reply = (status: number, data: unknown) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(data),
      headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, accept, x-github-api-version, content-type", "access-control-allow-methods": "GET, PUT, DELETE, OPTIONS" },
    });
    if (method === "OPTIONS") return reply(200, {});
    if (path === "/user") return state.invalidToken ? reply(401, { message: "Bad credentials" }) : reply(200, { login: "test-owner" });
    if (path === REPO) return reply(200, { full_name: "y4ho0/y4ho0.github.io", permissions: { push: state.writePermission }, allow_merge_commit: true, archived: false, disabled: false });
    if (path === `${REPO}/git/trees/main`) {
      if (state.treeStatus !== 200) return reply(state.treeStatus, { message: "Unavailable" });
      return reply(200, { truncated: false, tree: [...state.files].map(([filePath, file]) => ({ path: filePath, sha: file.sha, type: "blob" })) });
    }
    if (path === `${REPO}/actions/workflows/deploy.yml/runs`) return reply(200, { workflow_runs: [{ id: 123, head_sha: COMMIT_SHA, head_branch: "main", event: "push", status: state.deployment === "pending" ? "in_progress" : "completed", conclusion: state.deployment === "pending" ? null : state.deployment }] });
    if (path === `${REPO}/actions/runs/123/jobs`) return reply(200, { jobs: [{ name: "Deploy to GitHub Pages", status: state.deployment === "pending" ? "queued" : "completed", conclusion: state.deployment === "pending" ? null : state.deployment }] });
    const prefix = `${REPO}/contents/`;
    if (path.startsWith(prefix)) {
      const filePath = path.slice(prefix.length);
      const current = state.files.get(filePath);
      if (method === "GET") {
        if (!current) return reply(404, { message: "Not Found" });
        const bytes = Buffer.from(current.source);
        return reply(200, { type: "file", path: filePath, sha: current.sha, size: bytes.length, encoding: "base64", content: bytes.toString("base64") });
      }
      if (method === "PUT") {
        const body = request.postDataJSON(); state.puts.push({ path: filePath, body, authorization });
        if (state.putStatus !== 200) return reply(state.putStatus, { message: "Write failed" });
        if (current && body.sha !== current.sha) return reply(409, { message: "Conflict" });
        const bytes = Buffer.from(body.content, "base64");
        state.files.set(filePath, { sha: NEW_SHA, source: filePath.startsWith("src/") ? bytes.toString("utf8") : bytes });
        return reply(current ? 200 : 201, { content: { sha: NEW_SHA }, commit: { sha: COMMIT_SHA } });
      }
      if (method === "DELETE") {
        const body = request.postDataJSON(); state.deletes.push({ path: filePath, body, authorization });
        if (!current || current.sha !== body.sha) return reply(409, { message: "Conflict" });
        state.files.delete(filePath);
        return reply(200, { content: null, commit: { sha: COMMIT_SHA } });
      }
    }
    // Fail closed if implementation starts using an unexpected API endpoint.
    return reply(501, { message: `Unexpected mocked endpoint: ${method} ${path}` });
  });
  return state;
}

async function openAdmin(page: Page) {
  await page.goto("/admin/");
  await expect(page.locator("#entry-path")).toContainText("新文件 →");
}

async function login(page: Page) {
  await page.locator("#token").fill(TOKEN);
  await page.getByRole("button", { name: "连接 GitHub", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("已验证账号");
  await expect(page.locator("#publish")).toBeEnabled();
}

async function openArticle(page: Page, title = "Existing essay") {
  await page.locator("#entry-list button").filter({ hasText: title }).click();
  await expect(page.locator("#editor-heading")).toHaveText("编辑文章");
}

async function confirm(page: Page) {
  await expect(page.locator("#confirm-dialog")).toBeVisible();
  await page.locator('#confirm-dialog button[value="confirm"]').click();
}

async function storedDocuments(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const request = indexedDB.open("garden-admin-local-drafts", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("drafts")) { database.close(); resolve([]); return; }
        const transaction = database.transaction("drafts", "readonly");
        const all = transaction.objectStore("drafts").getAll();
        transaction.oncomplete = () => { database.close(); resolve(all.result); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    return JSON.stringify({ localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage }, drafts: values });
  });
}

test("unauthenticated access and rejected tokens never enable repository writes", async ({ page }) => {
  const api = await mockGitHub(page);
  await openAdmin(page);
  await expect(page.locator("#publish")).toBeDisabled();
  await expect(page.locator("#upload")).toBeDisabled();
  expect(api.requests).toHaveLength(0);
  await page.locator("#token").fill("short");
  await page.getByRole("button", { name: "连接 GitHub", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("令牌格式无效");
  expect(api.requests).toHaveLength(0);
  api.invalidToken = true;
  await page.locator("#token").fill(TOKEN);
  await page.getByRole("button", { name: "连接 GitHub", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("令牌无效或已过期");
  await expect(page.locator("#token")).toHaveValue("");
  api.invalidToken = false; api.writePermission = false;
  await page.locator("#token").fill(TOKEN);
  await page.getByRole("button", { name: "连接 GitHub", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("无法确认此令牌");
  await expect(page.locator("#publish")).toBeDisabled();
  await expect(page.locator("#logout")).toBeHidden();
  expect(api.requests.some(request => request.path.endsWith("/git/trees/main"))).toBe(false);
  expect(api.puts).toHaveLength(0);
});

test("local drafts recover after reload while token disappears from all browser stores", async ({ page }) => {
  const api = await mockGitHub(page);
  await openAdmin(page); await login(page);
  await page.locator('[name="title"]').fill("离线草稿");
  await page.locator('[name="description"]').fill("只有此浏览器保存");
  await page.locator('[name="id"]').fill("local-note");
  await page.locator("#markdown").fill("## 仍未提交\n\n只在 IndexedDB。");
  await page.locator("#save-draft").click();
  await expect(page.locator("#notice")).toContainText("没有提交 GitHub");
  const stored = await storedDocuments(page);
  expect(stored).toContain("离线草稿");
  expect(stored).not.toContain(TOKEN);
  expect(page.url()).not.toContain(TOKEN);
  expect(api.puts).toHaveLength(0);
  await page.reload();
  await expect(page.locator("#publish")).toBeDisabled();
  await expect(page.locator("#login-form")).toBeVisible();
  await page.locator("#draft-list button").filter({ hasText: "离线草稿" }).click();
  await expect(page.locator('[name="title"]')).toHaveValue("离线草稿");
  await expect(page.locator("#markdown")).toHaveValue("## 仍未提交\n\n只在 IndexedDB。");
  await expect(page.locator('[name="draft"]')).toBeChecked();
  await login(page);
  await page.locator("#logout").click();
  await expect(page.locator("#publish")).toBeDisabled();
  expect(await storedDocuments(page)).not.toContain(TOKEN);
});

test("restoring the active draft keeps edits newer than the saved list snapshot", async ({ page }) => {
  await mockGitHub(page); await openAdmin(page);
  await page.locator('[name="title"]').fill("Current draft");
  await page.locator("#markdown").fill("## Saved snapshot");
  await page.locator("#save-draft").click();
  await expect(page.locator("#notice")).toContainText("草稿已保存");
  // Stop autosave from refreshing the list before this regression can exercise its stale callback.
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.locator("#markdown").fill("## Newest in-memory text\n\nDo not replace me with the old snapshot.");
  await page.locator("#draft-list button").filter({ hasText: "Current draft" }).click();
  await expect(page.locator("#markdown")).toHaveValue("## Newest in-memory text\n\nDo not replace me with the old snapshot.");
  expect(await storedDocuments(page)).toContain("Do not replace me with the old snapshot.");
});

test("split preview renders GFM, highlighted code and math while hostile HTML cannot execute", async ({ page }) => {
  await mockGitHub(page); await openAdmin(page);
  await expect(page.locator("#writing-area")).toHaveAttribute("data-layout", "split");
  await page.evaluate(() => { (window as any).__adminXss = 0; });
  const markdown = [
    "## Live heading", "", "**Strong** and *emphasis* with `inline`.", "", "- first", "- second", "", "> quotation", "",
    "| A | B |", "| --- | --- |", "| 1 | 2 |", "", "```js", "const answer = 42;", "```", "", "$E = mc^2$", "", "$$x^2 + y^2$$", "",
    "[Safe link](https://example.com)", "", "<script>parent.__adminXss = 1</script>",
    '<img src="x" onerror="parent.__adminXss = 2">', "[Unsafe link](javascript:parent.__adminXss=3)",
  ].join("\n");
  await page.locator("#markdown").fill(markdown);
  const preview = page.frameLocator("#preview");
  await expect(preview.getByRole("heading", { name: "Live heading" })).toBeVisible();
  await expect(preview.locator("table th")).toHaveCount(2);
  await expect(preview.locator("strong")).toHaveText("Strong");
  await expect(preview.locator("blockquote")).toContainText("quotation");
  await expect(preview.locator(".hljs-keyword")).toContainText("const");
  await expect(preview.locator(".katex")).toHaveCount(2);
  await expect(preview.locator("script,[onerror],a[href^='javascript:']")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__adminXss)).toBe(0);
  await expect(page.locator("#preview")).toHaveAttribute("sandbox", "");
  const separator = page.locator("#splitter");
  await separator.focus(); await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "52");
  await page.locator("#markdown").fill("## Updated live\n\nContent changed.");
  await expect(preview.getByRole("heading", { name: "Updated live" })).toBeVisible();
});

test("tab switching keeps one editor, text, selection and scroll; narrow screens restore wide preference", async ({ page }) => {
  await mockGitHub(page); await openAdmin(page);
  const body = Array.from({ length: 120 }, (_, index) => `Line ${index}: writing position`).join("\n");
  await page.locator("#markdown").fill(body);
  await page.locator("#layout-tabs").click();
  const original = await page.locator("#markdown").evaluate((element: HTMLTextAreaElement) => {
    (window as any).__originalEditor = element;
    element.focus(); element.setSelectionRange(150, 180, "backward"); element.scrollTop = 650;
    return { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, scroll: element.scrollTop };
  });
  expect(original.scroll).toBeGreaterThan(0);
  await page.locator("#tab-preview").click();
  await expect(page.locator("#markdown")).toBeHidden();
  await expect(page.locator("#preview")).toBeVisible();
  await page.locator("#tab-edit").click();
  await expect(page.locator("#markdown")).toHaveValue(body);
  const restored = await page.locator("#markdown").evaluate((element: HTMLTextAreaElement) => ({
    sameNode: (window as any).__originalEditor === element,
    start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, scroll: element.scrollTop,
  }));
  expect(restored).toEqual({ sameNode: true, ...original });
  await page.locator("#layout-split").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#writing-area")).toHaveAttribute("data-layout", "tabs");
  expect(await page.evaluate(() => localStorage.getItem("garden-admin-layout"))).toBe("split");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await expect(page.locator("#writing-area")).toHaveAttribute("data-layout", "split");
  await expect(page.locator("#markdown")).toHaveValue(body);
});

test("creating an article requires confirmation and sends valid Markdown only after approval", async ({ page }) => {
  const api = await mockGitHub(page); await openAdmin(page); await login(page);
  await page.locator('[name="title"]').fill("New article");
  await page.locator('[name="description"]').fill("New article description");
  await page.locator('[name="collection"]').selectOption("essays");
  await page.locator('[name="id"]').fill("new-article");
  await page.locator('[name="tags"]').fill("math, writing");
  await page.locator('[name="draft"]').uncheck();
  await page.locator("#markdown").fill("## Public content\n\nReady to publish.");
  await page.locator("#publish").click();
  await expect(page.locator("#confirm-text")).toContainText("/essays/new-article/");
  expect(api.puts).toHaveLength(0);
  await page.locator('#confirm-dialog button[value="cancel"]').click();
  await expect(page.locator("#publish")).toBeEnabled();
  expect(api.puts).toHaveLength(0);
  await page.locator("#publish").click(); await confirm(page);
  await expect(page.locator("#result-text")).toContainText("GitHub 提交成功");
  expect(api.puts).toHaveLength(1);
  const write = api.puts[0];
  expect(write.path).toBe("src/content/essays/new-article.md");
  expect(write.body.branch).toBe("main");
  expect(write.body.sha).toBeUndefined();
  expect(write.authorization).toBe(`Bearer ${TOKEN}`);
  const source = Buffer.from(write.body.content, "base64").toString("utf8");
  expect(source).toContain("title: New article");
  expect(source).toContain("draft: false");
  expect(source).toContain("publishedAt:");
  expect(source).toContain("## Public content");
  await expect(page.locator("#deploy-status")).toContainText("提交成功不等于网站已更新");
});

test("editing preserves path, SHA and unknown metadata and distinguishes deployment from commit", async ({ page }) => {
  const path = "src/content/essays/existing-essay.md";
  const api = await mockGitHub(page, { [path]: article() });
  await openAdmin(page); await login(page); await openArticle(page);
  await expect(page.locator('[name="id"]')).toBeDisabled();
  await expect(page.locator('[name="collection"]')).toBeDisabled();
  await expect(page.locator('[name="course"]')).toBeDisabled();
  await expect(page.locator('[name="status"]')).toHaveValue("growing");
  await page.locator('[name="status"]').selectOption("evergreen");
  await page.locator('[name="title"]').fill("Edited title");
  await page.locator("#markdown").fill("## Edited content\n\nUpdated safely.");
  await page.locator("#publish").click(); await confirm(page);
  await expect(page.locator("#result-text")).toContainText("GitHub 提交成功");
  expect(api.puts).toHaveLength(1);
  expect(api.puts[0].path).toBe(path);
  expect(api.puts[0].body.sha).toBe(OLD_SHA);
  const source = Buffer.from(api.puts[0].body.content, "base64").toString("utf8");
  expect(source).toContain("customMeta:");
  expect(source).toContain("preserved: true");
  expect(source).toContain("status: evergreen");
  expect(source).toContain("2026-01-02T12:30:45.123+08:00");
  expect(source).toContain("2026-10-21T12:30:45.123+08:00");
  await expect(page.locator("#commit-link")).toHaveAttribute("href", `https://github.com/y4ho0/y4ho0.github.io/commit/${COMMIT_SHA}`);
  await page.locator("#check-deploy").click();
  await expect(page.locator("#deploy-status")).toContainText("尚未完成部署");
  api.deployment = "success";
  await page.locator("#check-deploy").click();
  await expect(page.locator("#deploy-status")).toContainText("Pages 部署任务已成功");
  const deploymentRequests = api.requests.filter(request => request.path.includes("/actions/"));
  expect(deploymentRequests.length).toBeGreaterThan(0);
  expect(deploymentRequests.every(request => !request.authorization)).toBe(true);
});

test("concurrent remote edits never reach PUT and local writing remains recoverable", async ({ page }) => {
  const path = "src/content/essays/existing-essay.md";
  const api = await mockGitHub(page, { [path]: article() });
  await openAdmin(page); await login(page); await openArticle(page);
  await page.locator("#markdown").fill("## Unsaved local work\n\nKeep this version.");
  api.files.set(path, { ...article(), sha: OTHER_SHA });
  await page.locator("#publish").click(); await confirm(page);
  await expect(page.locator("#notice")).toContainText("已在其他位置更新");
  await expect(page.locator("#notice")).toContainText("本地草稿保留原内容");
  expect(api.puts).toHaveLength(0);
  await expect(page.locator("#result")).toBeHidden();
  await expect(page.locator("#markdown")).toHaveValue("## Unsaved local work\n\nKeep this version.");
  expect(await storedDocuments(page)).toContain("Keep this version.");
});

test("GitHub write and list failures show errors without a false success", async ({ page }) => {
  const path = "src/content/essays/existing-essay.md";
  const api = await mockGitHub(page, { [path]: article() });
  await openAdmin(page); await login(page); await openArticle(page);
  await page.locator("#markdown").fill("## Failed write\n\nStill locally saved.");
  api.putStatus = 503;
  await page.locator("#publish").click(); await confirm(page);
  await expect(page.locator("#notice")).toContainText("HTTP 503");
  await expect(page.locator("#result")).toBeHidden();
  expect(api.puts).toHaveLength(1);
  expect(api.files.get(path)?.sha).toBe(OLD_SHA);
  expect(await storedDocuments(page)).toContain("Still locally saved.");
  api.treeStatus = 500;
  await page.locator("#refresh").click();
  await expect(page.locator("#notice")).toContainText("HTTP 500");
  await expect(page.locator("#markdown")).toHaveValue("## Failed write\n\nStill locally saved.");
});

test("referenced articles cannot be deleted and unreferenced deletion needs a second confirmation", async ({ page }) => {
  const coursePath = "src/content/courses/math.md";
  const essayPath = "src/content/essays/free-essay.md";
  const api = await mockGitHub(page, {
    [coursePath]: article("Math course"),
    "src/content/projects/exercise.md": article("Course exercise", "course: math\n"),
    [essayPath]: article("Free essay"),
  });
  await openAdmin(page); await login(page); await openArticle(page, "Math course");
  await page.locator("#delete-entry").click();
  await expect(page.locator("#notice")).toContainText("不能删除仍被引用的文章");
  await expect(page.locator("#confirm-dialog")).toBeHidden();
  expect(api.deletes).toHaveLength(0);
  await openArticle(page, "Free essay");
  await page.locator("#delete-entry").click();
  await expect(page.locator("#confirm-title")).toHaveText("删除 GitHub 文章");
  expect(api.deletes).toHaveLength(0);
  await page.locator('#confirm-dialog button[value="cancel"]').click();
  await expect(page.locator("#delete-entry")).toBeEnabled();
  expect(api.files.has(essayPath)).toBe(true);
  await page.locator("#delete-entry").click(); await confirm(page);
  await expect(page.locator("#result-text")).toContainText("删除文章：GitHub 提交成功");
  expect(api.deletes).toHaveLength(1);
  expect(api.deletes[0].path).toBe(essayPath);
  expect(api.deletes[0].body.sha).toBe(OLD_SHA);
  expect(api.files.has(essayPath)).toBe(false);
  expect(api.files.has(coursePath)).toBe(true);
});

test("image uploads validate type, commit exact bytes and insert a reusable Markdown reference", async ({ page }) => {
  const api = await mockGitHub(page); await openAdmin(page); await login(page);
  await page.locator('[name="id"]').fill("media-post");
  await page.locator("#media-panel summary").click();
  await page.locator("#media-file").setInputFiles({ name: "unsafe.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg onload="alert(1)"/>') });
  await page.locator("#upload").click();
  await expect(page.locator("#notice")).toContainText("仅支持 5 MiB 以内");
  expect(api.puts).toHaveLength(0);
  await page.locator("#media-file").setInputFiles({ name: "valid.png", mimeType: "image/png", buffer: PNG });
  await page.locator("#upload").click();
  await expect(page.locator("#confirm-text")).toContainText("本地草稿中的图片也会公开");
  expect(api.puts).toHaveLength(0);
  await confirm(page);
  await expect(page.locator("#result-text")).toContainText("图片：GitHub 提交成功");
  expect(api.puts).toHaveLength(1);
  const upload = api.puts[0];
  expect(upload.path).toMatch(/^public\/images\/media-post\/[a-f0-9-]+\.png$/u);
  expect(Buffer.from(upload.body.content, "base64")).toEqual(PNG);
  expect(upload.body.sha).toBeUndefined();
  await expect(page.locator("#markdown")).toHaveValue(`![图片说明](${upload.path.replace(/^public/u, "")})`);
  await page.locator("#media-select").selectOption(upload.path);
  await page.locator("#insert-media").click();
  await expect(page.locator("#markdown")).toHaveValue(`![图片说明](${upload.path.replace(/^public/u, "")})![图片说明](${upload.path.replace(/^public/u, "")})`);
  expect(api.puts).toHaveLength(1);
});
