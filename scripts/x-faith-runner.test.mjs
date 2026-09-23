import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFaithPost, selectFaithPosts } from './x-faith-runner.mjs';

const post = (id, body, extra = {}) => ({
  source_url: `https://x.com/example/status/${id}`,
  title: body.split(' ')[0], body, published_at: '2026-09-22T12:00:00Z',
  source_likes: 0, source_reposts: 0, source_replies: 0, ...extra,
});

test('Protestant language outranks generic Christian language', () => {
  assert.ok(scoreFaithPost(post('1', 'A Presbyterian reading of the Westminster Confession')) > scoreFaithPost(post('2', 'Christian encouragement for the church')));
});

test('selection deduplicates statuses and keeps the strongest query match', () => {
  const posts = [
    { ...post('1', 'Christian church'), _queryWeight: 1 },
    { ...post('1', 'Presbyterian church and sola scriptura'), _queryWeight: 5 },
    { ...post('2', 'Biblical theology'), _queryWeight: 3 },
  ];
  const selected = selectFaithPosts(posts, 10);
  assert.equal(selected.length, 2);
  assert.match(selected[0].body, /Presbyterian/);
  assert.equal(selected[0]._queryWeight, undefined);
});

test('selection keeps links from both X and Reddit', () => {
  const selected = selectFaithPosts([
    { ...post('3', 'Presbyterian theology'), provider: 'x', source_url: 'https://x.com/example/status/3' },
    { ...post('4', 'Reformed Bible study'), provider: 'reddit', source_url: 'https://www.reddit.com/r/Reformed/comments/4/post' },
  ], 10);
  assert.deepEqual(new Set(selected.map(item => item.provider)), new Set(['x', 'reddit']));
});
