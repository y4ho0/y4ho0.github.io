/** CPU-intensive Markdown, GFM, KaTeX and highlighting run off the UI thread.
 * The worker never receives a GitHub token and never inserts DOM. The parent
 * still applies DOMPurify before any HTML enters the sandboxed iframe. */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Root } from "hast";
import remarkContentBlocks from "../plugins/remark-content-blocks.mjs";
import remarkKnowledgeTools from "../plugins/remark-knowledge-tools.mjs";

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
  .use(remarkContentBlocks).use(remarkKnowledgeTools).use(remarkRehype)
  .use(rehypeKatex, { trust: false, strict: "warn", output: "htmlAndMathml" })
  .use(rehypeHighlight, { detect: false, ignoreMissing: true }).use(taskMarkers).use(rehypeStringify);

self.addEventListener("message", async (event: MessageEvent<{ id: number; markdown: string }>) => {
  const { id, markdown } = event.data || {};
  if (!Number.isSafeInteger(id) || typeof markdown !== "string" || markdown.length > 5_000_000) return;
  try {
    const html = String(await processor.process(markdown));
    self.postMessage({ id, html });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Markdown 处理失败" });
  }
});
