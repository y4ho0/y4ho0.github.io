import { test, expect, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";

// Screenshots are taken while requests are deliberately held. Playwright's
// normal font-ready wait would deadlock the very state being measured.
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";

type Language = "zh-CN" | "en";
const fontPath = /\/fonts\/lxgw-wenkai-screen\/[^/]+\.woff2(?:\?.*)?$/u;

async function isolatedPage(browser: Browser, language: Language = "zh-CN") {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4321",
    viewport: { width: 1500, height: 1000 }, reducedMotion: "reduce",
    colorScheme: language === "en" ? "dark" : "light",
  });
  await context.addInitScript((language: Language) => {
    localStorage.setItem("garden-language", language);
    localStorage.setItem("garden-theme", language === "en" ? "dark" : "light");
  }, language);
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  return { context, page, session };
}

async function actualFonts(session: CDPSession, selectors: string[]) {
  const { root } = await session.send("DOM.getDocument", { depth: -1, pierce: true });
  const results = [];
  for (const selector of selectors) {
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    expect(nodeId, `font probe exists: ${selector}`).toBeGreaterThan(0);
    const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
    results.push({ selector, fonts: fonts.filter(font => font.glyphCount > 0) });
  }
  return results;
}

async function expectWenKai(session: CDPSession, selectors: string[]) {
  for (const sample of await actualFonts(session, selectors)) {
    expect(sample.fonts.length, `${sample.selector}: real glyphs are present`).toBeGreaterThan(0);
    expect(sample.fonts.every(font => font.isCustomFont && /LXGW.*WenKai/u.test(font.familyName)),
      `${sample.selector}: glyph suppliers, not only the computed font-family`).toBe(true);
  }
}

async function pagePixels(session: CDPSession, page: Page) {
  const clip = await page.evaluate(() => ({ x: 0, y: 0, width: document.documentElement.clientWidth, height: document.documentElement.scrollHeight, scale: 1 }));
  const { data } = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip });
  return Buffer.from(data, "base64");
}

/** Compare the actual pixels with the same page with only probe text hidden.
 * Chromium can report fallback glyph metrics during font-display:block, even
 * though those glyphs are not painted. CDP font names alone cannot test FOUT. */
