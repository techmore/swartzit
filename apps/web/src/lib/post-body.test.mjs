import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePostBody } from './post-body.mjs';

test('extracts YouTube links from a normal post body for embedding', () => {
  assert.deepEqual(parsePostBody('Watch this: https://youtu.be/dQw4w9WgXcQ.'), {
    text: 'Watch this:',
    embeds: [{
      source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      embed_url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
    }]
  });
});

test('deduplicates YouTube embeds and leaves other links as text', () => {
  const result = parsePostBody('https://example.com https://www.youtube.com/watch?v=dQw4w9WgXcQ https://youtu.be/dQw4w9WgXcQ');
  assert.equal(result.text, 'https://example.com');
  assert.equal(result.embeds.length, 1);
});

test('does not embed channels, playlists, or non-YouTube URLs', () => {
  const result = parsePostBody('https://www.youtube.com/playlist?list=abc https://youtube.com/channel/abc https://evil.test/watch?v=dQw4w9WgXcQ');
  assert.equal(result.embeds.length, 0);
  assert.match(result.text, /playlist/);
  assert.match(result.text, /channel/);
  assert.match(result.text, /evil\.test/);
});
