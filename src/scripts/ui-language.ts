import { applyUiLanguage, DEFAULT_UI_LANGUAGE, getUiLanguage, UI_LANGUAGE_KEY, type UiLanguage } from "../lib/ui-language";

function readLanguage(): UiLanguage {
  try { return localStorage.getItem(UI_LANGUAGE_KEY) === "en" ? "en" : DEFAULT_UI_LANGUAGE; }
  catch { return getUiLanguage(); }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-language-value]")) {
  button.addEventListener("click", () => {
    const language = button.dataset.languageValue === "en" ? "en" : DEFAULT_UI_LANGUAGE;
    try { localStorage.setItem(UI_LANGUAGE_KEY, language); } catch { /* Switching still works within this page when storage is unavailable. */ }
    applyUiLanguage(language);
  });
}
window.addEventListener("storage", event => {
  if (event.key === UI_LANGUAGE_KEY || event.key === null) applyUiLanguage(readLanguage());
});
window.addEventListener("pageshow", event => { if (event.persisted) applyUiLanguage(readLanguage()); });
applyUiLanguage(readLanguage());
