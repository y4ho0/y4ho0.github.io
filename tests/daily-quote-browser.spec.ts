import { test, expect, type Page } from "@playwright/test";

const home = /^http:\/\/127\.0\.0\.1:4321\/(?:\?.*)?$/u;
const rumi = "I have been a seeker and I still am, but I stopped asking the books and the stars. I started listening to the teaching of my Soul.";
const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function quoteFixture(page: Page, text: string, language: "en" | "zh" = "en") {
  // Replace only server-provided content; the real component, animation module,
  // font loading and production styles continue to run unchanged.
  await page.unroute(home);
  await page.route(home, async route => {
    const response = await route.fetch();
    const html = await response.text();
    const length = Array.from(text).length;
    const size = length <= (language === "zh" ? 34 : 70) ? "short" : length > (language === "zh" ? 72 : 150) ? "long" : "medium";
    const escaped = escapeHtml(text);
    let replaced = false;
    const body = html.replace(/<figure\b[^>]*\bclass="[^"]*\bdaily-quote\b[^"]*"[\s\S]*?<\/figure>/u, figure => {
      replaced = true;
      return figure.replace(/daily-quote--(?:short|medium|long)/u, `daily-quote--${size}`)
        .replace(/data-quote-language="[^"]*"/u, `data-quote-language="${language}"`)
        .replace(/data-quote-size="[^"]*"/u, `data-quote-size="${size}"`)
        .replace(/data-quote-text="[^"]*"/u, `data-quote-text="${escaped}"`)
        .replace(/<blockquote\b[^>]*>/u, blockquote => blockquote.replace(/lang="[^"]*"/u, `lang="${language}"`).replace(/aria-label="[^"]*"/u, `aria-label="${escaped}"`))
        .replace(/(<span\b[^>]*class="daily-quote__sizer"[^>]*>)[\s\S]*?(<\/span>)/u, (_, open, close) => `${open}${escaped}${close}`);
    });
    expect(replaced, "production homepage includes the daily quote fixture target").toBe(true);
    await route.fulfill({ response, body });
  });
}

async function expectSeparated(page: Page, animated = true) {
  const geometry = await page.evaluate(animated => {
    const quote = document.querySelector<HTMLElement>(".daily-quote")!;
    const text = quote.querySelector<HTMLElement>(".daily-quote__text")!.getBoundingClientRect();
    const caption = quote.querySelector("figcaption")!.getBoundingClientRect();
    const intro = document.querySelector(".hero__intro")!.getBoundingClientRect();
    let glyphs: DOMRect[];
    if (animated) {
      glyphs = [...quote.querySelectorAll(".daily-quote__character")].map(character => character.getBoundingClientRect());
    } else {
      const range = document.createRange();
      range.selectNodeContents(quote.querySelector(".daily-quote__sizer")!);
      glyphs = [...range.getClientRects()];
    }
    return {
      characters: glyphs.length,
      captionGap: caption.top - Math.max(...glyphs.map(rect => rect.bottom)),
      introGap: intro.top - caption.bottom,
      insideText: glyphs.every(rect => rect.left >= text.left - 1 && rect.right <= text.right + 1),
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, animated);
  expect(geometry.characters).toBeGreaterThan(0);
  expect(geometry.captionGap, "attribution stays below the actual rendered last line").toBeGreaterThanOrEqual(4);
  expect(geometry.introGap, "following introduction stays below the attribution").toBeGreaterThanOrEqual(0);
  expect(geometry.insideText, "rendered letters stay inside the quote column").toBe(true);
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
}

test("the reported English quote keeps its attribution below real text through typing and responsive resizing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1990, height: 1196 });
  await quoteFixture(page, rumi);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".daily-quote")).toHaveAttribute("data-quote-animation", "typing");
  await expect.poll(() => page.locator(".daily-quote__character").count()).toBeGreaterThan(35);
  await expectSeparated(page);
  await page.setViewportSize({ width: 390, height: 1000 });
  await expectSeparated(page);
  await expect(page.locator(".daily-quote")).toHaveAttribute("data-quote-animation", "complete");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".daily-quote__output")).toHaveText(rumi);
  for (const width of [390, 768, 1500, 320, 1990]) {
    await page.setViewportSize({ width, height: 1196 });
    await expectSeparated(page);
  }
});

test("Chinese passages and unbroken English words fit the quote without covering the attribution", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 1100 });
  for (const { text, language } of [
    { text: "不积跬步，无以至千里；不积小流，无以成江海。学习需要耐心，也需要把每一次微小的进步记录下来。即使走得缓慢，只要方向清楚，就能看到新的风景。", language: "zh" as const },
    { text: `A long word: ${"Pneumonoultramicroscopicsilicovolcanoconiosis".repeat(4)}.`, language: "en" as const },
  ]) {
    await quoteFixture(page, text, language);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".daily-quote")).toHaveAttribute("data-quote-animation", "complete");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".daily-quote__output")).toHaveText(text);
    await expectSeparated(page);
    await page.setViewportSize({ width: 320, height: 1100 });
    await expectSeparated(page);
    await page.setViewportSize({ width: 390, height: 1100 });
  }
});

test("reduced-motion and script-free readers see one complete, separated quote", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 1000 });
  await quoteFixture(page, rumi);
  await page.goto("/");
  await expect(page.locator(".daily-quote")).toHaveAttribute("data-quote-animation", "direct");
  await expect(page.locator(".daily-quote__sizer")).toBeVisible();
  await expect(page.locator(".daily-quote__typing")).toBeHidden();
  await expect(page.locator(".daily-quote__output")).toBeEmpty();
  await page.evaluate(() => document.fonts.ready);
  await expectSeparated(page, false);
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 1000 } });
  try {
    const noScript = await context.newPage();
    await quoteFixture(noScript, rumi);
    await noScript.goto("http://127.0.0.1:4321/");
    await expect(noScript.locator(".daily-quote__sizer")).toHaveText(rumi);
    await expect(noScript.locator(".daily-quote__sizer")).toBeVisible();
    await expect(noScript.locator(".daily-quote__typing")).toBeHidden();
    await noScript.evaluate(() => document.fonts.ready);
    await expectSeparated(noScript, false);
  } finally { await context.close(); }
});
