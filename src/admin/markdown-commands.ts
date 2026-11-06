/** Pure textarea edits. Selection positions always refer to the resulting document. */
export type CommandId =
  | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6'
  | 'bold' | 'italic' | 'strike' | 'quote' | 'unordered' | 'ordered' | 'task'
  | 'inlineCode' | 'codeBlock' | 'link' | 'image' | 'table' | 'hr'
  | 'mathInline' | 'mathBlock';

export const COMMANDS: readonly { id: CommandId; label: string; defaultShortcut?: string }[] = [
  { id: 'heading1', label: '一级标题' },
  { id: 'heading2', label: '二级标题' },
  { id: 'heading3', label: '三级标题' },
  { id: 'heading4', label: '四级标题' },
  { id: 'heading5', label: '五级标题' },
  { id: 'heading6', label: '六级标题' },
  { id: 'bold', label: '加粗' },
  { id: 'italic', label: '斜体' },
  { id: 'strike', label: '删除线' },
  { id: 'quote', label: '引用' },
  { id: 'unordered', label: '无序列表' },
  { id: 'ordered', label: '有序列表' },
  { id: 'task', label: '任务列表' },
  { id: 'inlineCode', label: '行内代码' },
  { id: 'codeBlock', label: '代码块' },
  { id: 'link', label: '链接' },
  { id: 'image', label: '图片引用' },
  { id: 'table', label: '表格' },
  { id: 'hr', label: '分隔线' },
  { id: 'mathInline', label: '行内公式' },
  { id: 'mathBlock', label: '独立公式' },
];

