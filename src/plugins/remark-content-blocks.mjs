import { visit } from "unist-util-visit";

const labels = new Map([
  ["theorem", "Theorem"],
  ["proof", "Proof"],
  ["definition", "Definition"],
  ["lemma", "Lemma"],
  ["proposition", "Proposition"],
  ["corollary", "Corollary"],
  ["remark", "Remark"],
  ["example", "Example"],
]);

export default function remarkContentBlocks() {
  return (tree) => {
    visit(tree, "containerDirective", (node) => {
      const fallbackLabel = labels.get(node.name);
      if (!fallbackLabel) return;

      const label = node.attributes?.title?.trim() || fallbackLabel;
      const data = node.data || (node.data = {});
      data.hName = "aside";
      data.hProperties = {
        className: ["content-block", `content-block--${node.name}`],
        role: "note",
        "aria-label": label,
      };
      node.children.unshift({
        type: "paragraph",
        data: {
          hName: "p",
          hProperties: { className: ["content-block__label"] },
        },
        children: [{ type: "text", value: label }],
      });
    });
  };
}
