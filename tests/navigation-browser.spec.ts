import { test, expect, type Page } from "@playwright/test";

type Preference = "system" | "light" | "dark";
type Language = "zh-CN" | "en";

interface NavigationProbe {
  received: boolean;
  transition: boolean;
  phase: "none" | "pending" | "ready" | "finished" | "failed";
  duration?: string;
  headerAnimation?: string;
  theme?: string;
  language?: string;
}

async function observeNativeNavigation(page: Page) {
  await page.addInitScript(() => {
    const probe: NavigationProbe = { received: false, transition: false, phase: "none" };
    (window as unknown as { navigationProbe: NavigationProbe }).navigationProbe = probe;
    window.addEventListener("pagereveal", event => {
      const transition = (event as Event & { viewTransition?: { ready: Promise<void>; finished: Promise<void> } }).viewTransition;
      probe.received = true;
      probe.transition = Boolean(transition);
      if (!transition) return;
      probe.phase = "pending";
      void transition.ready.then(() => {
        probe.phase = "ready";
        probe.duration = getComputedStyle(document.documentElement, "::view-transition-new(root)").animationDuration;
        probe.headerAnimation = getComputedStyle(document.documentElement, "::view-transition-new(site-header)").animationName;
        probe.theme = document.documentElement.dataset.theme;
        probe.language = document.documentElement.dataset.uiLanguage;
      }, () => { probe.phase = "failed"; });
      void transition.finished.then(() => {
        if (probe.phase !== "failed") probe.phase = "finished";
      });
    });
    window.addEventListener("pageswap", () => {
      sessionStorage.setItem("test-outgoing-navigation", JSON.stringify({
        path: location.pathname,
        openMenu: Boolean(document.querySelector<HTMLDialogElement>("#mobile-menu")?.open),
        scroll: scrollY,
      }));
    });
  });
}

async function navigationProbe(page: Page) {
  return page.evaluate(() => (window as unknown as { navigationProbe: NavigationProbe }).navigationProbe);
}

async function expectNativeFade(page: Page, theme: Preference, language: Language) {
  await expect.poll(async () => (await navigationProbe(page)).phase).toBe("finished");
  expect(await navigationProbe(page)).toMatchObject({
    received: true, transition: true, duration: "0.22s", headerAnimation: "none", theme, language,
  });
}

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

test("compact menus keep search beside Close and fit phone, tablet and landscape screens in both languages", async ({ page }) => {
  await page.goto("/about/");
  const menu = page.locator("#mobile-menu");
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1152, height: 600 }]) {
    await page.setViewportSize(size);
    for (const language of ["zh-CN", "en"]) {
      await page.locator(".mobile-menu-trigger").click();
      await menu.locator(`[data-language-value="${language}"]`).click();
      const search = await menu.locator(".mobile-menu__search-link").boundingBox();
      const close = await menu.locator(".mobile-menu__close").boundingBox();
      const bounds = await menu.boundingBox();
      expect(search!.x + search!.width).toBeLessThan(close!.x);
      expect(Math.abs(search!.y - close!.y)).toBeLessThan(1);
      expect(search!.width).toBeGreaterThanOrEqual(44);
      expect(search!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
      expect(await menu.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      await expect(menu.locator("nav a")).toHaveCount(6);
      await expect(menu.locator('nav a[href="/about/"]')).toHaveAttribute("aria-current", "page");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await menu.locator(".mobile-menu__close").click();
    }
  }
});

test("menu actions stay reachable in short windows, trap focus and lock background scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 300 });
  await page.goto("/");
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; window.scrollTo(0, 400); });
  const trigger = page.locator(".mobile-menu-trigger");
  const menu = page.locator("#mobile-menu");
  const close = menu.locator(".mobile-menu__close");
  const search = menu.locator(".mobile-menu__search-link");
  const wordmarkBefore = await page.locator(".wordmark").boundingBox();
  await trigger.click();
  await expect(close).toBeFocused();
  const wordmarkAfter = await page.locator(".wordmark").boundingBox();
  expect(wordmarkAfter!.x).toBeCloseTo(wordmarkBefore!.x, 1);
  await page.keyboard.press("Shift+Tab");
  await expect(search).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(menu.locator('[data-language-value="en"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();

  const headerBefore = await menu.locator(".mobile-menu__header").boundingBox();
  expect(await menu.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await menu.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const headerAfter = await menu.locator(".mobile-menu__header").boundingBox();
  expect(headerAfter!.y).toBeCloseTo(headerBefore!.y, 1);
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.mouse.move(4, 150);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore);

  await trigger.click();
  await search.click();
  await expect(page).toHaveURL(/\/search\/$/);
  await expect(page.locator("[data-search-input]").filter({ visible: true })).toBeVisible();
});

