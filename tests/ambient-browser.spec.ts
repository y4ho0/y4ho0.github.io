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
