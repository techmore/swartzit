import assert from 'node:assert/strict';
import test from 'node:test';
import { timeAgo } from './time-ago.mjs';

const now = Date.parse('2026-10-26T12:00:00Z');
const ago = ms => new Date(now - ms).toISOString();

test('formats recent times compactly', () => {
  assert.equal(timeAgo(ago(10_000), now), 'now');
  assert.equal(timeAgo(ago(5 * 60_000), now), '5m');
  assert.equal(timeAgo(ago(3 * 3_600_000), now), '3h');
  assert.equal(timeAgo(ago(2 * 86_400_000), now), '2d');
});

test('falls back to a date for older posts and empty for invalid input', () => {
  assert.notEqual(timeAgo(ago(30 * 86_400_000), now), '30d');
  assert.equal(timeAgo('not a date', now), '');
  assert.equal(timeAgo(undefined, now), '');
});
