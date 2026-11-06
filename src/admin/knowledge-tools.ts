/**
 * Bounded text-only insertion UI for knowledge directives.
 * Untrusted remote scripts and iframe embeds are deliberately unsupported.
 */
export function bindKnowledgeTools(options: {
  editor: HTMLTextAreaElement;
  prepare: () => boolean;
  afterEdit: () => void;
}) {
  const { editor } = options;
  const dialog = document.getElementById("knowledge-dialog") as HTMLDialogElement;
  const form = document.getElementById("knowledge-form") as HTMLFormElement;
  const title = document.getElementById("knowledge-title")!;
  const label = document.getElementById("knowledge-label") as HTMLInputElement;
  const note = document.getElementById("knowledge-note") as HTMLTextAreaElement;
  const url = document.getElementById("knowledge-url") as HTMLInputElement;
  const urlArea = document.getElementById("knowledge-url-field")!;
  const error = document.getElementById("knowledge-error")!;
  let kind: "term" | "prototype" = "term";
  let selection: [number, number] = [0, 0];

  const safeUrl = (value: string) => /^https:\/\/[^\s"'<>]+$/iu.test(value)
    || /^\/(?!\/)[^\s"'<>]*$/u.test(value);

  function open(nextKind: "term" | "prototype") {
    if (!options.prepare() || editor.disabled) return;
    kind = nextKind;
    selection = [editor.selectionStart, editor.selectionEnd];
    title.textContent = kind === "term" ? "插入术语悬浮便签" : "插入交互原型卡片";
    label.value = kind === "term" ? editor.value.slice(selection[0], selection[1]).slice(0, 80) : "";
    note.value = "";
    url.value = "";
    urlArea.hidden = kind !== "prototype";
    label.maxLength = kind === "term" ? 80 : 120;
    note.maxLength = kind === "term" ? 320 : 500;
    error.textContent = "";
    dialog.showModal();
    label.focus();
  }
  document.getElementById("insert-term-note")!.addEventListener("click", () => open("term"));
  document.getElementById("insert-prototype")!.addEventListener("click", () => open("prototype"));
  document.getElementById("knowledge-cancel")!.addEventListener("click", () => dialog.close("cancel"));
  form.addEventListener("submit", event => {
    event.preventDefault();
    const name = label.value.trim();
    const detail = note.value.trim();
    const href = url.value.trim();
    if (!name || name.length > (kind === "term" ? 80 : 120)
      || /[\r\n\[\]{}"]/u.test(name)
      || !detail || detail.length > (kind === "term" ? 320 : 500)
      || /["{}]/u.test(detail)
      || (kind === "prototype" && (!safeUrl(href) || href.length > 500))) {
      error.textContent = "请填写术语/标题和说明。不能含换行、引号或大括号；原型链接仅支持 HTTPS 或本站绝对路径。";
      return;
    }
    if (kind === "term" && /[:\\]/u.test(name)) {
      error.textContent = "术语不能包含冒号或反斜杠。";
      return;
    }
    const block = kind === "term"
      ? ':term[' + name + ']{note="' + detail + '"}'
      : '\n\n:::prototype{title="' + name + '" href="' + href + '"}\n' + detail + '\n:::\n\n';
    dialog.close("insert");
    editor.focus({ preventScroll: true });
    editor.setRangeText(block, selection[0], selection[1], "end");
    options.afterEdit();
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: block }));
  });
}
