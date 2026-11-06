import { test, expect, type Page } from "@playwright/test";

const themeButton = (page: Page, value: "system" | "light" | "dark", admin = false) =>
  page.locator(`${admin ? ".admin-header" : ".site-nav"} [data-theme-value="${value}"]`);

async function expectSettled(page: Page, theme: "light" | "dark") {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition");
}

test("inherited text follows its parent through the palette change without a second flash", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/");
  await expectSettled(page, "light");

  for (const theme of ["dark", "light"] as const) {
    const frames = await page.evaluate(async target => {
      const link = document.querySelector<HTMLElement>('.site-nav a[href="/garden/"]')!;
      const footer = document.querySelector<HTMLElement>(".site-footer")!;
      const pairs = [
        [link, link.querySelector<HTMLElement>('.ui-text > [data-ui-lang="zh-CN"]')!],
        [footer, footer.querySelector<HTMLElement>('.site-footer__mark .ui-text > [data-ui-lang="zh-CN"]')!],
      ];
      const rgb = (element: HTMLElement) => getComputedStyle(element).color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const samples: { elapsed: number; colors: { parent: number[]; text: number[] }[] }[] = [];
      const start = performance.now();
      document.querySelector<HTMLButtonElement>(`.site-nav [data-theme-value="${target}"]`)!.click();
      await new Promise<void>(resolve => {
        function sample(now: number) {
          samples.push({ elapsed: now - start, colors: pairs.map(([parent, text]) => ({ parent: rgb(parent!), text: rgb(text!) })) });
          if (now - start < 1200) requestAnimationFrame(sample);
          else resolve();
        }
        requestAnimationFrame(sample);
      });
      return samples;
    }, theme);

    // These spans have no authored color: animation must preserve ordinary CSS
    // inheritance instead of making each nested span chase its moving parent.
    const inheritanceError = Math.max(...frames.flatMap(frame => frame.colors.flatMap(({ parent, text }) =>
      parent.map((channel, index) => Math.abs(channel - text[index]!)),
    )));
    expect(inheritanceError, `${theme}: inherited text must track its parent on every frame`).toBeLessThanOrEqual(2);

    const lateJumps = frames.slice(1).flatMap((frame, index) => {
        const previous = frames[index]!;
        if (frame.elapsed < 720 || frame.elapsed - previous.elapsed >= 80) return [];
        return frame.colors.flatMap(({ text }, pair) => text.map((channel, index) => Math.abs(channel - previous.colors[pair]!.text[index]!)));
      });
    expect(Math.max(0, ...lateJumps), `${theme}: settled text must not jump when the transition ends`).toBeLessThanOrEqual(5);
    await expectSettled(page, theme);
  }
});

test("theme colors change gradually, accept rapid pointer changes and settle on the last choice", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/garden/");
  await expectSettled(page, "light");

  await themeButton(page, "dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-transition", "colors");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe("rgb(244, 240, 230)");
  const during = await page.locator("body").evaluate(element => {
    const style = getComputedStyle(element);
    const motion = getComputedStyle(document.documentElement);
    return {
      background: style.backgroundColor,
      durations: motion.transitionDuration.split(",").map(value => parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000)),
      easing: motion.transitionTimingFunction,
    };
  });
  expect(during.background).not.toBe("rgb(16, 21, 28)");
  expect(during.durations.some(duration => duration >= 650 && duration <= 1000)).toBe(true);
  expect(during.easing).toContain("cubic-bezier(");

  // Real pointer input must remain usable while the palette is changing.
  const light = await themeButton(page, "light").boundingBox();
  const dark = await themeButton(page, "dark").boundingBox();
  for (const bounds of [light!, dark!, light!]) {
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  }
  await expectSettled(page, "light");
  await expect(themeButton(page, "light")).toHaveAttribute("aria-pressed", "true");
  await expect(themeButton(page, "dark")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("garden-theme"))).toBe("light");
  expect(errors).toEqual([]);
});

test("saved theme loads without an entrance animation and reduced motion switches immediately", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("garden-theme", "dark");
    (window as any).__themeTransitionValues = [];
    new MutationObserver(records => {
      for (const record of records) {
        const value = (record.target as HTMLElement).getAttribute("data-theme-transition");
        if (value) (window as any).__themeTransitionValues.push(value);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-theme-transition"] });
  });
  await page.goto("/about/");
  await expectSettled(page, "dark");
  await themeButton(page, "light").click();
  await expectSettled(page, "light");
  expect(await page.evaluate(() => document.getAnimations().filter(animation => {
    const duration = animation.effect?.getTiming().duration;
    return typeof duration === "number" && duration > 100;
  }).length)).toBe(0);
  await expect(themeButton(page, "light")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as any).__themeTransitionValues)).toEqual([]);
  expect(await page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(244, 240, 230)");
});

test("system and cross-tab theme changes preserve focused writing and the sandbox preview", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let githubRequests = 0;
  await page.route("https://api.github.com/**", route => { githubRequests++; return route.abort(); });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/admin/");
  await expect(page.locator("#entry-path")).toContainText("新文件 →");
  await expectSettled(page, "light");
  const markdown = ["## Theme state", "", ...Array.from({ length: 70 }, (_, index) => `Paragraph ${index}: 保留写作位置。\n`)].join("\n");
  const editor = page.locator("#markdown");
  await editor.fill(markdown);
  const preview = page.frameLocator("#preview");
  await expect(preview.getByRole("heading", { name: "Theme state" })).toBeVisible();
  await preview.locator("body").evaluate(element => element.setAttribute("data-theme-regression", "same-document"));
  const writing = await editor.evaluate((element: HTMLTextAreaElement) => {
    (window as any).__themeMotionEditor = element;
    element.focus(); element.setSelectionRange(90, 120, "backward"); element.scrollTop = 400;
    return { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, scroll: element.scrollTop };
  });
  expect(writing.scroll).toBeGreaterThan(0);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme-transition", "colors");
  await expectSettled(page, "dark");
  await expect(themeButton(page, "system", true)).toHaveAttribute("aria-pressed", "true");

  // A second real same-origin document writes the preference; the browser emits
  // the storage event into the editor without moving its focus or caret.
  const other = await context.newPage();
  try {
    await other.goto("/garden/");
    await other.evaluate(() => localStorage.setItem("garden-theme", "light"));
    await expectSettled(page, "light");
    await expect(themeButton(page, "light", true)).toHaveAttribute("aria-pressed", "true");
  } finally { await other.close(); }
  await expect(editor).toHaveValue(markdown);
  expect(await editor.evaluate((element: HTMLTextAreaElement) => ({
    sameNode: (window as any).__themeMotionEditor === element,
    focused: document.activeElement === element,
    start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, scroll: element.scrollTop,
  }))).toEqual({ sameNode: true, focused: true, ...writing });
  await expect(preview.locator("body")).toHaveAttribute("data-theme-regression", "same-document");
  expect(githubRequests).toBe(0);
  expect(errors).toEqual([]);
});
