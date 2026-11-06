import { COMMANDS, editMarkdown, type CommandId } from "./markdown-commands";
import { canonicalShortcut, matchesShortcut, shortcutFromEvent, validateBindings } from "./shortcuts";

const storageKey = "garden-admin-shortcuts";
const commands = COMMANDS.filter(command => command.id !== "heading1");
const commandIds = commands.map(command => command.id);
const defaults: Record<string, string> = {
  heading2: "Mod+Alt+2", heading3: "Mod+Alt+3",
  heading4: "Mod+Alt+4", heading5: "Mod+Alt+5", heading6: "Mod+Alt+6",
  bold: "Mod+B", italic: "Mod+I", strike: "Mod+Shift+X", quote: "Mod+Alt+Q",
  unordered: "Mod+Shift+8", ordered: "Mod+Shift+7", task: "Mod+Shift+9",
  inlineCode: "Mod+E", codeBlock: "Mod+Shift+E", link: "Mod+K", image: "Mod+Alt+Shift+I",
  table: "Mod+Alt+Shift+T", hr: "Mod+Alt+Shift+H", mathInline: "Mod+Alt+Shift+M", mathBlock: "Mod+Alt+Shift+B",
};

function readBindings(): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw || raw.length > 16_384) return { ...defaults };
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1 || !("bindings" in saved)) return { ...defaults };
    const values = saved.bindings;
    if (!values || typeof values !== "object" || Array.isArray(values)) return { ...defaults };
    const candidate = { ...defaults };
    for (const id of commandIds) {
      if (Object.hasOwn(values, id)) {
        const value: unknown = (values as Record<string, unknown>)[id];
        if (typeof value !== "string" || value.length > 96) return { ...defaults };
        candidate[id] = canonicalShortcut(value);
      }
    }
    return Object.keys(validateBindings(candidate, commandIds)).length ? { ...defaults } : candidate;
  } catch { return { ...defaults }; }
}

