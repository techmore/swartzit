import assert from 'node:assert/strict';
import test from 'node:test';
import {collectX, normalizeXBearerToken} from './crawler-adapters.mjs';

test('normalizes URL-encoded bearer tokens without changing raw tokens', () => {
  assert.equal(normalizeXBearerToken('raw-token/with+symbols='), 'raw-token/with+symbols=');
  assert.equal(normalizeXBearerToken('encoded%2Ftoken%2Bvalue%3D'), 'encoded/token+value=');
  assert.throws(() => normalizeXBearerToken('bad%2'), /invalid percent encoding/);
});

test('X collection sends the normalized token to the API', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.X_BEARER_TOKEN;
  const originalMode = process.env.X_SOURCE_MODE;
  const calls = [];
  process.env.X_BEARER_TOKEN = 'encoded%2Ftoken%3D';
  delete process.env.X_SOURCE_MODE;
  globalThis.fetch = async (url, options) => {
    calls.push({url: String(url), authorization: options.headers.authorization});
    if (String(url).includes('/users/by/username/')) {
      return {ok: true, json: async () => ({data: {id: '42', username: 'DarioAmodei'}})};
    }
    return {
      ok: true,
      json: async () => ({data: [{id: '1001', text: 'A public post', author_id: '42'}]}),
    };
  };
  try {
    const posts = await collectX({source: '@DarioAmodei', community: 'testing', max_items: 10});
    assert.equal(posts.length, 1);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.authorization === 'Bearer encoded/token='));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.X_BEARER_TOKEN;
    else process.env.X_BEARER_TOKEN = originalToken;
    if (originalMode === undefined) delete process.env.X_SOURCE_MODE;
    else process.env.X_SOURCE_MODE = originalMode;
  }
});

test('recent-search uses query operators for reply/retweet exclusions', async () => {
  const previous = {fetch: globalThis.fetch, token: process.env.X_BEARER_TOKEN, mode: process.env.X_SOURCE_MODE};
  let requested;
  process.env.X_BEARER_TOKEN = 'test-token';
  delete process.env.X_SOURCE_MODE;
  globalThis.fetch = async url => {
    requested = new URL(url);
    return {ok: true, json: async () => ({data: []})};
  };
  try {
    await collectX({source: 'search:from:alpha launch', max_items: 10, exclude: ['replies', 'retweets'], start_time: '2026-10-07T20:00:00Z'});
    assert.equal(requested.searchParams.has('exclude'), false);
    assert.match(requested.searchParams.get('query'), /-is:reply/);
    assert.match(requested.searchParams.get('query'), /-is:retweet/);
    assert.equal(requested.searchParams.get('start_time'), '2026-10-07T20:00:00.000Z');
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.token === undefined) delete process.env.X_BEARER_TOKEN; else process.env.X_BEARER_TOKEN = previous.token;
    if (previous.mode === undefined) delete process.env.X_SOURCE_MODE; else process.env.X_SOURCE_MODE = previous.mode;
  }
});

test('API import retains expanded text, parent/quote context, and media', async () => {
  const previous = {fetch: globalThis.fetch, token: process.env.X_BEARER_TOKEN, mode: process.env.X_SOURCE_MODE};
  process.env.X_BEARER_TOKEN = 'test-token';
  delete process.env.X_SOURCE_MODE;
  globalThis.fetch = async () => ({ok: true, json: async () => ({
    data: [{id: '3', author_id: 'a', text: 'preview', note_tweet: {text: 'Complete long post'}, created_at: '2026-10-08T20:00:00Z', referenced_tweets: [{type: 'quoted', id: '2'}, {type: 'replied_to', id: '1'}], attachments: {media_keys: ['image1']}}],
    includes: {users: [{id: 'a', username: 'alpha'}, {id: 'b', username: 'beta'}], tweets: [{id: '1', author_id: 'b', text: 'Parent context'}, {id: '2', author_id: 'b', text: 'Quoted context'}], media: [{media_key: 'image1', type: 'photo', url: 'https://pbs.twimg.com/media/photo.jpg'}]}
  })});
  try {
    const [post] = await collectX({source: 'search:context', max_items: 10});
    assert.match(post.body, /^Complete long post/);
    assert.match(post.body, /Thread context by @beta:\s+Parent context/);
    assert.match(post.body, /Quoted post by @beta: Quoted context/);
    assert.equal(post.media[0].kind, 'image');
    assert.equal(post.source_views, null);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.token === undefined) delete process.env.X_BEARER_TOKEN; else process.env.X_BEARER_TOKEN = previous.token;
    if (previous.mode === undefined) delete process.env.X_SOURCE_MODE; else process.env.X_SOURCE_MODE = previous.mode;
  }
});