test("public links use a native fade while preferences, search, history and header controls keep working", async ({ page }) => {
  await observeNativeNavigation(page);
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
  await page.goto("/about/");
  await page.locator('.site-nav [data-theme-value="dark"]').click();
  await page.locator('.site-nav [data-language-value="en"]').click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition");
  await page.evaluate(() => window.scrollTo({ top: 350, behavior: "instant" }));
  const previousScroll = await page.evaluate(() => scrollY);
  expect(previousScroll).toBeGreaterThan(0);

  await page.locator('.site-nav a[href="/archive/"]').click();
  await expect(page).toHaveURL(/\/archive\/$/);
  await expectNativeFade(page, "dark", "en");
  await expectBoundPreference(page, ".site-nav", "dark", "en");
  await page.locator(".search-trigger").click();
  await expect(page.locator("#search-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#search-dialog")).toBeHidden();

  await page.goBack();
  await expect(page).toHaveURL(/\/about\/$/);
  await expectNativeFade(page, "dark", "en");
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(previousScroll, 0);
  await page.goForward();
  await expect(page).toHaveURL(/\/archive\/$/);
  await expectNativeFade(page, "dark", "en");
  await page.locator('.site-nav [data-language-value="zh-CN"]').click();
  await page.locator('.site-nav a[href="/garden/"]').click();
  await expectNativeFade(page, "dark", "zh-CN");
  await expectBoundPreference(page, ".site-nav", "dark", "zh-CN");
});

test("mobile navigation closes before its outgoing snapshot and works again after a round trip", async ({ page }) => {
  await observeNativeNavigation(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
  await page.goto("/about/");
  await page.locator(".mobile-menu-trigger").click();
  await page.locator('#mobile-menu a[href="/archive/"]').click();
  await expectNativeFade(page, "light", "zh-CN");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("test-outgoing-navigation")!))).toMatchObject({ path: "/about/", openMenu: false });
  await page.locator(".mobile-menu-trigger").click();
  await expect(page.locator("#mobile-menu")).toBeVisible();
  await page.locator(".mobile-menu__search-link").click();
  await expect(page).toHaveURL(/\/search\/$/);
  await expectNativeFade(page, "light", "zh-CN");
  const searchInput = page.locator("[data-search-input]").filter({ visible: true });
  await searchInput.fill("数字花园");
  await expect(page.locator(".search-results a").filter({ visible: true }).first()).toBeVisible();
  await page.goBack();
  await expectNativeFade(page, "light", "zh-CN");
  await expect(page.locator("#mobile-menu")).toBeHidden();
  await page.locator(".mobile-menu-trigger").click();
  await expect(page.locator("#mobile-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".mobile-menu-trigger")).toBeFocused();
});

test("reduced-motion navigation and the admin boundary do not start view transitions", async ({ page }) => {
  await observeNativeNavigation(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/about/");
  await page.locator('.site-nav a[href="/archive/"]').click();
  await expect(page).toHaveURL(/\/archive\/$/);
  await expect.poll(async () => (await navigationProbe(page)).received).toBe(true);
  expect((await navigationProbe(page)).transition).toBe(false);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Exercise a real same-origin link: page.goto alone cannot prove that the
  // destination opts out, because address-bar navigations do not transition.
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/admin/";
    link.id = "test-admin-link";
    link.textContent = "Admin";
    document.body.append(link);
  });
  await page.locator("#test-admin-link").click();
  await expect(page).toHaveURL(/\/admin\/$/);
  await expect.poll(async () => (await navigationProbe(page)).received).toBe(true);
  expect((await navigationProbe(page)).transition).toBe(false);
  await page.goBack();
  await expect(page).toHaveURL(/\/archive\/$/);
  await expect.poll(async () => (await navigationProbe(page)).received).toBe(true);
  expect((await navigationProbe(page)).transition).toBe(false);
});
