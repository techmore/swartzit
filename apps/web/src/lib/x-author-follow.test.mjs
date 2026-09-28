import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { normalizeXAuthorHandle } from './x-author-follow.mjs';

const repoFile = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('X follow handles are case-insensitive and accept an optional at-sign', () => {
  assert.equal(normalizeXAuthorHandle('@Some_Person9'), 'some_person9');
  assert.equal(normalizeXAuthorHandle('another'), 'another');
});

test('X follow handles reject URLs, whitespace, punctuation, and overlong values', () => {
  for (const value of ['', '@', '@two words', 'https://x.com/person', 'a0123456789012345', 'two!']) {
    assert.equal(normalizeXAuthorHandle(value), '', `accepted ${value}`);
  }
});

test('X posts expose follow controls for the imported source author and show them in Following', () => {
  const sourcePost = repoFile('./SourcePost.svelte');
  const component = repoFile('./XAuthorFollowButton.svelte');
  const state = repoFile('./x-author-follow-state.js');
  const feed = repoFile('../routes/+page.svelte');
  assert.match(sourcePost, /<XAuthorFollowButton handle=\{source\.source_author\}/);
  assert.match(component, /setXAuthorFollow/);
  assert.match(state, /fetch\('\/api\/x-author-subscriptions'/);
  assert.match(component, /aria-pressed=\{following\}/);
  assert.match(feed, /<FollowingXAuthors \/>/);
  assert.match(feed, /Follow a person on X or a community/);
});
