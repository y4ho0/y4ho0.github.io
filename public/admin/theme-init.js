// Apply the shared garden preference before the first paint; no credentials.
(() => {
  let preference = "system";
  try {
    const stored = localStorage.getItem("garden-theme");
    if (stored === "light" || stored === "dark") preference = stored;
  } catch { /* Default to the system theme if browser storage is unavailable. */ }
  const resolved = preference === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#10151c" : "#f4f0e6");
})();
