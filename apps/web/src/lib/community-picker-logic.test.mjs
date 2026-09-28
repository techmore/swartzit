import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crossPostCommunity, preferredCommunity, selectedCommunityState } from './community-picker-logic.mjs';

const communities = [
  { slug: 'x_imports', name: 'X imports' },
  { slug: 'general', name: 'General' },
  { slug: 'photography', name: 'Photography' },
  { slug: 'space', name: 'Space' }
];

test('defaults to General while preserving an explicit community selection', () => {
  assert.equal(preferredCommunity(communities, 'space'), 'space');
  assert.equal(preferredCommunity(communities, ''), 'general');
});

test('cross-posts default missing or blank communities to General', () => {
  assert.equal(crossPostCommunity(''), 'general');
  assert.equal(crossPostCommunity(null), 'general');
  assert.equal(crossPostCommunity('  Ask  '), 'ask');
});

test('returns a committed picker state for a clicked result', () => {
  assert.deepEqual(selectedCommunityState({ slug: 'photography' }), {
    value: 'photography',
    query: 'photography',
    open: false
  });
});

test('handles an empty community list without inventing a selection', () => {
  assert.equal(preferredCommunity([], 'space'), '');
});

test('new posts and cross-posts use the General community default', () => {
  const page = readFileSync(fileURLToPath(new URL('../routes/+page.svelte', import.meta.url)), 'utf8');
  const quickCrossPost = readFileSync(fileURLToPath(new URL('./QuickCrossPost.svelte', import.meta.url)), 'utf8');
  const crossPostRoute = readFileSync(fileURLToPath(new URL('../routes/api/cross-post/+server.js', import.meta.url)), 'utf8');

  assert.match(page, /const initialCommunity = preferredCommunity\(data\.communities\)/);
  assert.match(quickCrossPost, /community = preferredCommunity\(communities, selectedCommunity\)/);
  assert.match(crossPostRoute, /crossPostCommunity\(input\.community\)/);
});
