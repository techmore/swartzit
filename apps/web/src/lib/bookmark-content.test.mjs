import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBookmarkContent} from './bookmark-content.mjs';

test('saved cards load actual content with bounded concurrency and retain per-post failures', async () => {
  let active = 0, peak = 0;
  const posts = {}, errors = {};
  await loadBookmarkContent(Array.from({length: 9}, (_, i) => ({post_id: i + 1, public_id: String(i + 1), moderation_status: 'approved'})), {
    concurrency: 3, request: async path => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      const id = Number(path.split('/').at(-1));
      if (id === 4) throw new Error('Temporary failure');
      return {post: {id, body: 'Saved text', source: {media: [{kind: 'image', src: 'https://pbs.twimg.com/media/example.jpg'}]}}};
    }, onPost: (id, post) => posts[id] = post, onError: (id, error) => errors[id] = error
  });
  assert.equal(peak, 3);
  assert.equal(Object.keys(posts).length, 8);
  assert.equal(posts[1].source.media.length, 1);
  assert.equal(errors[4], 'Temporary failure');
});

test('projected bookmark content avoids extra reads and pending records never use public detail reads', async () => {
  const posts = {};
  await loadBookmarkContent([{post_id: 1, body: 'Private pending text', moderation_status: 'pending'}, {post_id: 2, moderation_status: 'pending'}], {
    request: async () => { throw new Error('Unexpected public read'); },
    onPost: (id, post) => posts[id] = post, onError: () => assert.fail('Unexpected error')
  });
  assert.equal(posts[1].body, 'Private pending text');
  assert.equal(posts[2], undefined);
});
