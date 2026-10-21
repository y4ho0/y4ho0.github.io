import { test, expect, type Page, type Locator } from "@playwright/test";

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
  await page.locator("#metadata-panel > summary").click();
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

/** Chromium reports the fonts that supplied actual glyphs, beyond computed CSS declarations. */
async function actualGlyphFonts(page: Page, target: Locator) {
  const marker = `probe-${Math.random().toString(36).slice(2)}`;
  await target.evaluate((element, value) => element.setAttribute("data-admin-font-probe", value), marker);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const tree = await session.send("DOM.getDocument", { depth: -1, pierce: true });
    type Node = { nodeId: number; attributes?: string[]; children?: Node[]; contentDocument?: Node };
    const find = (node: Node): number | undefined => {
      const attributes = node.attributes ?? [];
      const index = attributes.indexOf("data-admin-font-probe");
      if (index >= 0 && attributes[index + 1] === marker) return node.nodeId;
      for (const child of node.children ?? []) { const match = find(child); if (match) return match; }
      if (node.contentDocument) return find(node.contentDocument);
      return undefined;
    };
    const nodeId = find(tree.root);
    if (!nodeId) throw new Error("Font probe could not find the preview node in Chromium's document tree.");
    return (await session.send("CSS.getPlatformFontsForNode", { nodeId })).fonts.filter(font => font.glyphCount > 0);
  } finally {
    await session.detach();
  }
}

async function selectWriting(page: Page, start: number, end = start, direction: "forward" | "backward" = "forward") {
  await page.locator("#markdown").evaluate((element: HTMLTextAreaElement, selection) => {
    element.focus();
    element.setSelectionRange(selection.start, selection.end, selection.direction);
  }, { start, end, direction });
}

const commandButton = (page: Page, command: string) => page.locator(`#format-toolbar button[data-command="${command}"]`);
const shortcutInput = (page: Page, command: string) => page.locator(`#shortcuts-form input[data-shortcut-command="${command}"]`);

async function openShortcuts(page: Page) {
  await page.locator("#shortcut-settings").click();
  await expect(page.locator("#shortcuts-dialog")).toBeVisible();
}

async function captureShortcut(page: Page, command: string, combination: string) {
  await shortcutInput(page, command).focus();
  await pressEditorKey(page, combination);
}

