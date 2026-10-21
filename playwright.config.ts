import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "admin-browser.spec.ts",
  fullyParallel: true,
  workers: 2,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  outputDir: "node_modules/.cache/playwright-results",
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:4321",
    viewport: { width: 1500, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4321",
    url: "http://127.0.0.1:4321/admin/",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
