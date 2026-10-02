import test from 'node:test';
import assert from 'node:assert/strict';
import { copyTextToClipboard } from './post-preferences.mjs';

test('share copies the full post URL using the clipboard API', async () => {
  const expected = 'https://swartzit.stoverparc.org/post/abc';
  let copied;
  const navigatorObject = { clipboard: { async writeText(value) { copied = value; } } };

  assert.equal(await copyTextToClipboard(expected, navigatorObject, {}), true);
  assert.equal(copied, expected);
});

test('share falls back to the legacy clipboard command when clipboard API is unavailable', async () => {
  let copied = '';
  const input = {
    value: '',
    style: {},
    setAttribute() {},
    select() {},
    setSelectionRange() {},
    remove() {}
  };
  const documentObject = {
    createElement: () => input,
    body: { appendChild(element) { copied = element.value; } },
    execCommand: () => true
  };

  assert.equal(await copyTextToClipboard('https://swartzit.stoverparc.org/post/abc', {}, documentObject), true);
  assert.equal(copied, 'https://swartzit.stoverparc.org/post/abc');
});

test('share reports failure when neither clipboard path succeeds', async () => {
  const documentObject = {
    createElement: () => ({ setAttribute() {}, select() {}, setSelectionRange() {}, remove() {} }),
    body: { appendChild() {} },
    execCommand: () => false
  };

  assert.equal(await copyTextToClipboard('https://swartzit.stoverparc.org/post/abc', {}, documentObject), false);
});
