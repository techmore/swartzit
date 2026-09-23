import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplate } from './runner-starter.mjs';

test('smoke template emits a valid single post', () => {
  const post = buildTemplate('smoke', { now: '2026-09-23T00:00:00.000Z' });
  assert.equal(post.title, 'Swartzit runner smoke test');
  assert.equal(typeof post.body, 'string');
  assert.equal(post.source_url, 'https://stoverparc.org/');
});

test('prompt template preserves the configured prompt', () => {
  const post = buildTemplate('prompt', { prompt: 'Write a short morning note.', now: '2026-09-23T00:00:00.000Z' });
  assert.match(post.body, /^Write a short morning note\./);
});

test('batch template emits two bounded posts', () => {
  const result = buildTemplate('batch', { now: '2026-09-23T00:00:00.000Z' });
  assert.equal(result.posts.length, 2);
  assert.ok(result.posts.every(post => post.title && post.body && post.source_url));
});

test('unknown template fails clearly', () => {
  assert.throws(() => buildTemplate('missing'), /Unknown starter template/);
});
