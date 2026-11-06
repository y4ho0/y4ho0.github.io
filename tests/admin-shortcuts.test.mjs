import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalShortcut, shortcutFromEvent, matchesShortcut, validateBindings } from '../src/admin/shortcuts.ts';

const event = (key = 'b', options = {}) => ({ key, code: `Key${key.toUpperCase()}`, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, ...options });
const defaults = {
  bold: 'Mod+B', italic: 'Mod+I', strike: 'Mod+Shift+X',
  ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`heading${index + 1}`, `Mod+Alt+${index + 1}`])),
  quote: 'Mod+Alt+Q', ordered: 'Mod+Shift+7', unordered: 'Mod+Shift+8', task: 'Mod+Shift+9',
  inlineCode: 'Mod+E', codeBlock: 'Mod+Shift+E', link: 'Mod+K', image: 'Mod+Alt+Shift+I',
  table: 'Mod+Alt+Shift+T', hr: 'Mod+Alt+Shift+H', mathInline: 'Mod+Alt+Shift+M', mathBlock: 'Mod+Alt+Shift+B',
};

test('canonical shortcuts normalize aliases, modifier order, case and disabled values', () => {
  assert.equal(canonicalShortcut(' shift + mod + b '), 'Mod+Shift+B');
  assert.equal(canonicalShortcut('Option+CMD+shift+m'), 'Meta+Alt+Shift+M');
  assert.equal(canonicalShortcut('Control+Alt+enter'), 'Ctrl+Alt+Enter');
  assert.equal(canonicalShortcut('alt+F2'), 'Alt+F2');
  assert.equal(canonicalShortcut('Ctrl+alt+spacebar'), 'Ctrl+Alt+Space');
  assert.equal(canonicalShortcut(''), '');
  assert.equal(canonicalShortcut('   '), '');
});

test('bindings need a real key and a command modifier to leave normal typing intact', () => {
  for (const value of ['B', 'Shift+B', 'Ctrl', 'Meta+Alt', 'Mod+Ctrl+B', 'Mod+Meta+B', 'Mod+Mod+B', 'Ctrl+B+I', 'Mod++B', 'Mod+中文', 'Mod+Dead']) {
    assert.throws(() => canonicalShortcut(value), undefined, value);
  }
});

test('native editing, browser window commands and system minimize stay reserved', () => {
  for (const modifier of ['Mod', 'Ctrl', 'Meta']) {
    for (const value of ['A', 'C', 'X', 'V', 'Z', 'Shift+Z', 'Y', 'Shift+V', 'R', 'Shift+R', 'W', 'T', 'N', 'Q', 'Shift+Q', 'Shift+I', 'Shift+J', 'Shift+C', 'P', 'L', 'F', 'M', 'Tab', 'ArrowLeft', 'Minus', '0']) {
      assert.throws(() => canonicalShortcut(`${modifier}+${value}`), /保留/, `${modifier}+${value}`);
    }
  }
  for (const value of ['Alt+F4', 'Alt+ArrowLeft', 'Alt+Tab', 'Ctrl+Alt+Delete', 'Ctrl+F5', 'Meta+F12']) {
    assert.throws(() => canonicalShortcut(value), /保留/, value);
  }
});

test('all requested defaults remain available without conflicts', () => {
  for (const binding of Object.values(defaults)) assert.ok(canonicalShortcut(binding));
  assert.deepEqual(validateBindings(defaults, Object.keys(defaults)), {});
});

test('known macOS global and native Alt editing shortcuts cannot be intercepted', () => {
  for (const modifier of ['Meta', 'Mod']) {
    for (const key of ['H', 'M', 'W', 'D', 'I', 'T', 'Escape', 'Shift+Escape', 'Space', 'Shift+Space', 'C', 'Shift+C', 'V', 'Shift+V', 'X', 'Shift+X', 'Z', 'Shift+Z']) {
      assert.throws(() => canonicalShortcut(`${modifier}+Alt+${key}`), /保留/, `${modifier}+Alt+${key}`);
    }
  }
  for (const key of ['h', 'm', 'w', 'd', 'i', 't', 'Escape', ' ']) {
    assert.equal(shortcutFromEvent(event(key, { metaKey: true, altKey: true })), undefined, key);
  }
  for (const key of ['C', 'V', 'X', 'Z', 'Shift+C', 'Shift+V', 'Shift+X', 'Shift+Z']) {
    assert.throws(() => canonicalShortcut(`Ctrl+Alt+${key}`), /保留/, `Ctrl+Alt+${key}`);
  }
  for (const key of ['H', 'M', 'I', 'T', 'B']) assert.equal(canonicalShortcut(`Mod+Alt+Shift+${key}`), `Mod+Alt+Shift+${key}`);
  assert.equal(canonicalShortcut('Alt+B'), 'Alt+B', 'unrelated Alt combinations remain customizable');
  assert.equal(canonicalShortcut('Mod+Alt+Q'), 'Mod+Alt+Q');
});

