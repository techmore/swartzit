import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm, utimes} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('preparation recognizes the cursor-only final response and preserves source records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bookmark-preparation-'));
  try {
    const cursor = {content: {cursorType: 'Bottom', value: 'last'}};
    const item = {entryId: 'tweet-123', content: {itemContent: {tweet_results: {result: {
      rest_id: '123', legacy: {full_text: 'Complete source', possibly_sensitive: true},
      core: {user_results: {result: {core: {screen_name: 'source'}, privacy: {protected: false}}}}
    }}}}};
    const payload = entries => ({data: {bookmark_timeline_v2: {timeline: {instructions: [{type: 'TimelineAddEntries', entries}]}}}});
    for (const [index, entries] of [[1, [item, cursor]], [2, [cursor]]]) {
      const file = join(root, `bookmarks-${index}.json`);
      await writeFile(file, JSON.stringify(payload(entries)));
      await utimes(file, index, index);
    }
    const output = join(root, 'transfer.json');
    const result = spawnSync(process.execPath, [new URL('./prepare-bookmark-transfer.mjs', import.meta.url).pathname, '--capture-dir', root, '--output', output], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(manifest.capture.terminated, true);
    assert.equal(manifest.posts.length, 1);
    assert.equal(manifest.posts[0].content_rating, 'x');
    assert.deepEqual(manifest.bookmarks, [{tweetId: '123'}]);
  } finally { await rm(root, {recursive: true, force: true}); }
});