async function pressEditorKey(page: Page, combination: string) {
  const primary = await page.evaluate(() => /Mac|iPhone|iPad/u.test(navigator.platform) ? "Meta" : "Control");
  await page.keyboard.press(combination.replace(/^Mod(?=\+)/u, primary));
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

test("default layout keeps advanced metadata compact and collapses the library on narrow screens", async ({ page }) => {
  await mockGitHub(page);
  await page.goto("/admin/");
  await expect(page.locator("#entry-path")).toContainText("新文件 →");
  await expect(page.locator("#metadata-panel")).not.toHaveAttribute("open");
  await expect(page.locator("#library-panel")).toHaveAttribute("open", "");
  await expect(page.locator("#writing-area")).toHaveAttribute("data-layout", "split");
  const desktopWriting = await page.locator("#writing-area").boundingBox();
  expect(desktopWriting!.y).toBeLessThan(1000);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#metadata-panel")).not.toHaveAttribute("open");
  await expect(page.locator("#library-panel")).not.toHaveAttribute("open");
  await expect(page.locator("#writing-area")).toHaveAttribute("data-layout", "tabs");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("admin controls use WenKai with roomy select arrows and preserve native selection on narrow screens", async ({ page }) => {
  await mockGitHub(page); await openAdmin(page);
  const typography = await page.evaluate(async () => {
    await document.fonts.ready;
    const samples = Array.from(document.querySelectorAll("body,header h1,label,button,input,select,option,summary,dialog,textarea:not(#markdown)"))
      .map(element => ({
        label: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.getAttribute("name") ? `[name=${element.getAttribute("name")}]` : ""}`,
        family: getComputedStyle(element).fontFamily,
      }));
    const selectPadding = Array.from(document.querySelectorAll("select")).map(element => ({
      label: element.id || element.name,
      right: Number.parseFloat(getComputedStyle(element).paddingRight),
    }));
    return { samples, selectPadding, editorFamily: getComputedStyle(document.querySelector("#markdown")!).fontFamily };
  });
  for (const sample of typography.samples) expect(sample.family, sample.label).toContain("LXGW WenKai Screen");
  for (const select of typography.selectPadding) expect(select.right, select.label).toBeGreaterThanOrEqual(40);
  expect(typography.editorFamily).toMatch(/monospace/iu);
  expect(typography.editorFamily).not.toContain("LXGW WenKai Screen");

  const collection = page.locator('[name="collection"]');
  await collection.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(collection).toHaveValue("courses");
  await expect(page.locator("#metadata-summary")).toContainText("courses");
  await expect(page.locator("#entry-path")).toContainText("src/content/courses/");
  await page.locator('[name="status"]').selectOption("evergreen");
  await expect(page.locator("#metadata-summary")).toContainText("evergreen");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#writing-area")).toHaveAttribute("data-layout", "tabs");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(collection).toHaveValue("courses");
  await expect(page.locator("#metadata-summary")).toContainText("courses · evergreen");
  await collection.selectOption("notes");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const publication = await page.locator(".publication-options").evaluate(element => {
      const labels = Array.from(element.querySelectorAll("label")).map(label => {
        const bounds = label.getBoundingClientRect();
        return { whiteSpace: getComputedStyle(label).whiteSpace, top: bounds.top, bottom: bounds.bottom };
      });
      return { labels, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(publication.labels).toHaveLength(2);
    expect(publication.labels.every(label => label.whiteSpace === "nowrap"), `${width}px checkbox labels remain on one line`).toBe(true);
    expect(publication.labels[1].top, `${width}px RSS option starts on the next row`).toBeGreaterThanOrEqual(publication.labels[0].bottom);
    expect(publication.overflow, `${width}px page stays within the viewport`).toBe(false);
  }
});

test("admin shares the homepage theme preference without disturbing writing or preview position", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockGitHub(page); await openAdmin(page);
  const root = page.locator("html");
  const theme = (value: string) => page.locator(`.admin-header [data-theme-value="${value}"]`);
  await expect(root).toHaveAttribute("data-theme", "light");
  await theme("light").click();
  // CDP's color-scheme emulation overrides every frame, hiding native iframe
  // inheritance. Clear it while verifying explicit user-selected themes.
  await page.emulateMedia({ colorScheme: null });
  const body = ["## Theme preview", "", "```js", "const answer = 42;", "```", "",
    ...Array.from({ length: 100 }, (_, index) => `Paragraph ${index}: 保留写作与预览位置。\n`),
  ].join("\n");
  await page.locator("#markdown").fill(body);
  const preview = page.frameLocator("#preview");
  await expect(preview.getByRole("heading", { name: "Theme preview" })).toBeVisible();
  await expect(preview.locator(".hljs-keyword")).toContainText("const");
  await page.locator("#save-draft").click();
  await expect(page.locator("#notice")).toContainText("草稿已保存");
  const writing = await page.locator("#markdown").evaluate((element: HTMLTextAreaElement) => {
    (window as any).__themeEditor = element;
    element.focus(); element.setSelectionRange(120, 150, "backward"); element.scrollTop = 550;
    return { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, scroll: element.scrollTop };
  });
  expect(writing.scroll).toBeGreaterThan(0);
  const previewScroll = await preview.locator("body").evaluate(() => {
    document.scrollingElement!.scrollTop = 650;
    return document.scrollingElement!.scrollTop;
  });
  expect(previewScroll).toBeGreaterThan(0);

  await theme("dark").click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveAttribute("data-theme-preference", "dark");
  await expect(theme("dark")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => preview.locator("body").evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(true);
  const colors = await page.evaluate(() => {
    const luminance = (value: string) => {
      const [red, green, blue] = (value.match(/[\d.]+/gu) ?? []).slice(0, 3).map(Number);
      return [red, green, blue].map(channel => {
        const linear = channel / 255;
        return linear <= .04045 ? linear / 12.92 : ((linear + .055) / 1.055) ** 2.4;
      }).reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
    };
    const select = document.querySelector<HTMLSelectElement>('[name="collection"]')!;
    const fallback = getComputedStyle(select);
    const supportsPicker = CSS.supports("appearance", "base-select");
    const picker = supportsPicker ? getComputedStyle(select, "::picker(select)") : fallback;
    return {
      body: luminance(getComputedStyle(document.body).backgroundColor),
      pickerBackground: luminance(picker.backgroundColor),
      pickerContrast: (luminance(picker.color) + .05) / (luminance(picker.backgroundColor) + .05),
      preference: localStorage.getItem("garden-theme"),
    };
  });
  expect(colors.body).toBeLessThan(.1);
  expect(colors.pickerBackground).toBeLessThan(.1);
  expect(colors.pickerContrast).toBeGreaterThanOrEqual(4.5);
  expect(colors.preference).toBe("dark");
  const previewColors = await preview.locator(".hljs-keyword").evaluate(element => {
    const rgb = (value: string) => (value.match(/[\d.]+/gu) ?? []).slice(0, 3).map(Number);
    const luminance = (value: string) => rgb(value).map(channel => {
      const linear = channel / 255;
      return linear <= .04045 ? linear / 12.92 : ((linear + .055) / 1.055) ** 2.4;
    }).reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(element.closest("pre")!).backgroundColor);
    return { body: luminance(getComputedStyle(document.body).backgroundColor), contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
  });
  expect(previewColors.body).toBeLessThan(.1);
  expect(previewColors.contrast).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator("#markdown")).toHaveValue(body);
  expect(await page.locator("#markdown").evaluate((element: HTMLTextAreaElement) => ({
    sameNode: (window as any).__themeEditor === element,
    start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, scroll: element.scrollTop,
  }))).toEqual({ sameNode: true, ...writing });
  expect(await preview.locator("body").evaluate(() => document.scrollingElement!.scrollTop)).toBe(previewScroll);

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(theme("dark")).toHaveAttribute("aria-pressed", "true");
  await page.goto("/");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('.site-nav [data-theme-value="dark"]')).toHaveAttribute("aria-pressed", "true");
  await page.goto("/admin/");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await theme("system").click();
  await expect(root).toHaveAttribute("data-theme-preference", "system");
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await theme("light").click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).toHaveAttribute("data-theme-preference", "light");
  await page.emulateMedia({ colorScheme: null });
  await expect.poll(() => preview.locator("body").evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(false);
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
  const mathFonts = await preview.locator("article").evaluate(async () => {
    await document.fonts.ready;
    const loaded: string[] = [];
    for (const face of document.fonts) if (face.status === "loaded") loaded.push(face.family);
    return { loaded, family: getComputedStyle(document.querySelector(".mathnormal")!).fontFamily };
  });
  expect(mathFonts.loaded).toContain("KaTeX_Main");
  expect(mathFonts.loaded).toContain("KaTeX_Math");
  expect(mathFonts.family).toContain("KaTeX_Math");
  const renderedMathFonts = await actualGlyphFonts(page, preview.locator(".mathnormal").first());
  expect(renderedMathFonts.some(font => font.isCustomFont && font.familyName === "KaTeX_Math")).toBe(true);
  await expect(preview.locator("script,[onerror],a[href^='javascript:']")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__adminXss)).toBe(0);
  await expect(page.locator("#preview")).toHaveAttribute("sandbox", "");
  const separator = page.locator("#splitter");
  await separator.focus(); await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "52");
  await page.locator("#markdown").fill("## Updated live\n\nContent changed.");
  await expect(preview.getByRole("heading", { name: "Updated live" })).toBeVisible();
});

test("preview uses the self-hosted Chinese body font across formatting while code and math keep their own fonts", async ({ page }) => {
  const fontErrors: string[] = [];
  const fontFailures: string[] = [];
  page.on("console", item => { if (item.type() === "error" && /font|cors|content security policy/iu.test(item.text())) fontErrors.push(item.text()); });
  page.on("requestfailed", request => { if (request.resourceType() === "font") fontFailures.push(request.url()); });
  await mockGitHub(page); await openAdmin(page);
  await page.locator("#markdown").fill([
    "## 中文标题", "", "中文正文", "", "**中文加粗**与*中文斜体*。", "", "> 中文引用", "", "- 中文列表", "",
    "| 中文表头 | 数值 |", "| --- | --- |", "| 中文单元格 | 1 |", "", "[中文链接](https://example.com)", "",
    "行内代码：`const inline = 1`", "", "```js", "const answer = 42;", "```", "",
    "$E=mc^2$", "", "$$", "\\frac{x+1}{y_1}=\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "$$",
  ].join("\n"));
  const preview = page.frameLocator("#preview");
  await expect(preview.getByRole("heading", { name: "中文标题" })).toBeVisible();
  await expect(preview.locator(".mfrac")).toHaveCount(1);
  await expect(preview.locator(".mtable")).toHaveCount(1);
  const typography = await preview.locator("article").evaluate(async article => {
    await document.fonts.ready;
    const fonts: { family: string; status: string; weight: string }[] = [];
    for (const face of document.fonts) fonts.push({ family: face.family, status: face.status, weight: face.weight });
    const body = getComputedStyle(document.body);
    const prose = getComputedStyle(article);
    const text = ["h2", "strong", "em", "blockquote p", "li", "th", "td", "a"].map(selector => ({ selector, family: getComputedStyle(article.querySelector(selector)!).fontFamily }));
    // Raw HTML remains disabled in Markdown; DOM probes also verify the shared kbd/samp CSS contract.
    for (const name of ["kbd", "samp"]) { const element = document.createElement(name); element.textContent = name; article.append(element); }
    const code = ["p code", "pre code", ".hljs-keyword", "kbd", "samp"].map(selector => ({ selector, family: getComputedStyle(article.querySelector(selector)!).fontFamily }));
    return { fonts, body: { family: body.fontFamily, weight: body.fontWeight }, prose: { family: prose.fontFamily, weight: prose.fontWeight }, text, code, math: getComputedStyle(article.querySelector(".mathnormal")!).fontFamily };
  });
  expect(typography.body.family).toContain("LXGW WenKai Screen");
  expect(typography.body.weight).toBe("400");
  expect(typography.prose.family).toContain("LXGW WenKai Screen");
  expect(typography.prose.weight).toBe("400");
  expect(typography.fonts.some(face => face.family === "LXGW WenKai Screen" && face.status === "loaded" && face.weight === "400")).toBe(true);
  for (const sample of typography.text) expect(sample.family, sample.selector).toContain("LXGW WenKai Screen");
  for (const sample of typography.code) {
    expect(sample.family, sample.selector).toMatch(/monospace/iu);
    expect(sample.family, sample.selector).not.toContain("LXGW WenKai Screen");
  }
  expect(typography.math).toContain("KaTeX_Math");
  const chineseGlyphFonts = await actualGlyphFonts(page, preview.locator("p").filter({ hasText: /^中文正文$/u }));
  expect(chineseGlyphFonts.some(font => font.isCustomFont && font.familyName.includes("LXGW"))).toBe(true);
  expect(chineseGlyphFonts.every(font => font.isCustomFont)).toBe(true);
  expect(fontFailures).toEqual([]);
  expect(fontErrors).toEqual([]);
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
  await expect(page.locator("#notice")).toContainText("仅支持 PNG、JPEG、GIF 和 WebP");
  await expect(page.locator("#upload")).toBeDisabled();
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

test("dropping an image stages it and requires authenticated confirmation before uploading", async ({ page }) => {
  const api = await mockGitHub(page); await openAdmin(page);
  await page.locator('[name="id"]').fill("dropped-image");
  await page.locator("#media-panel summary").click();
  const dropImage = async () => {
    const transfer = await page.evaluateHandle(base64 => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
      return data;
    }, PNG.toString("base64"));
    try { await page.locator("#media-dropzone").dispatchEvent("drop", { dataTransfer: transfer }); }
    finally { await transfer.dispose(); }
  };
  await dropImage();
  expect(api.puts).toHaveLength(0);
  await expect(page.locator("#upload")).toBeDisabled();
  await login(page);
  await dropImage();
  await expect(page.locator("#media-pending")).toContainText("dropped.png");
  expect(api.puts).toHaveLength(0);
  await page.locator("#upload").click();
  await expect(page.locator("#confirm-title")).toHaveText("公开上传图片");
  expect(api.puts).toHaveLength(0);
  await confirm(page);
  await expect(page.locator("#result-text")).toContainText("图片：GitHub 提交成功");
  expect(api.puts).toHaveLength(1);
  expect(api.puts[0].path).toMatch(/^public\/images\/dropped-image\/[a-f0-9-]+\.png$/u);
  expect(Buffer.from(api.puts[0].body.content, "base64")).toEqual(PNG);
  await expect(page.locator("#markdown")).toHaveValue(`![图片说明](${api.puts[0].path.replace(/^public/u, "")})`);
});

test("pasting images stages exact bytes while ordinary text paste keeps its default behavior", async ({ page }) => {
  const api = await mockGitHub(page); await openAdmin(page); await login(page);
  await page.locator('[name="id"]').fill("pasted-image");
  await page.locator("#markdown").fill("Existing text.\n");
  const ordinaryPasteAllowed = await page.locator("#markdown").evaluate(element => {
    const clipboard = new DataTransfer(); clipboard.setData("text/plain", "普通文本");
    const event = new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return !event.defaultPrevented;
  });
  expect(ordinaryPasteAllowed).toBe(true);
  await expect(page.locator("#markdown")).toHaveValue("Existing text.\n");
  await page.locator("#markdown").evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, PNG.toString("base64"));
  await expect(page.locator("#media-pending")).toContainText("pasted.png");
  await expect(page.locator("#media-panel")).toHaveAttribute("open", "");
  await expect(page.locator("#markdown")).toHaveValue("Existing text.\n");
  expect(api.puts).toHaveLength(0);
  await page.locator("#upload").click(); await confirm(page);
  await expect(page.locator("#result-text")).toContainText("图片：GitHub 提交成功");
  expect(api.puts).toHaveLength(1);
  expect(api.puts[0].path).toMatch(/^public\/images\/pasted-image\/[a-f0-9-]+\.png$/u);
  expect(Buffer.from(api.puts[0].body.content, "base64")).toEqual(PNG);
  await expect(page.locator("#markdown")).toHaveValue(`Existing text.\n![图片说明](${api.puts[0].path.replace(/^public/u, "")})`);
});

test("formatting toolbar changes the shared Markdown selection, updates preview and restores the resulting local draft", async ({ page }) => {
  const api = await mockGitHub(page); await openAdmin(page);
  const editor = page.locator("#markdown");
  const preview = page.frameLocator("#preview");
  await page.locator('[name="title"]').fill("工具栏写作草稿");
  await editor.fill("插入："); await selectWriting(page, 3);
  await commandButton(page, "bold").click(); await page.keyboard.insertText("新内容");
  await expect(editor).toHaveValue("插入：**新内容**");
  await expect(preview.locator("strong")).toHaveText("新内容");
  await editor.fill("保留开头 选中内容 保留结尾");
  await selectWriting(page, 5, 9, "backward");
  await commandButton(page, "bold").click();
  await expect(editor).toHaveValue("保留开头 **选中内容** 保留结尾");
  await expect(preview.locator("strong")).toHaveText("选中内容");
  await expect(editor).toBeFocused();
  // Real editor operations must participate in the browser's undo/redo history.
  await pressEditorKey(page, "Mod+z");
  await expect(editor).toHaveValue("保留开头 选中内容 保留结尾");
  await pressEditorKey(page, "Mod+Shift+z");
  await expect(editor).toHaveValue("保留开头 **选中内容** 保留结尾");

  const cases = [
    { command: "italic", text: "强调内容", selector: "em" },
    { command: "strike", text: "划去内容", selector: "del" },
    { command: "inlineCode", text: "answer = 42", selector: "p code" },
    { command: "codeBlock", text: "const answer = 42;", selector: "pre code" },
    { command: "quote", text: "第一行引用\n第二行引用", selector: "blockquote" },
    { command: "unordered", text: "第一项\n第二项", selector: "ul" },
    { command: "ordered", text: "第一项\n第二项", selector: "ol" },
    { command: "task", text: "第一项\n第二项", selector: "ul" },
  ];
  for (const example of cases) {
    await editor.fill(example.text);
    await selectWriting(page, 0, example.text.length);
    await commandButton(page, example.command).click();
    await expect(preview.locator(example.selector), example.command).toContainText(example.text.split("\n")[0]);
    if (["unordered", "ordered", "task"].includes(example.command)) await expect(preview.locator("li")).toHaveCount(2);
    if (example.command === "task") {
      await expect(preview.locator("span.task-checkbox")).toHaveText(["☐", "☐"]);
      await expect(preview.locator("input")).toHaveCount(0);
    }
    await expect(editor).toBeFocused();
  }
  await editor.fill("- [x] 已完成\n- [ ] 未完成");
  await expect(preview.locator("span.task-checkbox")).toHaveText(["☑", "☐"]);
  await expect(preview.getByRole("img", { name: "已完成", exact: true })).toHaveCount(1);
  await expect(preview.getByRole("img", { name: "未完成", exact: true })).toHaveCount(1);
  await expect(preview.locator("input")).toHaveCount(0);
  await editor.fill("一节标题\n第二行正文"); await selectWriting(page, 0, 4);
  await page.locator("#heading-level").selectOption("heading2");
  await expect(editor).toHaveValue("## 一节标题\n第二行正文");
  await expect(preview.getByRole("heading", { level: 2, name: "一节标题" })).toBeVisible();
  await expect(page.locator("#heading-level")).toHaveValue("");
  await editor.fill("链接文字"); await selectWriting(page, 0, 4);
  await commandButton(page, "link").click();
  await expect(preview.locator("a")).toHaveText("链接文字");
  await expect(editor).toHaveValue(/^\[链接文字\]\([^)]+\)$/u);
  await editor.fill("图片说明"); await selectWriting(page, 0, 4);
  await commandButton(page, "image").click();
  await expect(preview.locator("img")).toHaveAttribute("alt", "图片说明");
  await expect(editor).toHaveValue(/^!\[图片说明\]\([^)]+\)$/u);
  await editor.fill("x^2 + y^2"); await selectWriting(page, 0, 9);
  await commandButton(page, "mathInline").click();
  await expect(preview.locator(".katex")).toHaveCount(1);
  await expect(preview.locator(".katex-display")).toHaveCount(0);
  await editor.fill("\\frac{a}{b}"); await selectWriting(page, 0, 11);
  await commandButton(page, "mathBlock").click();
  await expect(preview.locator(".katex-display .mfrac")).toHaveCount(1);
  await selectWriting(page, (await editor.inputValue()).length);
  await commandButton(page, "table").click();
  await expect(preview.locator("table")).toHaveCount(1);
  await selectWriting(page, (await editor.inputValue()).length);
  await commandButton(page, "hr").click();
  await expect(preview.locator("hr")).toHaveCount(1);

  const result = await editor.inputValue();
  await page.locator("#save-draft").click();
  await expect(page.locator("#notice")).toContainText("草稿已保存");
  expect(await storedDocuments(page)).toContain("工具栏写作草稿");
  expect(api.puts).toHaveLength(0);
  await page.reload();
  await page.locator("#draft-list button").filter({ hasText: "工具栏写作草稿" }).click();
  await expect(editor).toHaveValue(result);
  await expect(preview.locator("table")).toHaveCount(1);
  await expect(preview.locator(".katex-display .mfrac")).toHaveCount(1);
});

test("default shortcuts format writing only and ignore metadata, token, repeated keys and IME composition", async ({ page }) => {
  await mockGitHub(page); await openAdmin(page);
  const editor = page.locator("#markdown");
  const preview = page.frameLocator("#preview");
  for (const example of [
    { combination: "Mod+b", original: "粗体", expected: "**粗体**", selector: "strong" },
    { combination: "Mod+i", original: "斜体", expected: "*斜体*", selector: "em" },
    { combination: "Mod+k", original: "链接文字", expected: /^\[链接文字\]\([^)]+\)$/u, selector: "a" },
  ]) {
    await editor.fill(example.original); await selectWriting(page, 0, example.original.length);
    await pressEditorKey(page, example.combination);
    await expect(editor).toHaveValue(example.expected);
    await expect(preview.locator(example.selector)).toContainText(example.original);
  }
  await editor.fill("x^2"); await selectWriting(page, 0, 3);
  await pressEditorKey(page, "Mod+Alt+Shift+m");
  await expect(preview.locator(".katex")).toHaveCount(1);
  const unchanged = await editor.inputValue();
  for (const target of [page.locator('[name="title"]'), page.locator("#token")]) {
    await target.fill("metadata stays plain");
    await target.focus(); await pressEditorKey(page, "Mod+a"); await pressEditorKey(page, "Mod+b");
    await expect(target).toHaveValue("metadata stays plain");
    await expect(editor).toHaveValue(unchanged);
  }
  await editor.fill("输入法正在组合"); await selectWriting(page, 0, 7);
  const ignored = await editor.evaluate(element => {
    const isMac = /Mac|iPhone|iPad/u.test(navigator.platform);
    return [{ isComposing: true }, { repeat: true }].map(properties => {
      const event = new KeyboardEvent("keydown", { key: "b", code: "KeyB", ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true, ...properties });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
  });
  expect(ignored).toEqual([false, false]);
  await expect(editor).toHaveValue("输入法正在组合");
});

test("custom shortcuts persist across reload, reject conflicts and reserved combinations, and can be cancelled, disabled and reset", async ({ page }) => {
  // This case exercises Linux's physical Ctrl+Alt combination being converted
  // to portable Mod bindings, which must also be safe on macOS.
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "Linux x86_64", configurable: true }));
  const uncaught: string[] = [];
  page.on("pageerror", error => uncaught.push(error.message));
  await mockGitHub(page); await openAdmin(page);
  const editor = page.locator("#markdown");
  const dialog = page.locator("#shortcuts-dialog");
  await editor.fill("定制键位"); await selectWriting(page, 0, 4);
  await openShortcuts(page); await captureShortcut(page, "bold", "Mod+Alt+b");
  await expect(shortcutInput(page, "bold")).toHaveValue("Mod+Alt+B");
  await page.locator("#save-shortcuts").click(); await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("garden-admin-shortcuts")!))).toMatchObject({ version: 1, bindings: { bold: "Mod+Alt+B" } });
  await selectWriting(page, 0, 4); await pressEditorKey(page, "Mod+Alt+b");
  await expect(editor).toHaveValue("**定制键位**");
  await page.locator("#save-draft").click(); await expect(page.locator("#notice")).toContainText("草稿已保存");
  await page.reload(); await expect(page.locator("#entry-path")).toContainText("新文件 →");
  await editor.fill("重载后生效"); await selectWriting(page, 0, 5);
  await pressEditorKey(page, "Mod+Alt+b"); await expect(editor).toHaveValue("**重载后生效**");

  await openShortcuts(page); await captureShortcut(page, "italic", "Mod+Alt+b");
  await page.locator("#save-shortcuts").click();
  await expect(dialog).toBeVisible(); await expect(page.locator("#shortcut-error")).not.toHaveText("");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("garden-admin-shortcuts")!).bindings.italic)).not.toBe("Mod+Alt+B");
  await page.locator("#cancel-shortcuts").click(); await expect(dialog).toBeHidden();

  await openShortcuts(page); await captureShortcut(page, "bold", "Mod+s");
  await expect(page.locator("#shortcut-error")).not.toHaveText("");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("garden-admin-shortcuts")!).bindings.bold)).toBe("Mod+Alt+B");
  await page.locator("#cancel-shortcuts").click();

  await openShortcuts(page); await captureShortcut(page, "bold", "Mod+Alt+h");
  await expect(page.locator("#shortcut-error")).toContainText("保留");
  await expect(shortcutInput(page, "bold")).toHaveValue("Mod+Alt+B");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("garden-admin-shortcuts")!).bindings.bold)).toBe("Mod+Alt+B");
  expect(uncaught).toEqual([]);
  await page.locator("#cancel-shortcuts").click();

  await openShortcuts(page); await captureShortcut(page, "bold", "Mod+Alt+p");
  await page.locator("#cancel-shortcuts").click();
  await editor.fill("取消不应用"); await selectWriting(page, 0, 5);
  await pressEditorKey(page, "Mod+Alt+b"); await expect(editor).toHaveValue("**取消不应用**");
  await openShortcuts(page); await shortcutInput(page, "bold").focus(); await page.keyboard.press("Backspace");
  await page.locator("#save-shortcuts").click(); await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("garden-admin-shortcuts")!).bindings.bold)).toBe("");
  await editor.fill("快捷键已禁用"); await selectWriting(page, 0, 6);
  await pressEditorKey(page, "Mod+Alt+b"); await expect(editor).toHaveValue("快捷键已禁用");
  await selectWriting(page, 0, 6);
  await commandButton(page, "bold").click(); await expect(editor).toHaveValue("**快捷键已禁用**");

  await openShortcuts(page); await page.locator("#reset-shortcuts").click();
  await expect(shortcutInput(page, "bold")).toHaveValue("Mod+B");
  await page.locator("#save-shortcuts").click(); await expect(dialog).toBeHidden();
  await editor.fill("恢复默认"); await selectWriting(page, 0, 4);
  await pressEditorKey(page, "Mod+b"); await expect(editor).toHaveValue("**恢复默认**");
  expect(uncaught).toEqual([]);
});

test("formatting tools and shortcut settings fit narrow screens and preserve the shared editor position across tabs", async ({ page }) => {
  await mockGitHub(page); await openAdmin(page);
  const editor = page.locator("#markdown");
  const content = Array.from({ length: 100 }, (_, index) => `Line ${index}: mobile writing`).join("\n");
  await editor.fill(content); await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#writing-area")).toHaveAttribute("data-layout", "tabs");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const toolbar = await page.locator("#format-toolbar").evaluate(element => ({
      visibleButtons: Array.from(element.querySelectorAll("button")).filter(button => button.getBoundingClientRect().width > 0).length,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(toolbar.visibleButtons).toBeGreaterThanOrEqual(15);
    expect(toolbar.overflow, `${width}px formatting toolbar does not widen the page`).toBe(false);
    await openShortcuts(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px shortcut dialog does not widen the page`).toBe(true);
    const bounds = await page.locator("#shortcuts-dialog").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(page.locator("#save-shortcuts")).toBeVisible();
    await page.locator("#cancel-shortcuts").click();
  }
  await selectWriting(page, 100, 125, "backward"); await commandButton(page, "bold").click();
  const before = await editor.evaluate((element: HTMLTextAreaElement) => {
    (window as any).__formattedEditor = element; element.scrollTop = 450;
    return { text: element.value, start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, scroll: element.scrollTop };
  });
  await page.locator("#tab-preview").click(); await expect(editor).toBeHidden(); await page.locator("#tab-edit").click();
  expect(await editor.evaluate((element: HTMLTextAreaElement) => ({
    sameNode: element === (window as any).__formattedEditor,
    text: element.value, start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, scroll: element.scrollTop,
  }))).toEqual({ sameNode: true, ...before });
});

test("macOS uses Command shortcuts, exposes matching hints and records portable Mod bindings", async ({ page }) => {
  // Exercise the platform branch on Linux CI as well; native undo is tested
  // separately using the actual operating system's primary modifier.
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true }));
  await mockGitHub(page); await openAdmin(page);
  const editor = page.locator("#markdown");
  await expect(commandButton(page, "bold")).toHaveAttribute("aria-keyshortcuts", "Meta+B");
  await expect(commandButton(page, "bold")).toHaveAttribute("title", /⌘/u);
  await editor.fill("macOS 文本"); await selectWriting(page, 0, 8);
  await page.keyboard.press("Meta+b"); await expect(editor).toHaveValue("**macOS 文本**");
  const controlIgnored = await editor.evaluate(element => {
    const event = new KeyboardEvent("keydown", { key: "b", code: "KeyB", ctrlKey: true, bubbles: true, cancelable: true });
    element.dispatchEvent(event); return !event.defaultPrevented;
  });
  expect(controlIgnored).toBe(true); await expect(editor).toHaveValue("**macOS 文本**");
  await openShortcuts(page); await captureShortcut(page, "bold", "Mod+Alt+b");
  await expect(shortcutInput(page, "bold")).toHaveValue("Mod+Alt+B");
  await page.locator("#save-shortcuts").click(); await expect(page.locator("#shortcuts-dialog")).toBeHidden();
  await editor.fill("Mac 定制"); await selectWriting(page, 0, 6);
  await page.keyboard.press("Meta+Alt+b"); await expect(editor).toHaveValue("**Mac 定制**");
});

test("formatting a multi-paragraph selection keeps valid paragraph markup and toggles combined emphasis without losing neighboring text", async ({ page }) => {
  await mockGitHub(page); await openAdmin(page);
  const editor = page.locator("#markdown");
  const preview = page.frameLocator("#preview");
  const source = "开头保持\n\n第一段文字\n\n第二段文字\n\n结尾保持";
  const bold = "开头保持\n\n**第一段文字**\n\n**第二段文字**\n\n结尾保持";
  await editor.fill(source);
  await selectWriting(page, source.indexOf("第一段"), source.indexOf("\n\n结尾保持"), "backward");
  await commandButton(page, "bold").click();
  await expect(editor).toHaveValue(bold);
  await expect(preview.locator("strong")).toHaveText(["第一段文字", "第二段文字"]);
  await expect(preview.locator("article > p")).toHaveCount(4);

  // Use the selection left by the command, as a writer would, rather than
  // selecting again. Both paragraphs must support a second inline format.
  await commandButton(page, "italic").click();
  await expect(editor).toHaveValue("开头保持\n\n***第一段文字***\n\n***第二段文字***\n\n结尾保持");
  await expect(preview.locator("em")).toHaveText(["第一段文字", "第二段文字"]);
  await expect(preview.locator("strong")).toHaveText(["第一段文字", "第二段文字"]);
  await commandButton(page, "italic").click();
  await expect(editor).toHaveValue(bold);
  await expect(preview.locator("em")).toHaveCount(0);
  await expect(preview.locator("strong")).toHaveCount(2);
  await commandButton(page, "bold").click();
  await expect(editor).toHaveValue(source);
  await expect(preview.locator("strong,em")).toHaveCount(0);
  await expect(preview.locator("article > p")).toHaveText(["开头保持", "第一段文字", "第二段文字", "结尾保持"]);
  await expect(editor).toBeFocused();
});
