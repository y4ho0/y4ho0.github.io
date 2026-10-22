// Set the chosen interface language before CSS paints either language variant.
// This preference never contains authentication data.
(() => {
  let language = "zh-CN";
  try { if (localStorage.getItem("garden-language") === "en") language = "en"; } catch { /* Chinese is the static default. */ }
  document.documentElement.dataset.uiLanguage = language;
  document.documentElement.lang = language;
})();