export interface MarkdownEdit {
  start: number;
  end: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

function edit(start: number, end: number, text: string, selectionStart = start, selectionEnd = selectionStart + text.length): MarkdownEdit {
  return { start, end, text, selectionStart, selectionEnd };
}

function escaped(value: string, position: number): boolean {
  let slashes = 0;
  for (let at = position - 1; at >= 0 && value[at] === '\\'; at -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function hasMarker(value: string, at: number, marker: string): boolean {
  if (at < 0 || value.slice(at, at + marker.length) !== marker || escaped(value, at)) return false;
  if (marker === '*') {
    let from = at;
    let to = at + 1;
    while (value[from - 1] === '*') from -= 1;
    while (value[to] === '*') to += 1;
    // An odd run can combine italic and bold (***); an even run is only bold.
    return (to - from) % 2 === 1 && !escaped(value, from);
  }
  // Do not mistake one delimiter of $$math$$ for an inline math wrapper.
  if (marker.length === 1 && (value[at - 1] === marker || value[at + 1] === marker)) return false;
  return true;
}

function inlineParagraphs(value: string, start: number, end: number, operation: (part: string) => MarkdownEdit): MarkdownEdit | undefined {
  const selected = value.slice(start, end);
  const parts = selected.split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/);
  if (parts.length === 1) return undefined;
  // Inline delimiters cannot cross paragraph boundaries. Keep blank lines byte-for-byte,
  // formatting each paragraph independently, and include its delimiters in the selection
  // so another invocation can reliably unwrap every paragraph again.
  const text = parts.map((part, index) => {
    if (index % 2 || !part.trim()) return part;
    const change = operation(part);
    return part.slice(0, change.start) + change.text + part.slice(change.end);
  }).join('');
  return edit(start, end, text);
}

function inline(value: string, start: number, end: number, marker: string, placeholder: string): MarkdownEdit {
  const paragraphs = inlineParagraphs(value, start, end, part => inline(part, 0, part.length, marker, placeholder));
  if (paragraphs) return paragraphs;
  if (hasMarker(value, start - marker.length, marker) && hasMarker(value, end, marker)) {
    return edit(start - marker.length, end + marker.length, value.slice(start, end));
  }
  if (end - start >= marker.length * 2 && hasMarker(value, start, marker) && hasMarker(value, end - marker.length, marker)) {
    const inner = value.slice(start + marker.length, end - marker.length);
    return edit(start, end, inner);
  }
  if (start === end) {
    return edit(start, end, marker + placeholder + marker, start + marker.length, start + marker.length + placeholder.length);
  }
  const selected = value.slice(start, end);
  const leading = selected.match(/^\s*/)?.[0].length ?? 0;
  const trailing = selected.match(/\s*$/)?.[0].length ?? 0;
  // Markup around whitespace alone is invalid Markdown; retain it and add a useful placeholder.
  if (leading === selected.length) return edit(start, end, selected + marker + placeholder + marker, end + marker.length, end + marker.length + placeholder.length);
  const innerStart = start + leading;
  const innerEnd = end - trailing;
  const inner = value.slice(innerStart, innerEnd);
  return edit(innerStart, innerEnd, marker + inner + marker, innerStart + marker.length, innerEnd + marker.length);
}

function inlineCode(value: string, start: number, end: number): MarkdownEdit {
  const paragraphs = inlineParagraphs(value, start, end, part => inlineCode(part, 0, part.length));
  if (paragraphs) return paragraphs;
  const selected = value.slice(start, end);
  const wrapped = selected.match(/^(`+)([\s\S]*?)\1$/);
  if (wrapped && !wrapped[2].startsWith('`') && !wrapped[2].endsWith('`')) {
    let body = wrapped[2];
    if (body.startsWith(' ') && body.endsWith(' ') && /[^ ]/.test(body)) body = body.slice(1, -1);
    return edit(start, end, body);
  }
  const left = value.slice(0, start).match(/(`+)( ?)$/);
  const right = value.slice(end).match(/^( ?)(`+)/);
  if (left && right && left[1] === right[2] && left[2] === right[1] && !escaped(value, start - left[0].length)) {
    return edit(start - left[0].length, end + right[0].length, selected);
  }
  const body = selected || '代码';
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map(run => run.length));
  const delimiter = '`'.repeat(longest + 1);
  const pad = body.startsWith('`') || body.endsWith('`') || (body.startsWith(' ') && body.endsWith(' ') && /[^ ]/.test(body)) ? ' ' : '';
  return edit(start, end, delimiter + pad + body + pad + delimiter, start + delimiter.length + pad.length, start + delimiter.length + pad.length + body.length);
}

interface Line { text: string; eol: string; offset: number }
interface PrefixEdit { start: number; end: number; text: string }

function selectedLines(value: string, start: number, end: number): { start: number; end: number; lines: Line[] } {
  const from = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  // A selection ending at the beginning of a line does not include that next line.
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const newline = value.indexOf('\n', last);
  const to = newline === -1 ? value.length : newline > 0 && value[newline - 1] === '\r' ? newline - 1 : newline;
  const source = value.slice(from, to);
  const lines: Line[] = [];
  const pattern = /([^\r\n]*)(\r?\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    lines.push({ text: match[1], eol: match[2], offset: match.index });
    if (!match[2]) break;
  }
  return { start: from, end: to, lines };
}

function mappedPosition(position: number, changes: PrefixEdit[]): number {
  let delta = 0;
  for (const change of changes) {
    if (position < change.start) break;
    if (position <= change.end) return change.start + delta + change.text.length;
    delta += change.text.length - (change.end - change.start);
  }
  return position + delta;
}

function lineCommand(value: string, start: number, end: number, command: CommandId): MarkdownEdit {
  const range = selectedLines(value, start, end);
  const heading = command.startsWith('heading') ? Number(command.slice(7)) : 0;
  const list = /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;
  const existing = (line: string): RegExpMatchArray | null => heading
    ? line.match(/^( {0,3})(#{1,6})(?:[ \t]+|$)/)
    : command === 'quote' ? line.match(/^([ \t]*)>[ \t]?/)
    : line.match(list);
  const matches = (line: string): boolean => {
    const match = existing(line);
    if (!match) return false;
    if (heading) return match[2].length === heading;
    if (command === 'quote') return true;
    if (command === 'task') return /^([ \t]*)[-+*][ \t]+\[[ xX]\][ \t]+/.test(line);
    if (command === 'ordered') return /^([ \t]*)\d+[.)][ \t]+/.test(line) && !/\[[ xX]\][ \t]+$/.test(match[0]);
    return /^([ \t]*)[-+*][ \t]+/.test(line) && !/\[[ xX]\][ \t]+$/.test(match[0]);
  };
  const nonempty = range.lines.filter(line => line.text.trim());
  const remove = nonempty.length > 0 && nonempty.every(line => matches(line.text));
  const changes: PrefixEdit[] = [];
  let number = 0;
  for (const line of range.lines) {
    if (!line.text.trim() && (range.lines.length > 1 || start !== end)) continue;
    number += 1;
    const match = existing(line.text);
    const indent = match?.[1] ?? line.text.match(/^[ \t]*/)?.[0] ?? '';
    const prefix = remove ? '' : heading ? '#'.repeat(heading) + ' ' : command === 'quote' ? '> ' : command === 'ordered' ? `${number}. ` : command === 'task' ? '- [ ] ' : '- ';
    // Quoting is independent from any existing list marker; preserve both when adding it.
    const consumed = match?.[0].length ?? indent.length;
    changes.push({ start: line.offset + indent.length, end: line.offset + consumed, text: prefix });
  }
  if (start === end && range.lines.length === 1 && !range.lines[0].text.trim()) {
    const indent = range.lines[0].text;
    const prefix = changes[0]?.text ?? '';
    const placeholder = heading ? '标题' : command === 'quote' ? '引用内容' : '列表项';
    return edit(range.start, range.end, indent + prefix + placeholder, range.start + indent.length + prefix.length, range.start + indent.length + prefix.length + placeholder.length);
  }
  let text = value.slice(range.start, range.end);
  for (const change of [...changes].reverse()) text = text.slice(0, change.start) + change.text + text.slice(change.end);
  const selectionStart = range.start + mappedPosition(start - range.start, changes);
  const selectionEnd = range.start + mappedPosition(end - range.start, changes);
  return edit(range.start, range.end, text, selectionStart, selectionEnd);
}

function eolOf(value: string): string {
  return value.match(/\r?\n/)?.[0] ?? '\n';
}

function blockPadding(before: string, after: string, eol: string): { before: string; after: string } {
  const leading = !before || /\r?\n\r?\n$/.test(before) ? '' : /\r?\n$/.test(before) ? eol : eol + eol;
  const trailing = !after || /^\r?\n\r?\n/.test(after) ? '' : /^\r?\n/.test(after) ? eol : eol + eol;
  return { before: leading, after: trailing };
}

function fenced(value: string, start: number, end: number, math: boolean): MarkdownEdit {
  const selected = value.slice(start, end);
  const fencePattern = math ? /^( {0,3})(\$\$)[ \t]*\r?\n([\s\S]*?)\r?\n\1\2[ \t]*$/ : /^( {0,3})(`{3,}|~{3,})[^\r\n]*\r?\n([\s\S]*?)\r?\n {0,3}\2[ \t]*$/;
  const full = selected.match(fencePattern);
  if (full) return edit(start, end, full[3]);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const open = math ? before.match(/(?:^|\r?\n)( {0,3}\$\$[ \t]*)\r?\n$/) : before.match(/(?:^|\r?\n)( {0,3}(`{3,}|~{3,})[^\r\n]*)\r?\n$/);
  const delimiter = math ? '$$' : open?.[2];
  if (open && delimiter) {
    const closing = after.match(/^\r?\n( {0,3}[^\r\n]*)(?=\r?\n|$)/);
    if (closing?.[1].trim() === delimiter) {
      const openingLength = open[1].length + (before.endsWith('\r\n') ? 2 : 1);
      return edit(start - openingLength, end + closing[0].length, selected);
    }
  }
  const eol = eolOf(value);
  const body = selected || (math ? 'E = mc^2' : '代码');
  const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map(run => run.length));
  const fence = math ? '$$' : '`'.repeat(longest + 1);
  const padding = blockPadding(before, after, eol);
  const prefix = padding.before + fence + eol;
  const text = prefix + body + eol + fence + padding.after;
  return edit(start, end, text, start + prefix.length, start + prefix.length + body.length);
}

function referenceLabel(source: string, image: boolean): string | undefined {
  const opening = image ? '![' : '[';
  if (!source.startsWith(opening)) return undefined;
  let depth = 1;
  let labelEnd = -1;
  for (let at = opening.length; at < source.length; at += 1) {
    if (escaped(source, at)) continue;
    if (source[at] === '[') depth += 1;
    if (source[at] === ']') depth -= 1;
    if (!depth) { labelEnd = at; break; }
  }
  if (labelEnd < 0 || source[labelEnd + 1] !== '(') return undefined;
  depth = 1;
  for (let at = labelEnd + 2; at < source.length; at += 1) {
    if (escaped(source, at)) continue;
    if (source[at] === '(') depth += 1;
    if (source[at] === ')') depth -= 1;
    if (!depth) return at === source.length - 1 ? source.slice(opening.length, labelEnd) : undefined;
  }
  return undefined;
}

function link(value: string, start: number, end: number, image: boolean): MarkdownEdit {
  const selected = value.slice(start, end);
  // Only unwrap a complete reference; never consume adjacent text or partially selected URLs.
  const complete = referenceLabel(selected, image);
  if (complete !== undefined) return edit(start, end, complete);
  const label = (selected || (image ? '图片说明' : '链接文字')).replace(/(?<!\\)([\[\]])/g, '\\$1');
  const url = image ? '/images/article/image.png' : 'https://example.com';
  const prefix = (image ? '![' : '[') + label + '](';
  return edit(start, end, prefix + url + ')', start + prefix.length, start + prefix.length + url.length);
}

/** Returns a single replacement for setRangeText, without touching DOM, focus or history. */
export function editMarkdown(value: string, start: number, end: number, command: CommandId): MarkdownEdit | undefined {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !COMMANDS.some(item => item.id === command)) return undefined;
  const from = Math.max(0, Math.min(value.length, Math.floor(Math.min(start, end))));
  const to = Math.max(0, Math.min(value.length, Math.floor(Math.max(start, end))));
  if (command.startsWith('heading') || ['quote', 'unordered', 'ordered', 'task'].includes(command)) return lineCommand(value, from, to, command);
  if (command === 'bold') return inline(value, from, to, '**', '加粗文字');
  if (command === 'italic') return inline(value, from, to, '*', '斜体文字');
  if (command === 'strike') return inline(value, from, to, '~~', '删除文字');
  if (command === 'mathInline') return inline(value, from, to, '$', 'E = mc^2');
  if (command === 'inlineCode') return inlineCode(value, from, to);
  if (command === 'codeBlock' || command === 'mathBlock') return fenced(value, from, to, command === 'mathBlock');
  if (command === 'link' || command === 'image') return link(value, from, to, command === 'image');
  const eol = eolOf(value);
  const padding = blockPadding(value.slice(0, from), value.slice(to), eol);
  if (command === 'hr') {
    // A separator has no text placeholder; leave the caret ready for the next paragraph.
    const text = padding.before + '---' + eol + eol + padding.after.replace(/^(?:\r?\n){1,2}/, '');
    return edit(from, from, text, from + text.length, from + text.length);
  }
  const heading = value.slice(from, to).trim().replace(/\r?\n/g, ' ').replace(/\|/g, '\\|') || '列 1';
  const prefix = padding.before + '| ';
  const table = `| ${heading} | 列 2 |${eol}| --- | --- |${eol}| 内容 | 内容 |`;
  return edit(from, to, padding.before + table + padding.after, from + prefix.length, from + prefix.length + heading.length);
}
