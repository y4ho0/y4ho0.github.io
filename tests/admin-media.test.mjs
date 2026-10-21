import assert from 'node:assert/strict';
import test from 'node:test';
import { bindImageInput, imageFromTransfer, validateImage } from '../src/admin/media.ts';

const image = (name = 'image.png', type = 'image/png', bytes = [137, 80, 78, 71]) => new File([new Uint8Array(bytes)], name, { type });
const transfer = (files = [], items = [], types = files.length ? ['Files'] : []) => ({ files, items, types, dropEffect: 'none' });
const item = file => ({ kind: 'file', type: file.type, getAsFile: () => file });

function event(type, data) {
  const result = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(result, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: data });
  return result;
}

function harness() {
  const writing = new EventTarget();
  const media = new EventTarget();
  const files = [];
  const errors = [];
  const cleanup = bindImageInput({ dropTargets: [writing, media], pasteTarget: writing, onFile: file => files.push(file), onError: error => errors.push(error) });
  return { writing, media, files, errors, cleanup };
}

test('extracts the first image file and ignores text files and later images', () => {
  const first = image();
  const second = image('next.webp', 'image/webp');
  const data = transfer([new File(['text'], 'note.txt', { type: 'text/plain' }), first, second]);
  assert.equal(imageFromTransfer(data), first);
  assert.equal(imageFromTransfer(null), undefined);
});

test('reads clipboard file items when the file list is empty', () => {
  const file = image('clipboard.png');
  const textItem = { kind: 'string', type: 'text/plain', getAsFile: () => { throw new Error('must not read string as file'); } };
  assert.equal(imageFromTransfer(transfer([], [textItem, item(file)])), file);
  assert.equal(imageFromTransfer(transfer([], [{ kind: 'file', type: 'image/png', getAsFile: () => null }])), undefined);
});

test('pasted HTML and image URLs remain text without file extraction or network calls', () => {
  const text = { kind: 'string', type: 'text/html', getAsFile: () => { throw new Error('must not inspect HTML'); } };
  const data = transfer([], [text], ['text/html', 'text/uri-list']);
  data.getData = () => { throw new Error('must not read or fetch remote URLs'); };
  assert.equal(imageFromTransfer(data), undefined);
});

test('early validation accepts four image MIME types including clipboard filenames', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
    assert.doesNotThrow(() => validateImage(image('clipboard', type)));
  }
  assert.doesNotThrow(() => validateImage(new File([new Uint8Array(5 * 1024 * 1024)], 'limit.png', { type: 'image/png' })));
});

test('early validation rejects SVG, AVIF, unknown MIME, empty and oversized files', () => {
  for (const type of ['image/svg+xml', 'image/avif', 'text/html', '']) {
    assert.throws(() => validateImage(image('misleading.png', type)), /仅支持/);
  }
  assert.throws(() => validateImage(new File([], 'empty.png', { type: 'image/png' })), /大于 0/);
  assert.throws(() => validateImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })), /5 MiB/);
});

test('file dragover permits dropping and file drop delivers the first image once', () => {
  const { writing, media, files, errors } = harness();
  const first = image();
  const data = transfer([first, image('second.png')]);
  const drag = event('dragover', data);
  writing.dispatchEvent(drag);
  assert.equal(drag.defaultPrevented, true);
  assert.equal(data.dropEffect, 'copy');
  const drop = event('drop', data);
  media.dispatchEvent(drop);
  assert.equal(drop.defaultPrevented, true);
  assert.deepEqual(files, [first]);
  assert.deepEqual(errors, []);
});

test('protected dragover detects the Files marker before file items become readable', () => {
  const { writing } = harness();
  const drag = event('dragover', transfer([], [], ['Files']));
  writing.dispatchEvent(drag);
  assert.equal(drag.defaultPrevented, true);
});

test('unsupported dropped files cannot navigate away and give actionable feedback', () => {
  const { writing, files, errors } = harness();
  for (const file of [new File(['text'], 'note.txt', { type: 'text/plain' }), image('unsafe.svg', 'image/svg+xml')]) {
    const drop = event('drop', transfer([file]));
    writing.dispatchEvent(drop);
    assert.equal(drop.defaultPrevented, true);
  }
  assert.deepEqual(files, []);
  assert.equal(errors.length, 2);
  assert.ok(errors.every(error => error instanceof Error && /PNG/.test(error.message)));
});

test('keyboard image paste delivers a validated image and preserves ordinary text paste', () => {
  const { writing, files, errors } = harness();
  const file = image('clipboard.png');
  const paste = event('paste', transfer([], [item(file)]));
  writing.dispatchEvent(paste);
  assert.equal(paste.defaultPrevented, true);
  assert.deepEqual(files, [file]);
  const text = event('paste', transfer([], [{ kind: 'string', type: 'text/plain' }], ['text/plain']));
  writing.dispatchEvent(text);
  assert.equal(text.defaultPrevented, false);
  assert.deepEqual(errors, []);
});

test('invalid pasted images are blocked with feedback, and paste is scoped to the writing target', () => {
  const { writing, media, files, errors } = harness();
  const invalid = event('paste', transfer([image('vector.svg', 'image/svg+xml')]));
  writing.dispatchEvent(invalid);
  assert.equal(invalid.defaultPrevented, true);
  assert.equal(errors.length, 1);
  const outside = event('paste', transfer([image()]));
  media.dispatchEvent(outside);
  assert.equal(outside.defaultPrevented, false);
  assert.deepEqual(files, []);
});

test('text drags keep their native behavior and cleanup removes all event handlers', () => {
  const { writing, files, cleanup } = harness();
  for (const type of ['dragover', 'drop']) {
    const text = event(type, transfer([], [], ['text/plain']));
    writing.dispatchEvent(text);
    assert.equal(text.defaultPrevented, false);
  }
  cleanup();
  for (const type of ['dragover', 'drop', 'paste']) {
    const incoming = event(type, transfer([image()]));
    writing.dispatchEvent(incoming);
    assert.equal(incoming.defaultPrevented, false);
  }
  assert.deepEqual(files, []);
});

test('duplicate drop targets bind once and callback errors reach the error handler', () => {
  const writing = new EventTarget();
  const errors = [];
  let calls = 0;
  bindImageInput({ dropTargets: [writing, writing], pasteTarget: writing, onFile: () => { calls += 1; throw new Error('callback failed'); }, onError: error => errors.push(error) });
  writing.dispatchEvent(event('drop', transfer([image()])));
  assert.equal(calls, 1);
  assert.equal(errors[0].message, 'callback failed');
});
