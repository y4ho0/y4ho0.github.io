import { applyUiLanguage, DEFAULT_UI_LANGUAGE, getUiLanguage, UI_LANGUAGE_KEY, type UiLanguage } from "../lib/ui-language";

const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let activeTransition: ViewTransition | undefined;
let namedText: { element: HTMLElement; value: string; priority: string }[] = [];
let cleanupTimer: number | undefined;
let requestId = 0;
let requestedLanguage = getUiLanguage();

function readLanguage(): UiLanguage {
  try { return localStorage.getItem(UI_LANGUAGE_KEY) === "en" ? "en" : DEFAULT_UI_LANGUAGE; }
  catch { return getUiLanguage(); }
}

function clearTransition() {
  activeTransition?.skipTransition();
  activeTransition = undefined;
  for (const { element, value, priority } of namedText) {
    if (value) element.style.setProperty("view-transition-name", value, priority);
    else element.style.removeProperty("view-transition-name");
  }
  namedText = [];
  window.clearTimeout(cleanupTimer);
  delete root.dataset.uiLanguageTransition;
}

function changeLanguage(language: UiLanguage, animate = false) {
  const request = ++requestId;
  requestedLanguage = language;
  clearTransition();
  if (!animate || language === getUiLanguage() || reducedMotion.matches || document.hidden) {
    applyUiLanguage(language);
    return;
  }

  const update = () => {
    // Skipping an old view transition still runs its update callback.
    if (request === requestId) applyUiLanguage(language);
  };
  if (typeof document.startViewTransition === "function") {
    root.dataset.uiLanguageTransition = "native";
    // Snapshot translated text rather than its interactive ancestors. Capturing
    // the root or a dialog makes their live controls unavailable to hit testing.
    namedText = [...document.querySelectorAll<HTMLElement>(".ui-text,[data-ui-message],[data-ui-date]")]
      .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden")
      .map(element => ({ element, value: element.style.getPropertyValue("view-transition-name"), priority: element.style.getPropertyPriority("view-transition-name") }));
    namedText.forEach(({ element }, index) => { element.style.setProperty("view-transition-name", `language-text-${index}`); });
    try {
      const transition = document.startViewTransition(update);
      activeTransition = transition;
      void transition.ready.catch(() => { /* A newer choice can skip this animation. */ });
      void transition.updateCallbackDone.catch(() => {
        if (request === requestId) applyUiLanguage(language);
      });
      const finish = () => { if (request === requestId) clearTransition(); };
      void transition.finished.then(finish, finish);
      return;
    } catch { clearTransition(); }
  }

  update();
  // Older browsers keep the same DOM and gently reveal the selected text.
  // Flush a previous reveal before starting another rapid language change.
  void root.offsetWidth;
  root.dataset.uiLanguageTransition = "fallback";
  cleanupTimer = window.setTimeout(() => {
    if (request === requestId) clearTransition();
  }, 240);
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-language-value]")) {
  button.addEventListener("click", () => {
    const language = button.dataset.languageValue === "en" ? "en" : DEFAULT_UI_LANGUAGE;
    try { localStorage.setItem(UI_LANGUAGE_KEY, language); } catch { /* Switching still works within this page when storage is unavailable. */ }
    changeLanguage(language, true);
  });
}
window.addEventListener("storage", event => {
  if (event.key === UI_LANGUAGE_KEY || event.key === null) changeLanguage(readLanguage());
});
window.addEventListener("pageshow", event => { if (event.persisted) changeLanguage(readLanguage()); });
// Do not carry language snapshots into navigation or a cached document.
window.addEventListener("pageswap", () => changeLanguage(requestedLanguage));
window.addEventListener("pagehide", () => changeLanguage(requestedLanguage));
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) changeLanguage(requestedLanguage);
});
changeLanguage(readLanguage());
