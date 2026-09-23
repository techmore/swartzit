import assert from 'node:assert/strict';
import test from 'node:test';
import { parseXStatusUrl, resolveXPost } from './x-source.mjs';

test('accepts public X status links and canonicalizes tracking URLs', () => {
  assert.deepEqual(parseXStatusUrl('https://twitter.com/person/status/123?s=20'), {
    id: '123', source_url: 'https://x.com/i/status/123'
  });
  assert.equal(parseXStatusUrl('https://x.com/i/status/456').id, '456');
  for (const value of ['https://x.com/person', 'http://x.com/a/status/1', 'https://x.com.evil.test/a/status/1', 'https://x.com/a/status/no']) {
    assert.throws(() => parseXStatusUrl(value));
  }
});

test('resolves source text, quote context, author, and trusted media', async () => {
  const record = await resolveXPost('https://x.com/source/status/123', async url => {
    assert.match(url, /^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result\?id=123/);
    return { ok: true, json: async () => ({
      id_str: '123', text: 'Adding context', created_at: '2026-09-22T12:00:00Z',
      favorite_count: 4, views: { count: null }, user: { screen_name: 'source', name: 'Source Account', profile_image_url_https: 'https://pbs.twimg.com/profile_images/1/avatar.jpg', followers_count: null },
      quoted_tweet: { text: 'Original claim', user: { screen_name: 'other' } },
      mediaDetails: [
        { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/photo.jpg', ext_alt_text: 'A photo' },
        { type: 'photo', media_url_https: 'https://evil.test/photo.jpg' }
      ]
    }) };
  });
  assert.equal(record.source_url, 'https://x.com/i/status/123');
  assert.equal(record.source_author, '@source');
  assert.equal(record.body, 'Adding context\n\nQuoted post by @other: Original claim');
  assert.equal(record.source_likes, 4);
  assert.equal(record.source_views, null);
  assert.equal(record.profile_followers, null);
  assert.deepEqual(record.media, [{ kind: 'image', src: 'https://pbs.twimg.com/media/photo.jpg', alt: 'A photo' }]);
  assert.equal(record.profile_image_url, 'https://pbs.twimg.com/profile_images/1/avatar.jpg');
});
