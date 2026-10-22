export interface ShortcutEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  getModifierState?: (key: string) => boolean;
}

type Shortcut = { modifiers: Set<string>; key: string };
const MODIFIERS = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];
const modifierNames: Record<string, string> = {
  mod: 'Mod', ctrl: 'Ctrl', control: 'Ctrl', meta: 'Meta', cmd: 'Meta', command: 'Meta',
  alt: 'Alt', option: 'Alt', shift: 'Shift',
};
const namedKeys: Record<string, string> = {
  enter: 'Enter', return: 'Enter', escape: 'Escape', esc: 'Escape', tab: 'Tab',
  space: 'Space', spacebar: 'Space', backspace: 'Backspace', delete: 'Delete', del: 'Delete',
  insert: 'Insert', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  arrowleft: 'ArrowLeft', left: 'ArrowLeft', arrowright: 'ArrowRight', right: 'ArrowRight',
  arrowup: 'ArrowUp', up: 'ArrowUp', arrowdown: 'ArrowDown', down: 'ArrowDown',
};
const punctuation: Record<string, string> = {
  '-': 'Minus', '=': 'Equal', '+': 'Plus', ',': 'Comma', '.': 'Period', '/': 'Slash',
  '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight',
};
const punctuationKeys = new Set(Object.values(punctuation));
const error = (message: string): never => { throw new Error(message); };

function normalizeKey(value: string): string {
  if (/^[a-z0-9]$/iu.test(value)) return value.toUpperCase();
  if (/^f(?:[1-9]|1\d|2[0-4])$/iu.test(value)) return value.toUpperCase();
  const punctuationName = Object.values(punctuation).find(key => key.toLowerCase() === value.toLowerCase());
  return namedKeys[value.toLowerCase()] ?? punctuation[value] ?? punctuationName
    ?? error('快捷键需要一个有效按键，例如 B、7、Enter 或 Space。');
}

function parse(value: string): Shortcut | undefined {
  if (typeof value !== 'string') return error('快捷键必须是文字。');
  if (!value.trim()) return undefined;
  const parts = value.split('+').map(part => part.trim());
  if (parts.some(part => !part)) return error('请使用 + 分隔修饰键与按键，例如 Mod+Shift+B。');
  const modifiers = new Set<string>();
  let key = '';
  for (const part of parts) {
    const modifier = modifierNames[part.toLowerCase()];
    if (modifier) {
      if (modifiers.has(modifier)) return error('快捷键包含重复的修饰键。');
      modifiers.add(modifier);
    } else {
      if (key) return error('每个快捷键只能包含一个普通按键。');
      key = normalizeKey(part);
    }
  }
  if (!key) return error('快捷键不能只有修饰键。');
  if (![...modifiers].some(modifier => modifier !== 'Shift')) return error('快捷键必须包含 Mod、Ctrl、Meta 或 Alt，避免影响普通文字输入。');
  if (modifiers.has('Mod') && (modifiers.has('Ctrl') || modifiers.has('Meta'))) return error('Mod 不能与 Ctrl 或 Meta 同时使用。');
  return { modifiers, key };
}

function serialize(shortcut: Shortcut): string {
  return [...MODIFIERS.filter(modifier => shortcut.modifiers.has(modifier)), shortcut.key].join('+');
}

function physical(shortcut: Shortcut, isMac: boolean): Shortcut {
  const modifiers = new Set(shortcut.modifiers);
  if (modifiers.delete('Mod')) modifiers.add(isMac ? 'Meta' : 'Ctrl');
  return { modifiers, key: shortcut.key };
}

