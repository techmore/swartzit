import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOK_VIDEOS, videosForBook } from './readings-video.mjs';
import { findBook } from './books.mjs';
import { youtubeEmbedUrl } from '../youtube-source.mjs';

test('every filmed reading names a real book and an embeddable YouTube video', () => {
  for (const video of BOOK_VIDEOS) {
    assert.equal(findBook(video.book)?.slug, video.book);
    assert.ok(youtubeEmbedUrl(video.youtube), video.youtube);
  }
  assert.equal(videosForBook('john')[0].reader, 'Sir David Suchet');
  assert.deepEqual(videosForBook('titus'), []);
});
