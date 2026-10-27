import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import DOMPurify from "dompurify";
import { visit } from "unist-util-visit";
import type { Root } from "hast";
import remarkContentBlocks from "../plugins/remark-content-blocks.mjs";
import remarkKnowledgeTools from "../plugins/remark-knowledge-tools.mjs";
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

// Keep task-list markers visible while continuing to forbid all input controls
// in the sanitized, read-only preview.
function taskMarkers() {
  return (tree: Root) => {
    visit(tree, "element", node => {
      if (node.tagName !== "input" || node.properties.type !== "checkbox" || !node.properties.disabled) return;
      const checked = Boolean(node.properties.checked);
      node.tagName = "span";
      node.properties = { className: ["task-checkbox"], role: "img", ariaLabel: checked ? "已完成" : "未完成" };
      node.children = [{ type: "text", value: checked ? "☑" : "☐" }];
    });
  };
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective)
  .use(remarkContentBlocks).use(remarkKnowledgeTools).use(remarkRehype) // Raw HTML is deliberately discarded.
  .use(rehypeKatex, { trust: false, strict: "warn", output: "htmlAndMathml" })
  .use(rehypeHighlight, { detect: false, ignoreMissing: true }).use(taskMarkers).use(rehypeStringify);

export async function previewDocument(markdown: string, heightToken?: string): Promise<string> {
  const rendered = String(await processor.process(markdown));
  const safe = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["id", "name"],
  });
  // Split mode stays scriptless. Only standalone preview loads a fixed,
  // repository-owned measurement script inside an opaque-origin sandbox.
  // The parent checks the window source and per-render token before resizing.
  // Markdown is still sanitized; it cannot provide arbitrary executable code.
  const standalone = Boolean(heightToken && /^[a-f0-9-]{36}$/u.test(heightToken));
  const origin = window.location.origin;
  const scriptPolicy = standalone ? "script-src " + origin + "/admin/preview-height.js" : "script-src 'none'";
  const heightMeta = standalone ? '<meta name="garden-preview-token" content="' + heightToken + '">' : "";
  const heightScript = standalone ? '<script src="' + origin + '/admin/preview-height.js" defer></script>' : "";
  // No allow-same-origin, navigation, form submission, or storage access.
  // The restrictive content policy is separate from the iframe sandbox.

  // Styles are imported at build time; no remote rendering service is used.
  // Embedded media queries follow the parent iframe's color-scheme. Theme
  // switching updates this scriptless sandbox without reloading its document.
  return `<!doctype html><html lang="zh-CN" data-theme-preview><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">${heightMeta}<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${scriptPolicy}; style-src 'unsafe-inline'; img-src https: data: ${origin}; font-src data: ${origin}; connect-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"><style>${tokens}\n${themeMotion}\n${wenkai}\n${wenkaiUi}\n${prose}\n${knowledgeStyles}\n${katex}\n${highlighting}\n@media(prefers-color-scheme:dark){${darkHighlighting}}\n*{box-sizing:border-box}body{margin:0;padding:1.5rem;background:var(--color-surface-raised);font-family:var(--font-body)}.prose{width:100%;overflow-wrap:anywhere}.prose pre code.hljs{background:transparent;padding:0}img{max-width:100%}table{display:block;overflow:auto}pre{white-space:pre-wrap}h1{font-size:2rem}</style></head><body><article class="prose">${safe}</article>${heightScript}</body></html>`;
}
