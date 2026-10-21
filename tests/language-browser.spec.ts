import { test, expect, type Page } from "@playwright/test";

type Language = "zh-CN" | "en";
const englishAboutHeading = "A quiet place for public work";
const chineseAboutHeading = "一个安静记录的地方";
const resultTitle = "原样文章 Mixed title";
const resultDescription = "原始摘要 Original summary";

function languageButton(page: Page, language: Language, mobile = false) {
  return page.locator(`${mobile ? ".mobile-menu" : ".site-nav"} [data-language-value="${language}"]`);
}

async function expectLanguage(page: Page, language: Language) {
  await expect(page.locator("html")).toHaveAttribute("data-ui-language", language);
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}

async function switchLanguage(page: Page, language: Language, mobile = false) {
  await languageButton(page, language, mobile).click();
  await expectLanguage(page, language);
  await expect(languageButton(page, language, mobile)).toHaveAttribute("aria-pressed", "true");
}

async function mockPagefind(page: Page) {
  let requests = 0;
  await page.route("**/pagefind/pagefind.js", route => {
    requests++;
    return route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `export async function search(query) {
        window.__languageSearches = [...(window.__languageSearches || []), query];
        await new Promise(resolve => setTimeout(resolve, 100));
        if (query === "pending") await new Promise(resolve => { window.__releaseLanguageSearch = resolve; });
        if (query === "unavailable") throw new Error("Mock search unavailable");
        if (query === "empty") return { results: [] };
        return { results: [{ data: async () => ({
          url: "/notes/original-content/", excerpt: "Original excerpt",
          meta: { title: ${JSON.stringify(resultTitle)}, description: ${JSON.stringify(resultDescription)} }
        }) }] };
      }`,
    });
  });
  return { requests: () => requests };
}

test("public pages default to Chinese with unchanged routes and friend content", async ({ page }) => {
  await page.goto("/about/");
  await expectLanguage(page, "zh-CN");
  await expect(page.getByRole("heading", { level: 1, name: chineseAboutHeading, exact: true })).toBeVisible();
  for (const [path, label] of [["garden", "花园"], ["courses", "课程"], ["labs", "实验"], ["essays", "随笔"], ["archive", "归档"], ["about", "关于"]]) {
    await expect(page.locator(`.site-nav a[href="/${path}/"]`)).toHaveAccessibleName(label);
  }
  await expect(page.getByRole("heading", { level: 2, name: "友链", exact: true })).toBeVisible();
  await expect(page.locator(".friend-link strong")).toHaveText("zdd14990");
  await expect(page.locator(".friend-description")).toHaveText("家里蹲是绝对正义");
  await expect(page.locator(".friend-link")).toHaveAttribute("href", "https://zdd14990.github.io/");
  await expect(page.locator('.site-nav [data-theme-value="system"]')).toHaveAccessibleName("跟随系统");
  await expect(page.locator('.site-nav [data-theme-value="light"]')).toHaveAccessibleName("浅色");
  await expect(page.locator('.site-nav [data-theme-value="dark"]')).toHaveAccessibleName("深色");
});

test("Chinese remains readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4321/about/");
    await expectLanguage(page, "zh-CN");
    await expect(page.getByRole("heading", { level: 1, name: chineseAboutHeading, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: englishAboutHeading, exact: true })).toHaveCount(0);
    await expect(page.locator('.site-nav a[href="/garden/"]')).toHaveAccessibleName("花园");
    await expect(page.getByRole("heading", { level: 2, name: "友链", exact: true })).toBeVisible();
    await expect(page.locator(".friend-description")).toHaveText("家里蹲是绝对正义");
    await expect(page).toHaveTitle(/[\u3400-\u9fff]/u);
  } finally { await context.close(); }
});

