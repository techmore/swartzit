import assert from 'node:assert/strict';
import test from 'node:test';
import { parseYouTubeUrl, resolveYouTubePost, youtubeEmbedUrl } from './youtube-source.mjs';

test('accepts supported YouTube video URLs and strips tracking parameters', () => {
  assert.deepEqual(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=42'), {
    id: 'dQw4w9WgXcQ',
    source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    embed_url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
  });
  assert.equal(parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share').id, 'dQw4w9WgXcQ');
  assert.equal(youtubeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  for (const value of [
    'https://www.youtube.com/channel/UC123',
    'https://www.youtube.com/playlist?list=abc',
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=too-short'
  ]) assert.throws(() => parseYouTubeUrl(value));
});

test('resolves optional oEmbed metadata without creating downloadable media', async () => {
  const record = await resolveYouTubePost('https://www.youtube.com/watch?v=dQw4w9WgXcQ', async url => {
    assert.match(url, /^https:\/\/www\.youtube\.com\/oembed\?/);
    return { ok: true, json: async () => ({ title: 'A video', author_name: 'A creator' }) };
  });
  assert.equal(record.provider, 'youtube');
  assert.equal(record.title, 'A video');
  assert.equal(record.source_author, 'YouTube');
  assert.equal(record.profile_display_name, 'A creator');
  assert.deepEqual(record.media, []);
  assert.equal(record.body, '');
});
