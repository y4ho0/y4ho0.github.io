import assert from 'node:assert/strict';
import test from 'node:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { COMMANDS, editMarkdown } from '../src/admin/markdown-commands.ts';

function apply(value, start, end, command) {
  const change = editMarkdown(value, start, end, command);
  assert.ok(change, command);
  assert.ok(change.start >= 0 && change.end >= change.start && change.end <= value.length);
  const text = value.slice(0, change.start) + change.text + value.slice(change.end);
  assert.ok(change.selectionStart >= 0 && change.selectionEnd >= change.selectionStart && change.selectionEnd <= text.length, `${command}: invalid selection`);
  return { text, start: change.selectionStart, end: change.selectionEnd, selected: text.slice(change.selectionStart, change.selectionEnd), change };
}

function nodes(value) {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(value).children;
}

test('every advertised command creates a valid edit and useful caret or selection in an empty document', () => {
  assert.equal(new Set(COMMANDS.map(item => item.id)).size, COMMANDS.length);
  for (const command of COMMANDS) {
    const result = apply('', 0, 0, command.id);
    assert.ok(result.text.length > 0);
    if (command.id !== 'hr') assert.ok(result.selected.length > 0, command.id);
  }
});

test('inline formatting preserves surrounding content and selects the original words', () => {
  for (const [command, marker] of [['bold', '**'], ['italic', '*'], ['strike', '~~'], ['mathInline', '$']]) {
    const result = apply('前面 文字 后面', 3, 5, command);
    assert.equal(result.text, `前面 ${marker}文字${marker} 后面`);
    assert.equal(result.selected, '文字');
    const toggled = apply(result.text, result.start, result.end, command);
    assert.equal(toggled.text, '前面 文字 后面');
    assert.equal(toggled.selected, '文字');
  }
});

test('selecting an entire inline wrapper removes it without consuming adjacent text', () => {
  for (const [command, source] of [['bold', '**文字**'], ['italic', '*文字*'], ['strike', '~~文字~~'], ['mathInline', '$x^2$']]) {
    const result = apply(`前${source}后`, 1, source.length + 1, command);
    assert.equal(result.text, `前${command === 'mathInline' ? 'x^2' : '文字'}后`);
  }
});

test('formatting multiple paragraphs produces separate valid inline nodes and toggles without losing boundaries', () => {
  for (const [command, marker, type] of [['bold', '**', 'strong'], ['italic', '*', 'emphasis'], ['strike', '~~', 'delete'], ['mathInline', '$', 'inlineMath'], ['inlineCode', '`', 'inlineCode']]) {
    for (const separator of ['\n\n', '\r\n \t\r\n\r\n']) {
      const source = `第一段${separator}第二段`;
      const result = apply(`前文\n\n${source}\n\n后文`, 4, 4 + source.length, command);
      assert.equal(result.text, `前文\n\n${marker}第一段${marker}${separator}${marker}第二段${marker}\n\n后文`);
      const parsed = nodes(result.text);
      assert.equal(parsed[1].children[0].type, type);
      assert.equal(parsed[2].children[0].type, type);
      assert.equal(apply(result.text, result.start, result.end, command).text, `前文\n\n${source}\n\n后文`);
    }
  }
});

test('removing multi-paragraph emphasis preserves each complete wrapper and original blank lines', () => {
  const source = '**甲**\n\n**乙**';
  assert.equal(apply(source, 0, source.length, 'bold').text, '甲\n\n乙');
  assert.equal(apply('\n\n甲\n\n', 0, 7, 'bold').text, '\n\n**甲**\n\n');
});

test('formatting keeps external whitespace outside markup and keeps escaped delimiters literal', () => {
  const result = apply('前  words  后', 1, 10, 'bold');
  assert.equal(result.text, '前  **words**  后');
  assert.equal(result.selected, 'words');
  assert.equal(apply('\\**words**', 3, 8, 'bold').text, '\\****words****');
  assert.equal(apply('**words**', 2, 7, 'italic').text, '***words***');
  assert.equal(apply('  ', 0, 2, 'bold').text, '  **加粗文字**');
});

