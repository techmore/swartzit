import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanXSourceText, splitXPost } from './x-post-display.mjs';
test('keeps multiline primary text, parents and multiple nested quotes separate', () => {
  const r = splitXPost('Line one\nLine two\n\nThread context by @parent:\nEarlier post\n\nQuoted post by @first: First quote\n\nQuoted post by @second: Second quote');
  assert.equal(r.text, 'Line one\nLine two');
  assert.deepEqual(r.threadContexts.map(x => x.author), ['@parent']);
  assert.deepEqual(r.quotedPosts.map(x => x.text), ['First quote', 'Second quote']);
});
test('removes captured player chrome while preserving appended context', () => {
  const r = cleanXSourceText('Source\n@source\nReal post\nFrom\nPlayer title\n0:01 / 0:20\n42 likes\n\nQuoted post by @quote: Keep this quote', { profile_display_name: 'Source', source_author: '@source' });
  assert.equal(r, 'Real post\n\nQuoted post by @quote: Keep this quote');
});
test('supports context-only posts and leaves ordinary prose unchanged', () => {
  assert.equal(splitXPost('Quoted post by @quote: Full text').quotedPosts[0].text, 'Full text');
  assert.equal(splitXPost('Ordinary post').text, 'Ordinary post');
});