async function textVisibilityPixels(page: Page, session: CDPSession, selectors: string[]) {
  // Decorative media and an independently updating preview iframe do not
  // participate in this typography comparison. Their pixels must stay stable.
  await page.addStyleTag({ content: "canvas, iframe, img { visibility:hidden !important; }" });
  const shown = await pagePixels(session, page);
  const previous = await page.evaluate(selectors => selectors.map(selector => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing text probe: ${selector}`);
    const style = element.getAttribute("style");
    element.style.setProperty("visibility", "hidden", "important");
    return { selector, style };
  }), selectors);
  try {
    const hidden = await pagePixels(session, page);
    return { shown, hidden };
  } finally {
    await page.evaluate(previous => previous.forEach(({ selector, style }) => {
      const element = document.querySelector(selector)!;
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    }), previous);
  }
}

const adminProbes = [".admin-header h1", "#identity", "#notice", "#editor-heading"];
function publicProbes(path: string, language: Language) {
  const visible = `[data-ui-lang="${language}"]`;
  return [".wordmark", `.site-nav a[href="/garden/"] ${visible}`, `.site-footer__mark ${visible}`,
    ...(path === "/" ? [`.hero__intro ${visible}`, `.home-globe-panel__copy h2 ${visible}`]
      : [`.page-header h1 ${visible}`, `.page-header p ${visible}`]),
    ...(path === "/about/" ? [`article > p:first-of-type ${visible}`] : []),
  ];
}

async function fontGate(context: BrowserContext, session: CDPSession) {
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  const requests: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await context.route(fontPath, async route => {
    requests.push(route.request().url());
    await gate;
    await route.continue();
  });
  return { requests, release };
}

async function expectPreloadedCriticalFont(page: Page) {
  const href = await page.locator('link[rel="preload"][as="font"]').getAttribute("href");
  expect(href).toMatch(/\/fonts\/lxgw-wenkai-screen\/[^/]*[a-f0-9]{8,}[^/]*\.woff2$/u);
  expect(await page.locator('link[rel="preload"][as="font"]').getAttribute("crossorigin")).not.toBeNull();
  return href!;
}

async function verifyColdLoad(browser: Browser, path: string, probes: string[], language: Language = "zh-CN") {
  const { context, page, session } = await isolatedPage(browser, language);
  const gate = await fontGate(context, session);
  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect.poll(() => gate.requests.length).toBeGreaterThan(0);
    const critical = await expectPreloadedCriticalFont(page);
    expect(gate.requests.some(url => new URL(url).pathname === critical)).toBe(true);
    if (path === "/" && await page.locator(".daily-quote__sizer").count()) {
      probes.push(".daily-quote__sizer");
      if (await page.locator(".daily-quote figcaption > span").count()) probes.push(".daily-quote figcaption > span");
    }
    // Keep requests pending across real browser frames, within the browser's
    // bounded block period, rather than testing only the final loaded state.
    await page.waitForTimeout(160);
    const blocked = await textVisibilityPixels(page, session, probes);
    if (!blocked.shown.equals(blocked.hidden)) {
      await test.info().attach("held-fonts-painted", { body: blocked.shown, contentType: "image/png" });
      await test.info().attach("held-fonts-reference", { body: blocked.hidden, contentType: "image/png" });
    }
    expect(blocked.shown.equals(blocked.hidden), `${path} (${language}): held fonts must not paint fallback text`).toBe(true);
    gate.release();
    await page.evaluate(() => document.fonts.ready);
    await expectWenKai(session, probes);
    const ready = await textVisibilityPixels(page, session, probes);
    expect(ready.shown.equals(ready.hidden), `${path} (${language}): loaded text must actually be visible`).toBe(false);
  } finally {
    gate.release();
    await context.close();
  }
}

test("admin cold load waits for its self-hosted critical font without painting old glyphs", async ({ browser }) => {
  await verifyColdLoad(browser, "/admin/", adminProbes);
});

test("public home, archive and about keep initial Chinese and English glyphs consistent", async ({ browser }) => {
  test.setTimeout(90_000);
  for (const language of ["zh-CN", "en"] as const) {
    for (const path of ["/", "/archive/", "/about/"]) {
      await verifyColdLoad(browser, path, publicProbes(path, language), language);
    }
  }
});

test("ordinary and cached refreshes retain real WenKai glyphs in admin and public pages", async ({ browser }) => {
  const { context, page, session } = await isolatedPage(browser);
  const failures: string[] = [];
  page.on("requestfailed", request => { if (fontPath.test(request.url())) failures.push(request.url()); });
  try {
    for (const path of ["/admin/", "/about/"]) {
      const probes = path === "/admin/" ? adminProbes : publicProbes(path, "zh-CN");
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await expectWenKai(session, probes);
      for (let refresh = 0; refresh < 2; refresh += 1) {
        await page.reload();
        await page.evaluate(() => document.fonts.ready);
        await expectWenKai(session, probes);
        const pixels = await textVisibilityPixels(page, session, probes);
        expect(pixels.shown.equals(pixels.hidden)).toBe(false);
      }
    }
    expect(failures).toEqual([]);
  } finally { await context.close(); }
});

test("unavailable web fonts fall back to readable pages and editable local writing", async ({ browser }) => {
  const { context, page, session } = await isolatedPage(browser);
  await context.route(fontPath, route => route.abort("failed"));
  try {
    await page.goto("/admin/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("#entry-path")).toContainText("新文件 →");
    await page.locator('[name="title"]').fill("字体请求失败仍可写作");
    await page.locator('[name="description"]').fill("测试字体故障后的离线草稿。");
    await page.locator("#markdown").fill("## 字体故障\n\n输入和草稿保存仍然可用。");
    await page.locator("#save-draft").click();
    await expect(page.locator("#draft-list")).toContainText("字体请求失败仍可写作");
    for (const sample of await actualFonts(session, [".admin-header h1", "#identity"])) {
      expect(sample.fonts.some(font => !font.isCustomFont)).toBe(true);
    }
    const admin = await textVisibilityPixels(page, session, adminProbes);
    expect(admin.shown.equals(admin.hidden), "font failure must not leave admin text invisible").toBe(false);
    await page.goto("/about/");
    await page.evaluate(() => document.fonts.ready);
    const probes = publicProbes("/about/", "zh-CN");
    const publicPage = await textVisibilityPixels(page, session, probes);
    expect(publicPage.shown.equals(publicPage.hidden), "font failure must not leave public text invisible").toBe(false);
    expect((await actualFonts(session, probes)).every(sample => sample.fonts.some(font => !font.isCustomFont))).toBe(true);
    await expect(page.locator('.site-nav a[href="/archive/"]')).toBeVisible();
  } finally { await context.close(); }
});