export function bindEditorTools(options: {
  editor: HTMLTextAreaElement;
  prepare: () => boolean;
  afterEdit: () => void;
}) {
  const { editor } = options;
  const toolbar = document.getElementById("format-toolbar")!;
  const headings = document.getElementById("heading-level") as HTMLSelectElement;
  const dialog = document.getElementById("shortcuts-dialog") as HTMLDialogElement;
  const settings = document.getElementById("shortcuts-form") as HTMLFormElement;
  const status = document.getElementById("shortcut-error")!;
  const isMac = /Mac|iPhone|iPad/u.test(navigator.platform);
  let bindings = readBindings();

  function display(shortcut: string) {
    return shortcut.replace(/Mod/gu, isMac ? "⌘" : "Ctrl").replace(/Meta/gu, "⌘").replace(/Alt/gu, isMac ? "⌥" : "Alt").replace(/\+/gu, " + ");
  }
  function updateHints() {
    for (const command of commands) {
      const shortcut = bindings[command.id];
      const hint = `${command.label}${shortcut ? `（${display(shortcut)}）` : "（未绑定快捷键）"}`;
      const button = toolbar.querySelector<HTMLButtonElement>(`[data-command="${command.id}"]`);
      if (button) {
        button.title = hint;
        button.setAttribute("aria-label", hint);
        if (shortcut) button.setAttribute("aria-keyshortcuts", shortcut.replace(/Mod/gu, isMac ? "Meta" : "Control").replace(/Ctrl/gu, "Control"));
        else button.removeAttribute("aria-keyshortcuts");
      }
      const option = headings.querySelector<HTMLOptionElement>(`option[value="${command.id}"]`);
      if (option) option.title = hint;
    }
  }
  function format(id: CommandId) {
    if (editor.disabled || !options.prepare()) return;
    const change = editMarkdown(editor.value, editor.selectionStart, editor.selectionEnd, id);
    if (!change) return;
    const previous = editor.value;
    const direction = editor.selectionDirection;
    const expected = previous.slice(0, change.start) + change.text + previous.slice(change.end);
    const scroll = editor.scrollTop;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(change.start, change.end);
    let inputReceived = false;
    const observeInput = () => { inputReceived = true; };
    editor.addEventListener("input", observeInput);
    try {
      // A native text insertion keeps formatting in the browser's undo history.
      // Fall back to the standard textarea API where that command is unavailable.
      if (document.queryCommandSupported("insertText")) document.execCommand("insertText", false, change.text);
    } catch { /* Browser does not expose the native edit command. */ }
    finally { editor.removeEventListener("input", observeInput); }
    if (editor.value !== expected) {
      editor.value = previous;
      editor.setRangeText(change.text, change.start, change.end, "preserve");
      inputReceived = false;
    }
    editor.setSelectionRange(change.selectionStart, change.selectionEnd, direction);
    editor.scrollTop = scroll;
    options.afterEdit();
    if (!inputReceived) editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: change.text }));
  }
  toolbar.addEventListener("mousedown", event => {
    // Mouse activation must not move the editor's selection before formatting.
    if ((event.target as Element).closest("button[data-command]")) event.preventDefault();
  });
  toolbar.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-command]");
    if (button && !button.disabled) format(button.dataset.command as CommandId);
  });
  headings.addEventListener("change", () => {
    const id = headings.value as CommandId;
    if (commandIds.includes(id)) format(id);
    headings.value = "";
  });
  editor.addEventListener("keydown", event => {
    if (event.defaultPrevented || editor.disabled || event.isComposing || event.keyCode === 229 || event.repeat) return;
    const command = commands.find(item => bindings[item.id] && matchesShortcut(event, bindings[item.id], isMac));
    if (command) { event.preventDefault(); format(command.id); }
  });

  const inputs = Array.from(settings.querySelectorAll<HTMLInputElement>("[data-shortcut-command]"));
  function feedback(text: string, error = false) { status.textContent = text; status.dataset.error = String(error); }
  function fillSettings(values: Record<string, string>) {
    for (const input of inputs) { input.value = values[input.dataset.shortcutCommand as CommandId]; input.removeAttribute("aria-invalid"); }
  }
  document.getElementById("shortcut-settings")!.addEventListener("click", () => {
    fillSettings(bindings); feedback(""); dialog.showModal();
  });
  for (const input of inputs) input.addEventListener("keydown", event => {
    if (event.key === "Tab" || event.key === "Escape") return;
    event.preventDefault();
    if (event.isComposing || event.keyCode === 229 || event.repeat) return;
    if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      input.value = ""; feedback("已清除此快捷键；保存后生效。"); return;
    }
    if (["Control", "Meta", "Alt", "Shift", "AltGraph"].includes(event.key)) return;
    const shortcut = shortcutFromEvent(event);
    if (!shortcut) { feedback("请选择带 Ctrl / ⌘ / Alt 的组合键；复制、粘贴、撤销及浏览器保留键不能绑定。", true); return; }
    const parts = shortcut.split("+");
    const primary = isMac ? "Meta" : "Ctrl";
    try {
      input.value = canonicalShortcut(parts.map(part => part === primary ? "Mod" : part).join("+"));
      input.removeAttribute("aria-invalid"); feedback("键位已录入，保存后生效。");
    } catch (error) {
      feedback(error instanceof Error ? error.message : "此组合键不能绑定，请选择其他快捷键。", true);
    }
  });
  settings.addEventListener("click", event => {
    const clear = (event.target as Element).closest<HTMLButtonElement>("[data-clear-shortcut]");
    if (!clear) return;
    const input = inputs.find(item => item.dataset.shortcutCommand === clear.dataset.clearShortcut);
    if (input) { input.value = ""; input.removeAttribute("aria-invalid"); input.focus(); feedback("已清除此快捷键；保存后生效。"); }
  });
  settings.addEventListener("submit", event => {
    event.preventDefault();
    const candidate = Object.fromEntries(inputs.map(input => [input.dataset.shortcutCommand!, input.value])) as Record<string, string>;
    const errors = validateBindings(candidate, commandIds);
    if (Object.keys(errors).length) {
      for (const input of inputs) input.setAttribute("aria-invalid", String(Boolean(errors[input.dataset.shortcutCommand!])));
      const first = inputs.find(input => errors[input.dataset.shortcutCommand!]);
      feedback(Object.entries(errors).map(([id, error]) => `${commands.find(command => command.id === id)?.label ?? id}：${error}`).join("\n"), true);
      first?.focus(); return;
    }
    const normalized = Object.fromEntries(commandIds.map(id => [id, canonicalShortcut(candidate[id])])) as Record<string, string>;
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, bindings: normalized })); }
    catch { feedback("浏览器无法保存快捷键设置。请检查站点存储权限；原有绑定保持不变。", true); return; }
    bindings = normalized; updateHints(); dialog.close("save");
  });
  document.getElementById("reset-shortcuts")!.addEventListener("click", () => { fillSettings(defaults); feedback("已填入默认快捷键；点击保存后生效，也可以取消。"); });
  document.getElementById("cancel-shortcuts")!.addEventListener("click", () => dialog.close("cancel"));
  window.addEventListener("storage", event => { if (event.key === storageKey || event.key === null) { bindings = readBindings(); updateHints(); } });
  updateHints();
}