function reserved(shortcut: Shortcut): boolean {
  const { modifiers, key } = shortcut;
  const primary = modifiers.has('Ctrl') || modifiers.has('Meta');
  const alt = modifiers.has('Alt');
  const shift = modifiers.has('Shift');
  // Keep native editing commands and browser navigation/window operations.
  // Mod+Shift+X is an intentional editor default.
  if (primary && !alt) {
    if (['A', 'C', 'V', 'Z', 'Y'].includes(key) || (key === 'X' && !shift)) return true;
    if (['R', 'W', 'T', 'N', 'Q', 'P', 'L', 'F', 'O', 'S', 'D', 'U', 'H', 'J', 'M'].includes(key)) return true;
    if (key === 'I' && shift) return true;
    if (['Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Backspace', 'Delete', 'Plus', 'Minus', 'Equal', '0'].includes(key)) return true;
  }
  if (['F1', 'F4', 'F5', 'F6', 'F10', 'F11', 'F12'].includes(key)) return true;
  if (alt && !primary && ['Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'Home', 'D', 'F'].includes(key)) return true;
  if (modifiers.has('Ctrl') && alt && key === 'Delete') return true;
  if (primary && alt && ['C', 'V', 'X', 'Z'].includes(key)) return true;
  // Known macOS global shortcuts apply before the page receives a key event.
  // https://support.apple.com/en-us/102650
  if (modifiers.has('Meta') && alt) {
    if (['Escape', 'Space'].includes(key)) return true;
    if (!shift && ['H', 'M', 'W', 'D', 'I', 'T'].includes(key)) return true;
  }
  return false;
}

function assertAllowed(shortcut: Shortcut): void {
  if (reserved(physical(shortcut, true)) || reserved(physical(shortcut, false))) {
    error('此组合键保留给浏览器、系统或原生编辑操作，请选择其他快捷键。');
  }
}

/** Empty means disabled. Throws a user-facing error for invalid/reserved bindings. */
export function canonicalShortcut(value: string): string {
  const shortcut = parse(value);
  if (!shortcut) return '';
  assertAllowed(shortcut);
  return serialize(shortcut);
}

/** Physical modifier names make recorded bindings independent of navigator globals. */
export function shortcutFromEvent(event: ShortcutEvent): string | undefined {
  if (event.repeat || event.isComposing || event.keyCode === 229
      || event.getModifierState?.('AltGraph') || ['Process', 'Unidentified'].includes(event.key)) return undefined;
  const modifiers = new Set<string>();
  if (event.ctrlKey) modifiers.add('Ctrl');
  if (event.metaKey) modifiers.add('Meta');
  if (event.altKey) modifiers.add('Alt');
  if (event.shiftKey) modifiers.add('Shift');
  if (![...modifiers].some(modifier => modifier !== 'Shift')) return undefined;
  if (modifierNames[event.key.toLowerCase()] || ['AltGraph', 'OS', 'Fn', 'CapsLock'].includes(event.key)) return undefined;
  try {
    // Shift+7 reports '&' on US keyboards; retain the physical number row key.
    // macOS Option can report 'å' or 'Dead'; use the letter key's position too.
    const letter = /^Key([A-Z])$/u.exec(event.code ?? '');
    const digit = /^Digit([0-9])$/u.exec(event.code ?? '');
    const numpad = /^Numpad([0-9])$/u.exec(event.code ?? '');
    const codePunctuation = punctuationKeys.has(event.code ?? '') ? event.code! : undefined;
    const key = letter?.[1] ?? digit?.[1] ?? numpad?.[1] ?? codePunctuation ?? (event.key === ' ' ? 'Space' : normalizeKey(event.key));
    const shortcut = { modifiers, key };
    if (reserved(shortcut)) return undefined;
    return serialize(shortcut);
  } catch { return undefined; }
}

/** Match exact modifiers. Mod resolves to Command on macOS and Control elsewhere. */
export function matchesShortcut(event: ShortcutEvent, binding: string, isMac: boolean): boolean {
  const actual = shortcutFromEvent(event);
  if (!actual) return false;
  try {
    const shortcut = parse(binding);
    if (!shortcut) return false;
    assertAllowed(shortcut);
    return actual === serialize(physical(shortcut, isMac));
  } catch { return false; }
}

/** Report errors per command. Mod/physical duplicates conflict on either platform. */
export function validateBindings(bindings: Record<string, string>, validCommandIds: readonly string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const validIds = new Set(validCommandIds);
  const used = new Map<string, string>();
  for (const [id, value] of Object.entries(bindings)) {
    if (!validIds.has(id)) { errors[id] = '未知的 Markdown 命令。'; continue; }
    try {
      const canonical = canonicalShortcut(value);
      const shortcut = parse(canonical);
      if (!shortcut) continue;
      for (const isMac of [true, false]) {
        const key = `${isMac}:${serialize(physical(shortcut, isMac))}`;
        const previous = used.get(key);
        if (previous && previous !== id) {
          errors[id] = `与 ${previous} 的快捷键冲突，请选择其他组合。`;
          errors[previous] = `与 ${id} 的快捷键冲突，请选择其他组合。`;
        } else used.set(key, id);
      }
    } catch (issue) {
      errors[id] = issue instanceof Error ? issue.message : '快捷键无效。';
    }
  }
  return errors;
}
