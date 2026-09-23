import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredCommunity, selectedCommunityState } from './community-picker-logic.mjs';

const communities = [
  { slug: 'x_imports', name: 'X imports' },
  { slug: 'photography', name: 'Photography' },
  { slug: 'space', name: 'Space' }
];

test('prefers the parent selection before the X-import fallback', () => {
  assert.equal(preferredCommunity(communities, 'space'), 'space');
  assert.equal(preferredCommunity(communities, ''), 'x_imports');
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
