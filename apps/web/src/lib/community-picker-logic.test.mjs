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
  const postComposer = readFileSync(fileURLToPath(new URL('./PostComposer.svelte', import.meta.url)), 'utf8');
  const quickCrossPost = readFileSync(fileURLToPath(new URL('./QuickCrossPost.svelte', import.meta.url)), 'utf8');
  const crossPostRoute = readFileSync(fileURLToPath(new URL('../routes/api/cross-post/+server.js', import.meta.url)), 'utf8');

  // The shared composer reads the community from the URL and falls back to General.
  assert.match(postComposer, /selectedCommunity = fromUrl \|\| 'general'/);
  assert.match(postComposer, /community = preferredCommunity\(communities, selectedCommunity\)/);
  assert.match(postComposer, /community: community \|\| 'general'/);
  assert.match(quickCrossPost, /community = xOnly && hideCommunity \? 'general' : preferredCommunity\(communities, selectedCommunity\)/);
  assert.match(quickCrossPost, /community: community \|\| 'general'/);
  assert.match(crossPostRoute, /crossPostCommunity\(input\.community\)/);
});

test('one global composer serves every page, opened from the header or mobile bar', () => {
  const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const composer = read('./PostComposer.svelte');
  const layout = read('../routes/+layout.svelte');
  const header = read('./SiteHeader.svelte');
  const mobile = read('./MobileNav.svelte');

  assert.match(layout, /<PostComposer \/>/);
  assert.match(composer, /swartzit:compose/);
  assert.match(composer, /role="dialog" aria-modal="true"/);
  assert.match(composer, /mode === 'x'/);
  assert.match(header, /swartzit:compose/);
  assert.match(mobile, /swartzit:compose/);
  // Pages no longer mount their own composer.
  assert.doesNotMatch(read('../routes/+page.svelte'), /<PostComposer/);
  assert.doesNotMatch(read('../routes/post/[id]/+page.svelte'), /<PostComposer/);
});
