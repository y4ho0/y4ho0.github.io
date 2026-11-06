export type UiLanguage = "zh-CN" | "en";
export interface UiPair { zh: string; en: string }
export const UI_LANGUAGE_KEY = "garden-language";
export const DEFAULT_UI_LANGUAGE: UiLanguage = "zh-CN";
const labelAttributes = new Set(["aria-label", "aria-description", "placeholder", "title", "alt", "label", "content", "textContent"]);

function isPair(value: unknown): value is UiPair {
  return Boolean(value && typeof value === "object" && "zh" in value && typeof value.zh === "string" && "en" in value && typeof value.en === "string");
}

/** Attributes are emitted in Chinese for static/no-JS readers and indexers. */
export function uiAttrs(attributes: Record<string, UiPair>): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(attributes).filter(([name]) => name !== "textContent").map(([name, value]) => [name, value.zh])),
    "data-ui-attrs": JSON.stringify(attributes),
  };
}

export function getUiLanguage(): UiLanguage {
  return typeof document !== "undefined" && document.documentElement.dataset.uiLanguage === "en" ? "en" : DEFAULT_UI_LANGUAGE;
}

function translated(pair: UiPair): string { return getUiLanguage() === "en" ? pair.en : pair.zh; }

export function setUiMessage(element: HTMLElement, zh: string, en: string): void {
  element.dataset.uiMessage = JSON.stringify({ zh, en });
  element.textContent = translated({ zh, en });
}

export function setUiAttribute(element: HTMLElement, name: string, zh: string, en: string): void {
  if (!labelAttributes.has(name)) return;
  let attributes: Record<string, UiPair> = {};
  try { attributes = JSON.parse(element.dataset.uiAttrs ?? "{}"); } catch { /* Replace malformed optional UI metadata. */ }
  attributes[name] = { zh, en };
  element.dataset.uiAttrs = JSON.stringify(attributes);
  if (name === "textContent") element.textContent = translated({ zh, en });
  else element.setAttribute(name, translated({ zh, en }));
}

export function applyUiLanguage(language: UiLanguage): void {
  const root = document.documentElement;
  root.lang = language;
  root.dataset.uiLanguage = language;
  for (const element of document.querySelectorAll<HTMLElement>("[data-ui-attrs]")) {
    try {
      const attributes: Record<string, UiPair> = JSON.parse(element.dataset.uiAttrs!);
      for (const [name, pair] of Object.entries(attributes)) {
        if (!labelAttributes.has(name) || !isPair(pair)) continue;
        if (name === "textContent") element.textContent = translated(pair);
        else element.setAttribute(name, translated(pair));
      }
    } catch { /* A malformed optional label must not break language controls. */ }
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-ui-message]")) {
    try { element.textContent = translated(JSON.parse(element.dataset.uiMessage!)); } catch { /* Leave the current message visible. */ }
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-language-value]")) {
    button.setAttribute("aria-pressed", String(button.dataset.languageValue === language));
  }
  const title = document.querySelector<HTMLTitleElement>("title[data-ui-title-zh]");
  if (title) document.title = language === "en" ? title.dataset.uiTitleEn! : title.dataset.uiTitleZh!;
  for (const element of document.querySelectorAll<HTMLElement>("[data-ui-date]")) {
    const date = new Date(element.dataset.uiDate!);
    if (!Number.isNaN(date.getTime())) element.textContent = new Intl.DateTimeFormat(language, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(date);
  }
  document.dispatchEvent(new CustomEvent("garden-languagechange", { detail: { language } }));
}
