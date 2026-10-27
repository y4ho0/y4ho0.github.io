import { test, expect } from "@playwright/test";

test("admin inserts a focused term note and previews the same terminology", async ({ page }) => {
  await page.goto("/admin/");
  const editor = page.locator("#markdown");
  await editor.fill("HDFS 中 NameNode 负责元数据。");
  await editor.evaluate((node: HTMLTextAreaElement) => {
    const start = node.value.indexOf("NameNode");
    node.focus();
    node.setSelectionRange(start, start + "NameNode".length);
  });
  await page.locator("#insert-term-note").click();
  await expect(page.locator("#knowledge-label")).toHaveValue("NameNode");
  await page.locator("#knowledge-note").fill("名称节点：负责命名空间和块元数据。");
  await page.locator("#knowledge-form button[type=submit]").click();
  await expect(editor).toHaveValue(/:term\[NameNode\]\{note="名称节点：负责命名空间和块元数据。"\}/u);
  const preview = page.frameLocator("#preview");
  const trigger = preview.locator(".term-note__trigger");
  const panel = preview.locator(".term-note__panel");
  await expect(trigger).toBeVisible();
  await expect(panel).toHaveText("名称节点：负责命名空间和块元数据。");
  await expect(panel).toHaveCSS("visibility", "hidden");

  // Regression: the tooltip must stay open after moving from the word to the
  // card, not vanish when pointer leaves the word.
  await trigger.hover();
  await expect(panel).toHaveCSS("visibility", "visible");
  // The preview deliberately executes no JS. Focus keeps the fixed card open
  // while travelling to its safe on-screen position.
  await trigger.focus();
  await panel.hover();
  await expect(panel).toHaveCSS("visibility", "visible");
  await expect(panel).toHaveCSS("user-select", "text");
  await expect(panel).toHaveCSS("pointer-events", "auto");

  // Verify native drag selection rather than merely checking a CSS class.
  const rect = await panel.boundingBox();
  expect(rect).not.toBeNull();
  if (rect) {
    await page.mouse.move(rect.x + 20, rect.y + 22);
    await page.mouse.down();
    await page.mouse.move(rect.x + Math.min(rect.width - 20, 125), rect.y + 22, { steps: 6 });
    await page.mouse.up();
    const selected = await panel.evaluate(element => element.ownerDocument.getSelection()?.toString() ?? "");
    expect(selected.length).toBeGreaterThan(0);
    await expect(panel).toHaveCSS("visibility", "visible");
  }
});

test("admin creates only safe prototype cards", async ({ page }) => {
  await page.goto("/admin/");
  await page.locator("#insert-prototype").click();
  await page.locator("#knowledge-label").fill("HDFS 写入");
  await page.locator("#knowledge-note").fill("逐步展示 NameNode 与 DataNode 的协调。");
  await page.locator("#knowledge-url").fill("javascript:alert(1)");
  await page.locator("#knowledge-form button[type=submit]").click();
  await expect(page.locator("#knowledge-error")).toContainText("HTTPS");
  await expect(page.locator("#knowledge-dialog")).toBeVisible();
  await page.locator("#knowledge-url").fill("/demos/hdfs-write/");
  await page.locator("#knowledge-form button[type=submit]").click();
  await expect(page.locator("#knowledge-dialog")).toBeHidden();
  await expect(page.locator("#markdown")).toHaveValue(/:::prototype/u);
  const preview = page.frameLocator("#preview");
  await expect(preview.locator(".prototype-card a")).toHaveAttribute("href", "/demos/hdfs-write/");
  await expect(preview.locator("iframe")).toHaveCount(0);
});

test("HDFS demo uses no remote APIs and advances all four stages", async ({ page }) => {
  const outside: string[] = [];
  page.on("request", request => {
    if (!request.url().startsWith("http://127.0.0.1:4321/") && !request.url().startsWith("data:")) outside.push(request.url());
  });
  await page.goto("/demos/hdfs-write/");
  await expect(page.locator("#stage-count")).toHaveText("01 / 04");
  for (const count of ["02 / 04", "03 / 04", "04 / 04"]) {
    await page.locator("#next").click();
    await expect(page.locator("#stage-count")).toHaveText(count);
  }
  await expect(page.locator("#next")).toBeDisabled();
  await page.locator("#restart").click();
  await expect(page.locator("#stage-count")).toHaveText("01 / 04");
  expect(outside).toEqual([]);
});


test("article reader pins a note while selecting, then closes outside or on Escape", async ({ page }) => {
  let article = false;
  for (const index of ["/garden/", "/labs/", "/essays/"]) {
    await page.goto(index);
    const link = page.locator(".content-card h2 a").first();
    if (await link.count()) {
      await link.click();
      article = true;
      break;
    }
  }
  test.skip(!article, "No publicly published article is available for reader integration.");

  // Inject a known-good rendered fixture into an existing article. The
  // article's delegated listeners and real production CSS are already loaded.
  await page.locator(".prose[data-pagefind-body]").evaluate(prose => {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = '<span class="term-note"><span class="term-note__trigger" tabindex="0" role="button" aria-expanded="false">RPC</span><span class="term-note__panel" role="note">Remote Procedure Call，远程过程调用。允许进程通过网络请求其他服务。</span></span>';
    prose.prepend(paragraph);
  });
  const term = page.locator(".term-note").first();
  const trigger = term.locator(".term-note__trigger");
  const panel = term.locator(".term-note__panel");

  await trigger.hover();
  await panel.hover();
  await expect(panel).toHaveCSS("visibility", "visible");
  await panel.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const rect = await panel.boundingBox();
  expect(rect).not.toBeNull();
  if (rect) {
    await page.mouse.move(rect.x + 22, rect.y + 25);
    await page.mouse.down();
    await page.mouse.move(rect.x + 145, rect.y + 25, { steps: 8 });
    await page.mouse.up();
  }
  const selection = await panel.evaluate(element => element.ownerDocument.getSelection()?.toString() ?? "");
  expect(selection.length).toBeGreaterThan(0);
  await expect(panel).toHaveCSS("visibility", "visible");

  await page.locator(".article-header h1").click();
  await expect(panel).toHaveCSS("visibility", "hidden");
  await trigger.focus();
  await expect(panel).toHaveCSS("visibility", "visible");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCSS("visibility", "hidden");
});
