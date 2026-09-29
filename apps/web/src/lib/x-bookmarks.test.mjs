import assert from 'node:assert/strict';
import test from 'node:test';
import { parseXBookmarkExport } from './x-bookmarks.mjs';

test('reads tweet IDs from an X archive bookmarks.js assignment and removes duplicates', () => {
  const archive = `window.YTD.bookmarks.part0 = [
    {"bookmark":{"tweetId":"123"}},
    {"bookmark":{"tweetId":"456"}},
    {"bookmark":{"tweetId":"123"}}
  ];`;
  assert.deepEqual(parseXBookmarkExport(archive), ['123', '456']);
});

test('reads JSON bookmark files and common tweet ID keys', () => {
  assert.deepEqual(parseXBookmarkExport(JSON.stringify({
    bookmarks: [{ tweet_id: '789' }, { statusId: 321 }]
  })), ['789', '321']);
});

test('preserves exact X IDs when a JSON export writes them as numbers', () => {
  assert.deepEqual(
    parseXBookmarkExport('{"tweetId":2104618999141061018}'),
    ['2104618999141061018']
  );
});

test('rejects non-bookmark, malformed, and empty files', () => {
  assert.throws(() => parseXBookmarkExport('window.YTD.likes.part0 = [];'), /bookmarks file/);
  assert.throws(() => parseXBookmarkExport('{'), /Could not read/);
  assert.throws(() => parseXBookmarkExport('[]'), /No X post IDs/);
});
