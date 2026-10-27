import { visit } from "unist-util-visit";

const safeUrl = (value) => typeof value === "string" && value.length <= 500
  && (/^https:\/\/[^\s"'<>]+$/iu.test(value) || /^\/(?!\/)[^\s"'<>]*$/u.test(value));

/** Text-only directives. Arbitrary embeds, scripts and markup are not allowed. */
export default function remarkKnowledgeTools() {
  return (tree) => {
    visit(tree, "textDirective", (node) => {
      if (node.name !== "term") return;
      const term = node.children.map(item => item.type === "text" ? item.value : "").join("").trim();
      const note = node.attributes?.note?.trim() ?? "";
      if (!term || term.length > 80 || !note || note.length > 320
        || /[<>"\u0000-\u001f]/u.test(term + note)) return;
      const data = node.data || (node.data = {});
      data.hName = "span";
      data.hProperties = {
        className: ["term-note"],
        tabIndex: 0,
        role: "button",
        ariaLabel: term + "：" + note,
        ariaExpanded: "false",
        "data-note": note,
      };
      node.children = [{ type: "text", value: term }];
    });

    visit(tree, "containerDirective", (node) => {
      if (node.name !== "prototype") return;
      const title = node.attributes?.title?.trim() || "打开交互原型";
      const href = node.attributes?.href?.trim() || "";
      if (title.length > 120 || !safeUrl(href)) return;
      const data = node.data || (node.data = {});
      data.hName = "aside";
      data.hProperties = { className: ["prototype-card"], ariaLabel: "交互原型" };
      node.children.unshift({
        type: "paragraph",
        data: { hName: "p", hProperties: { className: ["prototype-card__link"] } },
        children: [{
          type: "link", url: href, title: null,
          data: { hProperties: { target: "_blank", rel: "noopener noreferrer" } },
          children: [{ type: "text", value: "◈ " + title + " · 打开原型" }],
        }],
      });
    });
  };
}
