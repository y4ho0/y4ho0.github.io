import { test, expect, type Page } from "@playwright/test";

async function prepare(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.evaluate(() => {
    const layer = document.querySelector(".ambient-click-layer")!;
    layer.setAttribute("data-observed-effects", "0");
    new MutationObserver(records => {
      const added = records.flatMap(record => [...record.addedNodes])
        .filter(node => node instanceof Element && node.matches(".ambient-click-group")).length;
      layer.setAttribute("data-observed-effects", String(Number(layer.getAttribute("data-observed-effects")) + added));
    }).observe(layer, { childList: true });
  });
  const hero = await page.locator(".hero").boundingBox();
  return { x: hero!.x + 8, y: hero!.y + hero!.height / 2 };
}

async function effectCount(page: Page) {
  return Number(await page.locator(".ambient-click-layer").getAttribute("data-observed-effects"));
}

test("rapid double and triple clicks in decorative whitespace keep producing effects without selecting adjacent text", async ({ page }) => {
  const point = await prepare(page);
  for (const clickCount of [2, 3, 3]) {
    const before = await effectCount(page);
    await page.mouse.click(point.x, point.y, { clickCount, delay: 20 });
    await expect.poll(() => effectCount(page)).toBeGreaterThan(before);
    expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
    expect(await page.locator(".ambient-click-group").count()).toBeLessThanOrEqual(2);
    // Effects are deliberately rate-limited; each burst still contains real
    // rapid clicks, while the next burst begins outside the throttle window.
    await page.waitForTimeout(150);
  }
});

test("real text selection stays native and does not disable subsequent whitespace effects", async ({ page }) => {
  const point = await prepare(page);
  const text = page.locator('.hero__intro [data-ui-lang="zh-CN"]');
  await text.dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
  expect(await effectCount(page)).toBe(0);

  await page.mouse.click(point.x, point.y);
  await expect.poll(() => effectCount(page)).toBe(1);

  const bounds = await text.boundingBox();
  await page.mouse.move(bounds!.x + 4, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + Math.min(150, bounds!.width - 4), bounds!.y + bounds!.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(2);
  expect(await effectCount(page)).toBe(1);
});

test("secondary clicks, globe interaction and reduced-motion preference do not emit ambient particles", async ({ page }) => {
  const point = await prepare(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.keyboard.press("Escape");
  const globe = page.locator(".globe-earth canvas");
  await globe.scrollIntoViewIfNeeded();
  const bounds = await globe.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 40, bounds!.y + bounds!.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await effectCount(page)).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.mouse.click(point.x, point.y, { clickCount: 3 });
  expect(await effectCount(page)).toBe(0);
});

async function canvasReadingArea(page: Page) {
  return page.locator(".home-canvas").evaluate((element: HTMLCanvasElement) => {
    const bounds = element.getBoundingClientRect();
    const context = element.getContext("2d")!;
    const pixels = context.getImageData(0, 0, element.width, element.height);
    const scaleX = element.width / bounds.width;
    const scaleY = element.height / bounds.height;
    const zones = (element.dataset.readingZoneLayout ?? "").split(";").filter(Boolean).map(zone => zone.split(",").map(Number));
    let painted = 0;
    for (let index = 3; index < pixels.data.length; index += 64) if (pixels.data[index]) painted++;
    let inkOverText = 0;
    let uncovered = 0;
    let checked = 0;
    const walker = document.createTreeWalker(document.querySelector(".hero__inner")!, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement!;
      if (!node.textContent?.trim() || parent.closest(".visually-hidden") || getComputedStyle(parent).visibility === "hidden") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        checked++;
        const left = rect.left - bounds.left;
        const top = rect.top - bounds.top;
        if (!zones.some(([x, y, width, height]) => left >= x - 9 && top >= y - 9
          && left + rect.width <= x + width + 9 && top + rect.height <= y + height + 9)) uncovered++;
        for (let y = Math.max(0, Math.floor(top * scaleY)); y < Math.min(element.height, Math.ceil((top + rect.height) * scaleY)); y++) {
          for (let x = Math.max(0, Math.floor(left * scaleX)); x < Math.min(element.width, Math.ceil((left + rect.width) * scaleX)); x++) {
            if (pixels.data[(y * element.width + x) * 4 + 3]) inkOverText++;
          }
        }
      }
    }
    return { painted, inkOverText, uncovered, checked };
  });
}

async function expectClearReadingArea(page: Page, requireDecoration = true) {
  await expect.poll(async () => {
    const area = await canvasReadingArea(page);
    return { content: area.checked > 5, decoration: !requireDecoration || area.painted > 20,
      inkOverText: area.inkOverText, uncovered: area.uncovered };
  }, { message: "real canvas pixels avoid current text while decorative objects remain visible" })
    .toEqual({ content: true, decoration: true, inkOverText: 0, uncovered: 0 });
}

test("floating objects refresh their reading areas when language changes without a canvas resize", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const quote = page.locator(".daily-quote");
  if (await quote.count()) await expect(quote).toHaveAttribute("data-quote-animation", "complete");
  await expectClearReadingArea(page);
  const canvasSize = await page.locator(".home-canvas").getAttribute("data-canvas-size");
  for (const language of ["en", "zh-CN", "en"] as const) {
    await page.locator(`.site-nav [data-language-value="${language}"]`).click();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.locator("html")).not.toHaveAttribute("data-ui-language-transition");
    expect(await page.locator(".home-canvas").getAttribute("data-canvas-size")).toBe(canvasSize);
    await expectClearReadingArea(page);
    const models = await page.locator(".home-canvas").evaluate(element => ({
      formed: Number((element as HTMLElement).dataset.formedObjects),
      count: Number((element as HTMLElement).dataset.entityCount),
    }));
    expect(models.formed, "language changes preserve already formed objects").toBe(models.count);
  }
  const intro = await page.locator(".hero__intro").boundingBox();
  await page.mouse.move(intro!.x + intro!.width - 10, intro!.y + intro!.height / 2, { steps: 8 });
  await expectClearReadingArea(page);
});

test("floating objects keep text clear through reflow, narrow screens and static motion preferences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.site-nav [data-language-value="en"]').click();
  await expect(page.locator("html")).not.toHaveAttribute("data-ui-language-transition");
  await page.locator(".hero__intro").evaluate((element: HTMLElement) => {
    element.style.maxWidth = "24rem";
    element.style.fontSize = "1.5rem";
  });
  await expectClearReadingArea(page);
  await page.setViewportSize({ width: 390, height: 1000 });
  // A narrow column may leave no safe space for complete decorative objects.
  await expectClearReadingArea(page, false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".home-canvas")).toHaveAttribute("data-canvas-state", "static");
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('.site-nav [data-language-value="zh-CN"]')!.click();
  });
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expectClearReadingArea(page, false);
});