test('italic toggles correctly around an existing bold span without mistaking plain bold for italic', () => {
  const source = '**文字**';
  const italic = apply(source, 0, source.length, 'italic');
  assert.equal(italic.text, '***文字***');
  assert.equal(apply(italic.text, italic.start, italic.end, 'italic').text, source);
  assert.equal(apply('***文字***', 0, 8, 'italic').text, source);
  assert.equal(apply('***文字***', 3, 5, 'italic').text, source);
  const bold = apply('*文字*', 0, 4, 'bold');
  assert.equal(bold.text, '***文字***');
  assert.equal(apply(bold.text, bold.start, bold.end, 'bold').text, '*文字*');
});

test('all heading levels parse as the requested Markdown heading, and toggle back to a paragraph', () => {
  for (let depth = 1; depth <= 6; depth += 1) {
    const result = apply('正文标题', 0, 4, `heading${depth}`);
    assert.equal(nodes(result.text)[0].type, 'heading');
    assert.equal(nodes(result.text)[0].depth, depth);
    assert.equal(result.selected, '正文标题');
    assert.equal(apply(result.text, result.start, result.end, `heading${depth}`).text, '正文标题');
  }
});

test('heading conversion changes existing level instead of accumulating markers and preserves the caret', () => {
  const result = apply('## 二级标题', 5, 5, 'heading3');
  assert.equal(result.text, '### 二级标题');
  assert.equal(result.start, 6);
  assert.equal(result.end, 6);
});

test('line selection excludes an unselected next line and preserves CRLF exactly', () => {
  const source = '第一行\r\n第二行\r\n第三行';
  const end = source.indexOf('第三行');
  const result = apply(source, 0, end, 'unordered');
  assert.equal(result.text, '- 第一行\r\n- 第二行\r\n第三行');
  assert.equal(result.text.slice(result.end), '第三行');
  assert.equal(apply(result.text, result.start, result.end, 'unordered').text, source);
});

test('quoting selected lines preserves blank lines, nesting and unselected neighbors', () => {
  const source = '前文\n第一行\n\n- 第二行\n尾文';
  const result = apply(source, source.indexOf('第一行') + 1, source.indexOf('尾文') - 1, 'quote');
  assert.equal(result.text, '前文\n> 第一行\n\n> - 第二行\n尾文');
  assert.equal(apply(result.text, result.start, result.end, 'quote').text, source);
});

test('list conversion removes old markers, preserves indentation, and ordered lists count content lines', () => {
  const source = '- 第一项\n\n  - [x] 第二项\n+ 第三项';
  const ordered = apply(source, 0, source.length, 'ordered');
  assert.equal(ordered.text, '1. 第一项\n\n  2. 第二项\n3. 第三项');
  const tasks = apply(ordered.text, ordered.start, ordered.end, 'task');
  assert.equal(tasks.text, '- [ ] 第一项\n\n  - [ ] 第二项\n- [ ] 第三项');
  const plain = apply(tasks.text, tasks.start, tasks.end, 'task');
  assert.equal(plain.text, '第一项\n\n  第二项\n第三项');
});

test('inline code chooses a safe delimiter around literal backticks and round trips the content', () => {
  for (const source of ['a`b', '`x', 'x`', 'a``b', ' leading and trailing ', '   ']) {
    const result = apply(source, 0, source.length, 'inlineCode');
    assert.equal(nodes(result.text)[0].children[0].type, 'inlineCode');
    assert.equal(nodes(result.text)[0].children[0].value, source);
    assert.equal(apply(result.text, 0, result.text.length, 'inlineCode').text, source);
    assert.equal(apply(result.text, result.start, result.end, 'inlineCode').text, source);
  }
});

test('a fenced code block safely contains Markdown fences and does not consume neighboring paragraphs', () => {
  const source = '前文const text = ```;尾文';
  const selected = 'const text = ```;';
  const start = source.indexOf(selected);
  const result = apply(source, start, start + selected.length, 'codeBlock');
  assert.equal(result.text, `前文\n\n\`\`\`\`\n${selected}\n\`\`\`\`\n\n尾文`);
  assert.equal(result.selected, selected);
  assert.equal(nodes(result.text)[1].type, 'code');
  assert.equal(nodes(result.text)[1].value, selected);
  assert.equal(apply(result.text, result.start, result.end, 'codeBlock').text, `前文\n\n${selected}\n\n尾文`);
});

test('selecting a complete code block removes both fences, including language metadata', () => {
  for (const source of ['```ts\nconst n = 1;\n```', '~~~ js\r\nconst n = 1;\r\n~~~']) {
    const result = apply(source, 0, source.length, 'codeBlock');
    assert.equal(result.text, 'const n = 1;');
    assert.equal(result.selected, 'const n = 1;');
  }
});