test("English switches immediately without rebuilding content, preserves theme and persists through reload and navigation", async ({ page }) => {
  await page.goto("/about/");
  await expectLanguage(page, "zh-CN");
  await page.locator('.site-nav [data-theme-value="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const initial = await page.evaluate(() => {
    (window as any).__languageArticle = document.querySelector("article");
    (window as any).__languageFriend = document.querySelector(".friend-link");
    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute("content"),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    };
  });
  await switchLanguage(page, "en");
  await expect(page.getByRole("heading", { level: 1, name: englishAboutHeading, exact: true })).toBeVisible();
  await expect(page.locator('.site-nav a[href="/about/"]')).toHaveAccessibleName("About");
  await expect(page.getByRole("heading", { level: 2, name: "Friends", exact: true })).toBeVisible();
  await expect(page.locator('.site-nav [data-theme-value="dark"]')).toHaveAccessibleName("Dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => ({
    sameArticle: (window as any).__languageArticle === document.querySelector("article"),
    sameFriend: (window as any).__languageFriend === document.querySelector(".friend-link"),
    language: localStorage.getItem("garden-language"),
    theme: localStorage.getItem("garden-theme"),
  }))).toEqual({ sameArticle: true, sameFriend: true, language: "en", theme: "dark" });
  await expect(page.locator(".friend-description")).toHaveText("家里蹲是绝对正义");
  await expect(page).not.toHaveTitle(initial.title);
  await expect(page.locator('meta[name="description"]')).not.toHaveAttribute("content", initial.description!);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", await page.title());
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", await page.title());
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", initial.canonical!);

  await page.reload(); await expectLanguage(page, "en");
  await expect(page.getByRole("heading", { level: 1, name: englishAboutHeading, exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator('.site-nav a[href="/courses/"]').click();
  await expect(page).toHaveURL(/\/courses\/$/u); await expectLanguage(page, "en");
  await expect(page.locator('.site-nav a[href="/courses/"]')).toHaveAccessibleName("Courses");
  await switchLanguage(page, "zh-CN");
  await page.locator('.site-nav a[href="/about/"]').click();
  await expect(page).toHaveURL(/\/about\/$/u); await expectLanguage(page, "zh-CN");
  await expect(page.getByRole("heading", { level: 1, name: chineseAboutHeading, exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("garden-language"))).toBe("zh-CN");
});

test("mobile menus switch languages and fit 320px and 390px screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/about/");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".mobile-menu-trigger")).toHaveAccessibleName("菜单");
    await page.locator(".mobile-menu-trigger").click();
    await expect(page.locator("#mobile-menu")).toBeVisible();
    await switchLanguage(page, "en", true);
    await expect(page.locator("#mobile-menu")).toBeVisible();
    await expect(page.locator('.mobile-menu a[href="/about/"]')).toHaveAccessibleName("About");
    await expect(page.locator('.mobile-menu [data-theme-value="system"]')).toHaveAccessibleName("System");
    await expect(page.locator(".mobile-menu-trigger")).toHaveAccessibleName("Menu");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px English page`).toBe(true);
    const bounds = await page.locator("#mobile-menu").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await switchLanguage(page, "zh-CN", true);
    await expect(page.locator('.mobile-menu a[href="/about/"]')).toHaveAccessibleName("关于");
    await page.locator(".mobile-menu__close").click();
    await expect(page.locator("#mobile-menu")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px Chinese page`).toBe(true);
    await expect(page.getByRole("heading", { level: 1, name: chineseAboutHeading, exact: true })).toBeVisible();
  }
});

test("blocked localStorage falls back to Chinese and still permits runtime language and theme changes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() { throw new DOMException("Storage blocked for this test", "SecurityError"); },
  }));
  await page.goto("/about/"); await expectLanguage(page, "zh-CN");
  await switchLanguage(page, "en");
  await expect(page.getByRole("heading", { level: 1, name: englishAboutHeading, exact: true })).toBeVisible();
  await page.locator('.site-nav [data-theme-value="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await switchLanguage(page, "zh-CN");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload(); await expectLanguage(page, "zh-CN");
  expect(errors).toEqual([]);
});

