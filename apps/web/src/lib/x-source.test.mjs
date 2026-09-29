import assert from 'node:assert/strict';
import test from 'node:test';
import { parseXStatusUrl, resolveXPost, resolveXConversation } from './x-source.mjs';

test('accepts public X status links and canonicalizes tracking URLs', () => {
  assert.deepEqual(parseXStatusUrl('https://twitter.com/person/status/123?s=20'), {
    id: '123', source_url: 'https://x.com/i/status/123'
  });
  assert.equal(parseXStatusUrl('https://x.com/i/status/456').id, '456');
  assert.deepEqual(parseXStatusUrl('https://x.com/FloridaManAF/status/2104618999141061018/video/1?s=46'), {
    id: '2104618999141061018', source_url: 'https://x.com/i/status/2104618999141061018'
  });
  assert.equal(parseXStatusUrl('https://twitter.com/person/status/123/photo/2').id, '123');
  for (const value of [
    'https://x.com/person',
    'http://x.com/a/status/1',
    'https://x.com.evil.test/a/status/1',
    'https://x.com/a/status/no',
    'https://x.com/a/status/123/audio/1',
    'https://x.com/a/status/123/video/no'
  ]) {
    assert.throws(() => parseXStatusUrl(value));
  }
});

test('resolves source text, quote context, author, and trusted media', async () => {
  const record = await resolveXPost('https://x.com/source/status/123', async url => {
    assert.match(url.toString(), /^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result\?id=123/);
    assert.match(url.toString(), /token=/);
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

test('falls back when syndication tombstones a public media-only post', async () => {
  const id = '2104554970578145776';
  const calls = [];
  const record = await resolveXPost(`https://x.com/RAWigger/status/${id}?s=20`, async url => {
    calls.push(url.toString());
    if (calls.length === 1) {
      return { ok: true, json: async () => ({ __typename: 'TweetTombstone', tombstone: {} }) };
    }
    assert.equal(url.toString(), `https://api.fxtwitter.com/i/status/${id}`);
    return { ok: true, json: async () => ({
      code: 200,
      tweet: {
        id,
        text: '',
        created_at: 'Mon Sep 28 12:53:00 +0000 2026',
        likes: 408,
        reposts: 21,
        replies: 3,
        views: 2960,
        author: {
          screen_name: 'RAWigger', name: 'Real Ass Wigger',
          avatar_url: 'https://pbs.twimg.com/profile_images/123/avatar.jpg',
          followers: 85764, following: 128,
          verification: { verified: true }
        },
        media: {
          photos: [
            { type: 'photo', url: 'https://pbs.twimg.com/media/photo.jpg?name=orig', altText: 'A photo' },
            { type: 'photo', url: 'https://evil.test/photo.jpg' }
          ]
        }
      }
    }) };
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0], /token=53nnk5awdj4/);
  assert.equal(record.source_url, `https://x.com/i/status/${id}`);
  assert.equal(record.source_author, '@RAWigger');
  assert.equal(record.body, '');
  assert.equal(record.source_likes, 408);
  assert.equal(record.source_views, 2960);
  assert.equal(record.profile_followers, 85764);
  assert.equal(record.profile_verified, true);
  assert.deepEqual(record.media, [{ kind: 'image', src: 'https://pbs.twimg.com/media/photo.jpg?name=orig', alt: 'A photo' }]);
});

test('rejects an X fallback response for a different post ID', async () => {
  let callCount = 0;
  await assert.rejects(resolveXPost('https://x.com/source/status/123', async () => {
    callCount += 1;
    return callCount === 1
      ? { ok: true, json: async () => ({ __typename: 'TweetTombstone' }) }
      : { ok: true, json: async () => ({ code: 200, tweet: { id: '456' } }) };
  }), /X could not load that post/);
});

test('attributes an X repost to the original author', async () => {
  const record = await resolveXPost('https://x.com/reposter/status/987', async () => ({
    ok: true,
    json: async () => ({
      id_str: '987',
      text: 'Reposted',
      created_at: '2026-09-28T12:00:00Z',
      user: { screen_name: 'reposter', name: 'Reposter' },
      retweeted_status: {
        id_str: '123',
        text: 'The original post',
        created_at: '2026-09-27T12:00:00Z',
        favorite_count: 5,
        user: { screen_name: 'original_author', name: 'Original Author' }
      }
    })
  }));

  assert.equal(record.source_url, 'https://x.com/i/status/987');
  assert.equal(record.source_author, '@original_author');
  assert.equal(record.title, 'Post by @original_author');
  assert.equal(record.body, 'The original post');
  assert.equal(record.source_likes, 5);
  assert.equal(record.published_at, '2026-09-27T12:00:00.000Z');
});

test('retains expanded long text and complete parent and nested quote context', async () => {
  const record = await resolveXConversation({ id_str: '3', text: 'Preview', note_tweet: { note_tweet_results: { result: { text: 'Full long post' } } }, user: { screen_name: 'child' }, in_reply_to_status_id_str: '2', quoted_tweet: { id_str: '2', text: 'Parent', user: { screen_name: 'parent' } } }, async url => {
    assert.match(String(url), /id=2/);
    return { ok: true, json: async () => ({ id_str: '2', text: 'Parent', user: { screen_name: 'parent' }, in_reply_to_status_id_str: '1', parent: { id_str: '1', full_text: 'First post', user: { screen_name: 'first' } } }) };
  });
  assert.match(record.body, /^Full long post/);
  assert.match(record.body, /Thread context by @first:\nFirst post/);
  assert.match(record.body, /Thread context by @parent:\nParent/);
  assert.match(record.body, /Quoted post by @parent: Parent/);
});

test('expands missing note text through the fallback and rejects unavailable full text', async () => {
  const t = { id_str: '3', text: 'Preview', note_tweet: {}, user: { screen_name: 'child' } };
  const r = await resolveXConversation(t, async () => ({ ok: true, json: async () => ({ code: 200, tweet: { id: '3', raw_text: { text: 'Complete original text' }, author: { screen_name: 'child' } } }) }));
  assert.equal(r.body, 'Complete original text');
  await assert.rejects(resolveXConversation(t, async () => ({ ok: false, status: 404 })), /full text is unavailable/);
});

test('uses one read for repeated quoted note IDs and rejects oversized UTF-8 context', async () => {
  let reads = 0;
  const quote = { id_str: '2', text: 'Preview', note_tweet: {}, user: { screen_name: 'quote' } };
  const parent = { id_str: '1', text: 'Parent', user: { screen_name: 'parent' }, quoted_tweet: quote };
  const r = await resolveXConversation({ id_str: '3', text: 'Post', user: { screen_name: 'child' }, parent, in_reply_to_status_id_str: '1', quoted_tweet: quote }, async () => { reads++; return { ok: true, json: async () => ({ code: 200, tweet: { id: '2', text: 'Full quote', author: { screen_name: 'quote' } } }) }; });
  assert.equal(reads, 1); assert.match(r.body, /Full quote/);
  await assert.rejects(resolveXConversation({ id_str: '3', full_text: '界'.repeat(85000) }), /size limit/);
});
