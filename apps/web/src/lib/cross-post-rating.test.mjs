import test from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../routes/api/cross-post/+server.js';

test('bookmark link imports cannot replace a sensitive source rating with General', async () => {
  const originalFetch = globalThis.fetch;
  let published;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/api/me')) return Response.json({handle: 'owner'});
    if (String(url).includes('cdn.syndication.twimg.com')) return Response.json({
      id_str: '123', text: 'Source', possibly_sensitive: true, user: {screen_name: 'source'}
    });
    if (String(url).endsWith('/api/posts/cross-post')) {
      published = JSON.parse(options.body);
      return Response.json({id: 1});
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const result = await POST({request: new Request('https://example.test/api/cross-post', {
      method: 'POST', headers: {authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json'},
      body: JSON.stringify({url: 'https://x.com/source/status/123', community: 'x_imports', content_rating: 'general'})
    })});
    assert.equal(result.status, 200);
    assert.equal(published.content_rating, 'x');
  } finally { globalThis.fetch = originalFetch; }
});