test("search translates status and placeholder while retaining the query, input node and original results", async ({ page }) => {
  const index = await mockPagefind(page);
  await page.goto("/search/"); await expectLanguage(page, "zh-CN");
  const input = page.locator("main [data-search-input]");
  const status = page.locator("main [data-search-status]");
  const results = page.locator("main [data-search-results]");
  expect(index.requests()).toBe(0);
  const chinesePlaceholder = await input.getAttribute("placeholder");
  expect(chinesePlaceholder).toBe("开始输入…");
  await expect(status).toHaveText("使用搜索时才会加载索引。", { useInnerText: true });
  await input.fill("a"); await expect(status).toHaveText("请输入至少两个字符。");
  expect(index.requests()).toBe(0);
  await input.fill("matrix");
  await expect(results.locator("strong")).toHaveText(resultTitle);
  await expect(results.locator("span")).toHaveText(resultDescription);
  await expect(status).toHaveText("1 条结果。");
  await page.evaluate(() => { (window as any).__languageSearchInput = document.querySelector("main [data-search-input]"); });
  await switchLanguage(page, "en");
  await expect(input).toHaveValue("matrix");
  await expect(input).toHaveAttribute("placeholder", "Start typing…");
  await expect(status).toHaveText("1 result.");
  await expect(results.locator("strong")).toHaveText(resultTitle);
  await expect(results.locator("span")).toHaveText(resultDescription);
  expect(await page.evaluate(() => ({
    sameInput: (window as any).__languageSearchInput === document.querySelector("main [data-search-input]"),
    searches: (window as any).__languageSearches,
  }))).toEqual({ sameInput: true, searches: ["matrix"] });
  expect(index.requests()).toBe(1);
  await input.fill("empty"); await expect(status).toHaveText("No public content matched.");
  await switchLanguage(page, "zh-CN");
  await expect(status).toHaveText("没有找到匹配的公开内容。"); await expect(results.locator("li")).toHaveCount(0);
  await expect(input).toHaveValue("empty"); await expect(input).toHaveAttribute("placeholder", chinesePlaceholder!);
  await input.fill("pending"); await expect(status).toHaveText("正在搜索…");
  await switchLanguage(page, "en"); await expect(status).toHaveText("Searching…");
  await expect(input).toHaveValue("pending");
  await page.waitForFunction(() => typeof (window as any).__releaseLanguageSearch === "function");
  await page.evaluate(() => { (window as any).__releaseLanguageSearch(); delete (window as any).__releaseLanguageSearch; });
  await expect(status).toHaveText("1 result."); await expect(results.locator("strong")).toHaveText(resultTitle);
  await input.fill("a");
  await expect(status).toHaveText("Enter at least two characters.");
});

test("search failures remain clear and translate when the interface language changes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await mockPagefind(page);
  await page.goto("/search/");
  const input = page.locator("main [data-search-input]");
  const status = page.locator("main [data-search-status]");
  await input.fill("unavailable");
  await expect(status).toHaveText("当前预览暂时无法搜索。正式站点会在页面构建后生成索引。");
  await switchLanguage(page, "en");
  await expect(status).toHaveText("Search is unavailable in this preview. The published site builds its index after the pages.");
  await expect(input).toHaveValue("unavailable");
  await expect(page.locator("main [data-search-results] li")).toHaveCount(0);
  await switchLanguage(page, "zh-CN");
  await expect(status).toHaveText("当前预览暂时无法搜索。正式站点会在页面构建后生成索引。");
  expect(errors).toEqual([]);
});

test("the real Pagefind index finds Chinese phrases when it first loads with the English interface", async ({ page }) => {
  // Each Playwright page fixture has a fresh browser context. Do not install
  // mockPagefind here: the production index, WASM and segmentation must work.
  let indexLoads = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/pagefind/pagefind.js") indexLoads++; });
  await page.goto("/search/"); await expectLanguage(page, "zh-CN");
  await switchLanguage(page, "en");
  expect(indexLoads).toBe(0);
  const input = page.locator("main [data-search-input]");
  const status = page.locator("main [data-search-status]");
  const results = page.locator("main [data-search-results]");
  await input.fill("数字花园");
  await expect(status).toHaveText("1 result.");
  await expect(results.locator("li")).toHaveCount(1);
  await expect(results.locator("a")).toHaveAttribute("href", "/about/");
  await expect(input).toHaveValue("数字花园");
  expect(indexLoads).toBe(1);
  await page.evaluate(() => {
    (window as any).__realLanguageInput = document.querySelector("main [data-search-input]");
    (window as any).__realLanguageResult = document.querySelector("main [data-search-results] a");
  });

  await switchLanguage(page, "zh-CN");
  await expect(status).toHaveText("1 条结果。");
  await expect(input).toHaveValue("数字花园");
  await expect(results.locator("a")).toHaveAttribute("href", "/about/");
  expect(await page.evaluate(() => ({
    input: (window as any).__realLanguageInput === document.querySelector("main [data-search-input]"),
    result: (window as any).__realLanguageResult === document.querySelector("main [data-search-results] a"),
  }))).toEqual({ input: true, result: true });
  await input.fill("成长状态");
  await expect(status).toHaveText("1 条结果。");
  await expect(results.locator("li")).toHaveCount(1);
  await expect(results.locator("a")).toHaveAttribute("href", "/about/");
  await expect(input).toHaveValue("成长状态");
  expect(indexLoads).toBe(1);
});
