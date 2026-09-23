import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRedditPostUrl, resolveRedditPost } from './reddit-source.mjs';

test('accepts direct Reddit post links and canonicalizes the JSON endpoint', () => {
  assert.deepEqual(parseRedditPostUrl('https://old.reddit.com/r/swartzit/comments/abc123/a-post/?utm_source=x'), {
    id: 'abc123',
    source_url: 'https://www.reddit.com/r/swartzit/comments/abc123/a-post',
    api_url: 'https://www.reddit.com/r/swartzit/comments/abc123.json?raw_json=1&limit=50'
  });
  assert.equal(parseRedditPostUrl('https://redd.it/xyz789').api_url, 'https://www.reddit.com/comments/xyz789.json?raw_json=1&limit=50');
  for (const value of ['https://reddit.com/r/swartzit', 'http://reddit.com/r/a/comments/abc/title', 'https://reddit.com/r/a/comments/no%20spaces/title']) {
    assert.throws(() => parseRedditPostUrl(value));
  }
});

test('resolves Reddit text, trusted media, metrics, and top comments', async () => {
  const record = await resolveRedditPost('https://reddit.com/r/photos/comments/abc123/a-photo', async url => {
    assert.equal(url, 'https://www.reddit.com/r/photos/comments/abc123.json?raw_json=1&limit=50');
    return {
      ok: true,
      json: async () => [
        { data: { children: [{ kind: 't3', data: {
          id: 'abc123', title: 'A photo', selftext: 'Some context', subreddit: 'photos', author: 'source',
          created_utc: 1780000000, score: 42, num_comments: 7,
          url_overridden_by_dest: 'https://i.redd.it/photo.jpg',
          preview: { images: [{ source: { url: 'https://preview.redd.it/photo.jpg?width=1200&amp;format=pjpg' } }] }
        } }] } },
        { data: { children: [{ kind: 't1', data: { author: 'commenter', body: 'Nice shot', score: 9, created_utc: 1780000010 } }, { kind: 't1', data: { author: 'bad', body: 'https://evil.test', score: 2 } }] } }
      ]
    };
  });
  assert.equal(record.source_url, 'https://www.reddit.com/r/photos/comments/abc123/a-photo');
  assert.equal(record.source_author, 'u/source');
  assert.equal(record.body, 'Some context');
  assert.equal(record.source_likes, 42);
  assert.deepEqual(record.media, [{ kind: 'image', src: 'https://i.redd.it/photo.jpg', alt: 'A photo' }]);
  assert.equal(record.source_comments.length, 2);
  assert.equal(record.source_comments[0].author, 'u/commenter');
});
