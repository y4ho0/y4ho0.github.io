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
import remarkContentBlocks from "../plugins/remark-content-blocks.mjs";
import tokens from "../styles/tokens.css?inline";
import prose from "../styles/prose.css?inline";
import wenkai from "../styles/wenkai.css?inline";
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

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective)
  .use(remarkContentBlocks).use(remarkRehype) // Raw HTML is deliberately discarded.
  .use(rehypeKatex, { trust: false, strict: "warn", output: "htmlAndMathml" })
  .use(rehypeHighlight, { detect: false, ignoreMissing: true }).use(rehypeStringify);

export async function previewDocument(markdown: string): Promise<string> {
  const rendered = String(await processor.process(markdown));
  const safe = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["id", "name"],
  });
  // Scripts, navigation, forms and credentials are unavailable in the sandbox.
  // Styles are imported at build time; no remote rendering service is used.
  // Embedded media queries follow the parent iframe's color-scheme. Theme
  // switching updates this scriptless sandbox without reloading its document.
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: data: ${window.location.origin}; font-src data: ${window.location.origin}; form-action 'none'; base-uri 'none'"><style>${tokens}\n${wenkai}\n${prose}\n${katex}\n${highlighting}\n@media(prefers-color-scheme:dark){${darkHighlighting}}\n*{box-sizing:border-box}body{margin:0;padding:1.5rem;background:var(--color-surface-raised);font-family:var(--font-body)}.prose{width:100%;overflow-wrap:anywhere}.prose pre code.hljs{background:transparent;padding:0}img{max-width:100%}table{display:block;overflow:auto}pre{white-space:pre-wrap}h1{font-size:2rem}</style></head><body><article class="prose">${safe}</article></body></html>`;
}