test('math blocks use native remark-math syntax and preserve CRLF and selected LaTeX', () => {
  const source = '前文\r\nx^2 + y^2\r\n后文';
  const start = source.indexOf('x');
  const result = apply(source, start, start + 9, 'mathBlock');
  assert.equal(result.text, '前文\r\n\r\n$$\r\nx^2 + y^2\r\n$$\r\n\r\n后文');
  assert.equal(nodes(result.text)[1].type, 'math');
  assert.equal(nodes(result.text)[1].value, 'x^2 + y^2');
  assert.equal(apply('$$\nx^2\n$$', 0, 11, 'mathBlock').text, 'x^2');
});

test('links and images escape label brackets, select the destination and parse as references', () => {
  for (const [command, type, prefix] of [['link', 'link', ''], ['image', 'image', '!']]) {
    const result = apply('说明 [细节]', 0, 7, command);
    assert.ok(result.text.startsWith(`${prefix}[说明 \\[细节\\]](`));
    assert.equal(result.selected, command === 'image' ? '/images/article/image.png' : 'https://example.com');
    assert.equal(nodes(result.text)[0].children[0].type, type);
    if (command === 'image') assert.equal(new URL(result.selected, 'https://y4ho0.github.io/admin/').origin, 'https://y4ho0.github.io');
  }
});

test('selecting a complete link or image removes only its reference wrapper', () => {
  for (const [command, source] of [['link', '[说明](https://example.com/a(b))'], ['image', '![说明](https://example.com/image.png)']]) {
    assert.equal(apply(source, 0, source.length, command).text, '说明');
  }
  assert.equal(apply('prefix [说明](url) suffix', 7, 9, 'link').text, 'prefix [\\[说](https://example.com)明](url) suffix');
  const multiple = '[甲](https://a.example)[乙](https://b.example)';
  assert.ok(apply(multiple, 0, multiple.length, 'link').text.includes('https://b.example'));
});

test('table insertion uses a selected heading safely and keeps surrounding paragraphs separate', () => {
  const result = apply('前文\n\n列 | 一\n\n后文', 4, 9, 'table');
  assert.ok(result.text.startsWith('前文\n\n| 列 \\| 一 | 列 2 |'));
  assert.equal(result.selected, '列 \\| 一');
  assert.equal(nodes(result.text)[1].type, 'table');
  assert.equal(nodes(result.text)[1].children[0].children[0].children[0].value, '列 | 一');
  assert.ok(result.text.endsWith('\n\n后文'));
});

test('separator insertion leaves selected text intact and places the caret on a following paragraph', () => {
  const result = apply('前文后文', 2, 4, 'hr');
  assert.equal(result.text, '前文\n\n---\n\n后文');
  assert.equal(result.text.slice(result.start), '后文');
  assert.equal(nodes(result.text)[1].type, 'thematicBreak');
});

test('invalid coordinates and unknown commands are rejected or safely clamped', () => {
  assert.equal(editMarkdown('abc', Number.NaN, 1, 'bold'), undefined);
  assert.equal(editMarkdown('abc', 0, Number.POSITIVE_INFINITY, 'bold'), undefined);
  assert.equal(editMarkdown('abc', 0, 1, 'missing-command'), undefined);
  assert.equal(apply('abc', 99, -20, 'bold').text, '**abc**');
  assert.equal(apply('abc', 2.9, 1.1, 'bold').text, 'a**b**c');
});

test('every command preserves all text outside its single declared edit range', () => {
  const source = '前文\n\n被选的内容\n\n后文';
  const start = source.indexOf('被选');
  const end = source.indexOf('\n\n后文');
  for (const command of COMMANDS) {
    const result = apply(source, start, end, command.id);
    assert.ok(result.text.startsWith(source.slice(0, result.change.start)), command.id);
    assert.ok(result.text.endsWith(source.slice(result.change.end)), command.id);
  }
});

test('an initial blank line remains outside a following line edit and never reverses the replacement range', () => {
  assert.equal(apply('\n正文', 0, 0, 'heading2').text, '## 标题\n正文');
  assert.equal(apply('\n正文', 1, 3, 'quote').text, '\n> 正文');
});
