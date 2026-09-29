import assert from 'node:assert/strict';
import test from 'node:test';
import { readXBookmarkCapture } from './x-bookmark-capture.mjs';
const at = '2026-09-29T20:00:00Z';
const tweet = () => ({ rest_id: '2105001803142074742', legacy: { id_str: '2105001803142074742', full_text: 'Preview', possibly_sensitive: true, created_at: at, extended_entities: { media: [{ type: 'video', media_url_https: 'https://pbs.twimg.com/media/test.jpg', video_info: { variants: [{ content_type: 'video/mp4', bitrate: 10, url: 'https://video.twimg.com/a.mp4' }, { content_type: 'video/mp4', bitrate: 20, url: 'https://evil.test/a.mp4' }] } }] } }, core: { user_results: { result: { core: { screen_name: 'source', name: 'Source' }, privacy: { protected: false } } } }, note_tweet: { note_tweet_results: { result: { text: 'The complete long post', entity_set: {} } } } });
const wrap = t => ({ data: { bookmark_timeline_v2: { timeline: { instructions: [{ entries: [{ entryId: 'tweet-2105001803142074742', content: { itemContent: { tweet_results: { result: t } } } }, { content: { cursorType: 'Bottom', value: 'next' } }] }] } } } });
test('preserves exact IDs, long text, trusted MP4s and sensitive ratings', () => {
  const r = readXBookmarkCapture(wrap(tweet()), { observedAt: at });
  assert.equal(r.posts.length, 1); assert.equal(r.posts[0].body, 'The complete long post');
  assert.equal(r.posts[0].content_rating, 'x'); assert.equal(r.posts[0].media[0].src, 'https://video.twimg.com/a.mp4');
  assert.equal(r.bottomCursor, 'next'); assert.equal(r.unavailable.length, 0);
});
test('protected, missing long text, mismatched IDs and unavailable posts are reported, not published', () => {
  for (const mutate of [t => t.core.user_results.result.privacy.protected = true, t => t.note_tweet = {}, t => t.rest_id = '999', t => delete t.legacy]) {
    const t = tweet(); mutate(t); const r = readXBookmarkCapture(wrap(t), { observedAt: at });
    assert.equal(r.posts.length, 0); assert.equal(r.unavailable.length, 1);
  }
});
test('requires explicit capture timestamps and the bookmark timeline structure', () => {
  assert.throws(() => readXBookmarkCapture(wrap(tweet())), /timestamp/);
  assert.throws(() => readXBookmarkCapture({}, { observedAt: at }), /timeline/);
});
