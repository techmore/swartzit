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