test('event extraction returns physical modifiers and normalizes shifted number-row symbols', () => {
  assert.equal(shortcutFromEvent(event('B', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+B');
  assert.equal(shortcutFromEvent(event('b', { metaKey: true })), 'Meta+B');
  assert.equal(shortcutFromEvent(event('&', { code: 'Digit7', ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+7');
  assert.equal(shortcutFromEvent(event('*', { code: 'Digit8', metaKey: true, shiftKey: true })), 'Meta+Shift+8');
  assert.equal(shortcutFromEvent(event('(', { code: 'Digit9', metaKey: true, shiftKey: true })), 'Meta+Shift+9');
  assert.equal(shortcutFromEvent(event(' ', { code: 'Space', altKey: true, shiftKey: true })), 'Alt+Shift+Space');
  assert.equal(shortcutFromEvent(event('_', { code: 'Minus', altKey: true, shiftKey: true })), 'Alt+Shift+Minus');
  assert.equal(shortcutFromEvent(event('å', { code: 'KeyA', metaKey: true, altKey: true })), 'Meta+Alt+A');
  assert.equal(shortcutFromEvent(event('Dead', { code: 'KeyI', metaKey: true, altKey: true, shiftKey: true })), 'Meta+Alt+Shift+I');
});

test('composition, AltGraph, repeats, plain typing and modifier-only events never activate commands', () => {
  for (const input of [
    event('b'), event('B', { shiftKey: true }), event('b', { ctrlKey: true, repeat: true }),
    event('b', { ctrlKey: true, isComposing: true }), event('b', { ctrlKey: true, keyCode: 229 }),
    event('b', { ctrlKey: true, altKey: true, getModifierState: key => key === 'AltGraph' }),
    event('Control', { ctrlKey: true }), event('Meta', { metaKey: true }), event('Shift', { ctrlKey: true, shiftKey: true }),
    event('Process', { ctrlKey: true }), event('Dead', { altKey: true }), event('中文', { ctrlKey: true }),
    event('v', { ctrlKey: true }), event('r', { metaKey: true }),
  ]) assert.equal(shortcutFromEvent(input), undefined, JSON.stringify(input));
});

test('Mod resolves by platform and matching requires all modifiers exactly', () => {
  assert.equal(matchesShortcut(event('b', { metaKey: true }), 'Mod+B', true), true);
  assert.equal(matchesShortcut(event('b', { ctrlKey: true }), 'Mod+B', false), true);
  assert.equal(matchesShortcut(event('b', { ctrlKey: true }), 'Mod+B', true), false);
  assert.equal(matchesShortcut(event('b', { metaKey: true }), 'Mod+B', false), false);
  assert.equal(matchesShortcut(event('b', { ctrlKey: true, shiftKey: true }), 'Mod+B', false), false);
  assert.equal(matchesShortcut(event('m', { metaKey: true, altKey: true, shiftKey: true }), defaults.mathInline, true), true);
  assert.equal(matchesShortcut(event('Dead', { code: 'KeyI', metaKey: true, altKey: true, shiftKey: true }), defaults.image, true), true);
  assert.equal(matchesShortcut(event('b', { ctrlKey: true, altKey: true }), 'Ctrl+Alt+B', true), true);
  assert.equal(matchesShortcut(event('b', { ctrlKey: true }), '', false), false);
  assert.equal(matchesShortcut(event('v', { ctrlKey: true }), 'Mod+V', false), false);
  assert.equal(matchesShortcut(event('b', { ctrlKey: true }), 'invalid', false), false);
});

test('custom shifted-number shortcuts match the same default used in recorded bindings', () => {
  assert.equal(matchesShortcut(event('&', { code: 'Digit7', metaKey: true, shiftKey: true }), defaults.ordered, true), true);
  assert.equal(matchesShortcut(event('*', { code: 'Digit8', ctrlKey: true, shiftKey: true }), defaults.unordered, false), true);
  assert.equal(matchesShortcut(event('(', { code: 'Digit9', ctrlKey: true, shiftKey: true }), defaults.task, false), true);
});

test('validation reports unknown command IDs, invalid values and disabled bindings independently', () => {
  const errors = validateBindings({ bold: 'B', italic: '', missing: 'Alt+B', link: 'Mod+V' }, ['bold', 'italic', 'link']);
  assert.ok(errors.bold);
  assert.ok(errors.missing);
  assert.ok(errors.link);
  assert.equal(errors.italic, undefined);
});

test('duplicate detection includes aliases and Mod collisions with either platform physical key', () => {
  for (const second of ['mod+b', 'Ctrl+B', 'Meta+B']) {
    const errors = validateBindings({ bold: 'Mod+B', italic: second }, ['bold', 'italic']);
    assert.match(errors.bold, /冲突/);
    assert.match(errors.italic, /冲突/);
  }
  assert.deepEqual(validateBindings({ bold: 'Ctrl+B', italic: 'Meta+B', link: '' }, ['bold', 'italic', 'link']), {});
  assert.deepEqual(validateBindings({ bold: '', italic: '' }, ['bold', 'italic']), {});
});
