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
  await expect(preview.locator(".term-note")).toBeVisible();
  await expect(preview.locator(".term-note")).toHaveAttribute("data-note", "名称节点：负责命名空间和块元数据。");
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
