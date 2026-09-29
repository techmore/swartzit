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

test('retains nested folders, empty folders and exact numeric X IDs', async () => {
  const { parseXBookmarkImport } = await import('./x-bookmarks.mjs');
  const result = parseXBookmarkImport('{"format":"swartzit-x-bookmarks-v1","folders":[{"name":"Research","folders":[{"name":"Linux","bookmarks":[{"tweetId":2104618999141061018}]},{"name":"Empty"}]}]}');
  assert.deepEqual(result.bookmarks, [{ id: '2104618999141061018', folderPath: ['Research', 'Linux'] }]);
  assert.deepEqual(result.folderPaths, [['Research'], ['Research', 'Linux'], ['Research', 'Empty']]);
});

test('combines archive parts without silently dropping conflicting folder assignments', async () => {
  const { parseXBookmarkImport, mergeXBookmarkImports } = await import('./x-bookmarks.mjs');
  const first = parseXBookmarkImport('{"tweetId":"123","folder_path":["Research","Linux"]}');
  const repeated = parseXBookmarkImport('{"tweetId":"123","folder_path":["research","linux"]}');
  assert.equal(mergeXBookmarkImports([first, repeated]).bookmarks.length, 1);
  const other = parseXBookmarkImport('{"tweetId":"123","folder_path":["Other"]}');
  assert.throws(() => mergeXBookmarkImports([first, other]), /different folders/);
});

test('rejects missing folder mappings, invalid paths, and over-deep folder trees', async () => {
  const { parseXBookmarkImport } = await import('./x-bookmarks.mjs');
  assert.throws(() => parseXBookmarkImport('{"tweetId":"123","folderId":"1"}'), /without folder paths/);
  assert.throws(() => parseXBookmarkImport('{"tweetId":"123","folder_path":"Research"}'), /arrays/);
  assert.throws(() => parseXBookmarkImport('{"tweetId":"123","folder_path":[" "]}'), /1–80/);
  assert.throws(() => parseXBookmarkImport(JSON.stringify({ tweetId: '123', folder_path: Array(13).fill('Deep') })), /12/);
});

test('a folder mapping supplements a flat X archive regardless of input file order', async () => {
  const { parseXBookmarkImport, mergeXBookmarkImports } = await import('./x-bookmarks.mjs');
  const flat = parseXBookmarkImport('{"tweetId":"123"}');
  const mapped = parseXBookmarkImport('{"tweetId":"123","folder_path":["Research"]}');
  for (const parts of [[flat, mapped], [mapped, flat]]) {
    assert.deepEqual(mergeXBookmarkImports(parts).bookmarks, [{ id: '123', folderPath: ['Research'] }]);
  }
});
