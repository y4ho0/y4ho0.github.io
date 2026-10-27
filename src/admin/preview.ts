import DOMPurify from "dompurify";
import knowledgeStyles from "../styles/knowledge-tools.css?inline";
import tokens from "../styles/tokens.css?inline";
import prose from "../styles/prose.css?inline";
import themeMotion from "../styles/theme-motion.css?inline";
import wenkai from "../styles/wenkai.css?inline";
import wenkaiUi from "../styles/wenkai-ui.css?inline";
import katexSource from "katex/dist/katex.min.css?raw";
import highlighting from "highlight.js/styles/github.css?inline";
import darkHighlighting from "highlight.js/styles/github-dark.css?inline";

// Opaque-origin sandbox frames cannot request same-origin fonts without CORS.
// Embed local KaTeX fonts so preview works on Pages without loosening the sandbox.
const fonts = import.meta.glob<string>("../../node_modules/katex/dist/fonts/*.woff2", { eager: true, query: "?inline", import: "default" });
const katex = katexSource.replace(/src:[^;}]+/gu, source => {
  const name = /fonts\/([^/)]+\.woff2)/u.exec(source)?.[1];
  const font = name && Object.entries(fonts).find(([path]) => path.endsWith(`/${name}`))?.[1];
  return font ? `src:url("${font}") format("woff2")` : "src:none";
});

// The parser worker never touches the DOM or the GitHub session.
let worker: Worker | undefined;
let requestId = 0;
const waiting = new Map<number, { resolve: (html: string) => void; reject: (error: Error) => void }>();
function renderMarkup(markdown: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      worker = new Worker(new URL("./preview-worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (event: MessageEvent<{ id: number; html?: string; error?: string }>) => {
        const result = event.data;
        const request = waiting.get(result?.id);
        if (!request) return;
        waiting.delete(result.id);
        if (typeof result.html === "string") request.resolve(result.html);
        else request.reject(new Error(result.error || "Markdown 处理失败"));
      });
      worker.addEventListener("error", (event: ErrorEvent) => {
        console.error("[preview-worker-load]", event.message, event.filename, event.lineno);
        for (const request of waiting.values()) request.reject(new Error("后台预览工作线程运行失败：" + event.message));
        waiting.clear();
        worker?.terminate();
        worker = undefined;
      });
    }
    const id = ++requestId;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, markdown });
  });
}

// Cache only one sanitized document, never raw unsanitized HTML. Token/mode
// remain independent so a new iframe can reuse parsing without reusing a
// session capability. Bound retained memory for very large source documents.
let cachedSource: string | undefined;
let cachedSafe: string | undefined;
const CACHE_LIMIT = 512 * 1024;
export async function previewDocument(markdown: string, controlToken?: string, mode: "full" | "split" = "full"): Promise<string> {
  let safe: string;
  if (markdown === cachedSource && cachedSafe !== undefined) {
    safe = cachedSafe;
  } else {
    const rendered = await renderMarkup(markdown);
    safe = DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true, mathMl: true, svg: true },
      FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
      FORBID_ATTR: ["id", "name"],
    });
    cachedSource = markdown.length <= CACHE_LIMIT ? markdown : undefined;
    cachedSafe = markdown.length <= CACHE_LIMIT ? safe : undefined;
  }
  // Only a fixed repository-owned script may run in the opaque-origin
  // sandbox. It reports full-mode height or split-mode scroll progress;
  // Markdown remains sanitized, cannot run scripts, and cannot access parent.
  const enabled = Boolean(controlToken && /^[a-f0-9-]{36}$/u.test(controlToken));
  const origin = window.location.origin;
  const controlScriptUrl = origin + "/admin/preview-height.js";
  const scriptPolicy = enabled ? "script-src " + controlScriptUrl : "script-src 'none'";
  const controlMeta = enabled
    ? '<meta name="garden-preview-token" content="' + controlToken + '" data-preview-mode="' + mode + '">'
    : "";
  const controlScript = enabled ? '<script src="' + controlScriptUrl + '" defer></script>' : "";

  // Styles are imported at build time; no remote rendering service is used.
  // Embedded media queries follow the parent iframe's color-scheme. Theme
  // switching updates this scriptless sandbox without reloading its document.
  return `<!doctype html><html lang="zh-CN" data-theme-preview><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">${controlMeta}<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${scriptPolicy}; style-src 'unsafe-inline'; img-src https: data: ${origin}; font-src data: ${origin}; connect-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"><style>${tokens}\n${themeMotion}\n${wenkai}\n${wenkaiUi}\n${prose}\n${knowledgeStyles}\n${katex}\n${highlighting}\n@media(prefers-color-scheme:dark){${darkHighlighting}}\n*{box-sizing:border-box}body{margin:0;padding:1.5rem;background:var(--color-surface-raised);font-family:var(--font-body)}.prose{width:100%;overflow-wrap:anywhere}.prose pre code.hljs{background:transparent;padding:0}img{max-width:100%}table{display:block;overflow:auto}pre{white-space:pre-wrap}h1{font-size:2rem}</style></head><body><article class="prose">${safe}</article>${controlScript}</body></html>`;
}
