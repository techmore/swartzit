import test from 'node:test';
import assert from 'node:assert/strict';
import {buildXJobs, buildXSearchQuery, collectCrossPosts, normalizeXWindow, parseDelimitedList} from './x-cross-post-runner.mjs';

test('builds a bounded multi-account topic query', () => {
  const query = buildXSearchQuery({accounts: ['alpha', 'beta'], topics: ['local AI', '#DrawThings']});
  assert.match(query, /from:alpha/);
  assert.match(query, /from:beta/);
  assert.match(query, /"local AI"/);
  assert.match(query, /#DrawThings/);
  assert.match(query, /-is:retweet/);
  assert.match(query, /-is:reply/);
});

test('creates account, topic, and explicit query jobs', () => {
  const jobs = buildXJobs({accounts: ['@alpha'], topics: ['model testing'], queries: ['from:gamma launch']});
  assert.equal(jobs.length, 2);
  assert.match(jobs[0].source, /^search:/);
  assert.equal(jobs[1].source, 'search:from:gamma launch');
  assert.deepEqual(parseDelimitedList(['["alpha", "beta"]', 'gamma,delta'], 'accounts'), ['alpha', 'beta', 'gamma', 'delta']);
});

test('normalizes an explicit time window and rejects inverted ranges', () => {
  assert.deepEqual(
    normalizeXWindow({hours: 6, now: '2026-09-23T12:00:00.000Z'}),
    {start_time: '2026-09-23T06:00:00.000Z', end_time: '2026-09-23T12:00:00.000Z'}
  );
  assert.throws(() => normalizeXWindow({startTime: '2026-09-23T12:00:00.000Z', endTime: '2026-09-23T11:00:00.000Z'}), /earlier/);
});

test('collects, filters, deduplicates, and bounds posts for the worker contract', async () => {
  const calls = [];
  const posts = await collectCrossPosts({accounts: ['alpha', 'beta'], limit: 2, perSource: 10, hours: 24}, {
    now: '2026-09-23T12:00:00.000Z',
    collector: async job => {
      calls.push(job);
      return [
        {source_url: 'https://x.com/alpha/status/1', source_author: '@alpha', published_at: '2026-09-23T11:00:00.000Z', body: 'one', source_likes: 5, source_reposts: 1, source_replies: 0},
        {source_url: 'https://x.com/alpha/status/1', source_author: '@alpha', published_at: '2026-09-23T11:00:00.000Z', body: 'one', source_likes: 8, source_reposts: 1, source_replies: 0},
        {source_url: 'https://x.com/old/status/2', source_author: '@old', published_at: '2026-09-22T00:00:00.000Z', body: 'old', source_likes: 100, source_reposts: 0, source_replies: 0}
      ];
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].start_time, '2026-09-22T12:00:00.000Z');
  assert.deepEqual(posts.map(post => post.source_url), ['https://x.com/alpha/status/1']);
  assert.equal(posts[0].source_likes, 8);
  assert.ok(!Object.hasOwn(posts[0], '_runner_source'));
});
