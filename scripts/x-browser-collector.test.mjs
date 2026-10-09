import assert from 'node:assert/strict';
import test from 'node:test';
import {collectXFromPlaywright, xBrowserPlan} from './crawler-adapters.mjs';

const now = Date.parse('2026-10-08T21:15:00Z');

test('browser search uses Latest, bounded dates and UI operators outside quoted phrases', () => {
  const plan = xBrowserPlan({source: 'search:(Reformed OR "is:reply example") has:media -is:retweet', max_items: 20, exclude: ['replies'], hours: 24}, now);
  const url = new URL(plan.url);
  assert.equal(url.pathname, '/search');
  assert.equal(url.searchParams.get('f'), 'live');
  const query = url.searchParams.get('q');
  assert.match(query, /"is:reply example"/);
  assert.match(query, /filter:media -filter:retweets/);
  assert.match(query, /-filter:replies/);
  assert.match(query, /since:2026-10-07 until:2026-10-09/);
  assert.equal(plan.limit, 20);
});

test('browser plans validate before opening a profile', () => {
  assert.equal(xBrowserPlan({source: '@alpha', max_items: 50}, now).url, 'https://x.com/alpha');
  assert.throws(() => xBrowserPlan({source: 'search:', max_items: 10}, now), /query/);
  assert.throws(() => xBrowserPlan({source: '@alpha', max_items: 101}, now), /max_items/);
  assert.throws(() => xBrowserPlan({source: '@alpha', start_time: 'invalid'}, now), /window/);
});

test('search results preserve the actual author URL, exact time window and resolved context', async () => {
  let closed = false;
  const urls = [];
  const page = {
    goto: async url => assert.equal(new URL(url).pathname, '/search'),
    waitForSelector: async () => {},
    evaluate: async () => [
      {id: '1', href: 'https://x.com/beta/status/1', published_at: '2026-10-08T20:00:00Z'},
      {id: '2', href: 'https://x.com/older/status/2', published_at: '2026-10-01T20:00:00Z'},
      {id: '1', href: 'https://twitter.com/beta/status/1', published_at: '2026-10-08T20:00:00Z'}
    ],
  };
  const posts = await collectXFromPlaywright({source: 'search:context', community: 'x_imports', max_items: 1}, {
    now,
    launch: async () => ({newPage: async () => page, close: async () => {closed = true;}}),
    resolve: async sourceUrl => {urls.push(sourceUrl);return {source_url: sourceUrl, source_author: '@beta', published_at: '2026-10-08T20:00:00Z', body: 'Complete post\n\nQuoted post: full context', media: []};}
  });
  assert.equal(closed, true);
  assert.deepEqual(urls, ['https://x.com/i/status/1']);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body, /full context/);
  assert.equal(posts[0].source_author, '@beta');
  assert.equal(posts[0].community, 'x_imports');
});

test('empty search closes the browser and returns no content without claiming a login failure', async () => {
  let closed = false;
  const page = {goto: async () => {},waitForSelector: async () => {throw Error('timeout');},locator: () => ({innerText: async () => 'No results for this query. Try searching for something else.'})};
  const result = await collectXFromPlaywright({source: 'search:empty', max_items: 5}, {
    now,launch: async () => ({newPage: async () => page,close: async () => {closed = true;}})
  });
  assert.deepEqual(result, []);
  assert.equal(closed, true);
});
