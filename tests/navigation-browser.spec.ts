import { test, expect, type Page } from "@playwright/test";

type Preference = "system" | "light" | "dark";
type Language = "zh-CN" | "en";

// The classic head bootstrap stays available, while the interactive modules
// cannot repair server-rendered controls. This makes a brief navigation flash
// observable for several real browser frames instead of racing fast local JS.
async function holdInteractiveModules(page: Page) {
  let paused = false;
  let release = () => {};
  let gate = Promise.resolve();
  let requests = 0;
  await page.route("**/_astro/*.js", async route => {
    if (paused) { requests++; await gate; }
    await route.continue();
  });
  return {
    pause() { requests = 0; paused = true; gate = new Promise<void>(resolve => { release = resolve; }); },
    resume() { paused = false; release(); },
    requests: () => requests,
  };
}

async function expectPaintedPreference(page: Page, selector: string, preference: Preference, language?: Language) {
  await expect(page.locator(`${selector} [data-theme-value="${preference}"]`)).toBeAttached();
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", preference);
  if (preference !== "system") await expect(page.locator("html")).toHaveAttribute("data-theme", preference);
  if (language) await expect(page.locator("html")).toHaveAttribute("data-ui-language", language);
  const frames = await page.evaluate(async ({ selector, preference, language }) => {
    const probe = document.createElement("span");
    probe.style.cssText = "display:none;color:var(--color-action)";
    document.body.append(probe);
    const action = getComputedStyle(probe).color;
    probe.remove();
    const snapshots = [];
    for (let frame = 0; frame < 3; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      snapshots.push([...document.querySelectorAll<HTMLButtonElement>(`${selector} [data-theme-value], ${selector} [data-language-value]`)].map(button => {
        const selected = button.dataset.themeValue ? button.dataset.themeValue === preference : button.dataset.languageValue === language;
        return {
          value: button.dataset.themeValue ?? button.dataset.languageValue,
          background: getComputedStyle(button).backgroundColor,
          expected: selected ? action : "rgba(0, 0, 0, 0)",
        };
      }));
    }
    return snapshots;
  }, { selector, preference, language });
  for (const snapshot of frames) {
    expect(snapshot.length).toBe(language ? 5 : 3);
    for (const button of snapshot) expect(button.background, `${button.value} must paint its saved state before modules run`).toBe(button.expected);
  }
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition");
}

async function expectBoundPreference(page: Page, selector: string, preference: Preference, language?: Language) {
  await page.waitForLoadState("load");
  await expect(page.locator(`${selector} [data-theme-value="${preference}"]`)).toHaveAttribute("aria-pressed", "true");
  if (language) await expect(page.locator(`${selector} [data-language-value="${language}"]`)).toHaveAttribute("aria-pressed", "true");
}

test("saved dark and English controls paint correctly through real navigation and reload before modules run", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("garden-theme", "dark");
    localStorage.setItem("garden-language", "en");
  });
  const modules = await holdInteractiveModules(page);
  try {
    modules.pause();
    await page.goto("/garden/", { waitUntil: "commit" });
    await expectPaintedPreference(page, ".site-nav", "dark", "en");
    expect(modules.requests()).toBeGreaterThan(0);
    modules.resume();
    await expectBoundPreference(page, ".site-nav", "dark", "en");

    for (const path of ["/archive/", "/about/"]) {
      modules.pause();
      await Promise.all([
        page.waitForURL(`**${path}`, { waitUntil: "commit" }),
        page.locator(`.site-nav a[href="${path}"]`).click({ noWaitAfter: true }),
      ]);
      await expectPaintedPreference(page, ".site-nav", "dark", "en");
      expect(modules.requests()).toBeGreaterThan(0);
      modules.resume();
      await expectBoundPreference(page, ".site-nav", "dark", "en");
    }

    modules.pause();
    await page.reload({ waitUntil: "commit" });
    await expectPaintedPreference(page, ".site-nav", "dark", "en");
    modules.resume();
    await expectBoundPreference(page, ".site-nav", "dark", "en");
  } finally { modules.resume(); }
});

test("saved light and Chinese controls paint before modules even when the operating system is dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    localStorage.setItem("garden-theme", "light");
    localStorage.setItem("garden-language", "zh-CN");
  });
  const modules = await holdInteractiveModules(page);
  try {
    modules.pause();
    await page.goto("/archive/", { waitUntil: "commit" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expectPaintedPreference(page, ".site-nav", "light", "zh-CN");
    expect(modules.requests()).toBeGreaterThan(0);
    modules.resume();
    await expectBoundPreference(page, ".site-nav", "light", "zh-CN");

    modules.pause();
    await Promise.all([
      page.waitForURL("**/garden/", { waitUntil: "commit" }),
      page.locator('.site-nav a[href="/garden/"]').click({ noWaitAfter: true }),
    ]);
    await expectPaintedPreference(page, ".site-nav", "light", "zh-CN");
    modules.resume();
    await expectBoundPreference(page, ".site-nav", "light", "zh-CN");
  } finally { modules.resume(); }
});

test("mobile and admin controls use the same early preference without a System highlight", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("garden-theme", "dark");
    localStorage.setItem("garden-language", "en");
  });
  const modules = await holdInteractiveModules(page);
  try {
    modules.pause();
    await page.goto("/archive/", { waitUntil: "commit" });
    // Dialog content is initially hidden, but its CSS already needs to agree
    // with the root preference before the menu handler becomes available.
    await expectPaintedPreference(page, ".mobile-menu", "dark", "en");
    modules.resume();
    await expectBoundPreference(page, ".mobile-menu", "dark", "en");
    await page.locator(".mobile-menu-trigger").click();
    await expect(page.locator(".mobile-menu")).toBeVisible();
    await expectPaintedPreference(page, ".mobile-menu", "dark", "en");

    modules.pause();
    await page.goto("/admin/", { waitUntil: "commit" });
    await expectPaintedPreference(page, ".admin-header", "dark");
    expect(modules.requests()).toBeGreaterThan(0);
    modules.resume();
    await expectBoundPreference(page, ".admin-header", "dark");
  } finally { modules.resume(); }
});
