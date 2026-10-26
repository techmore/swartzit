import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {captureBookmarks} from './capture-x-bookmarks.mjs';

test('captures response bodies privately and requires an explicit termination marker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'x-bookmarks-'));
  try {
    for (const terminated of [false, true]) {
      let listener, closed = false;
      const payload = {data: {bookmark_timeline_v2: {timeline: {instructions: terminated
        ? [{type: 'TimelineTerminateTimeline', direction: 'Bottom'}] : [{entries: []}]}}}};
      const response = {url: () => 'https://x.com/i/api/graphql/id/Bookmarks?variables=private', ok: () => true, json: async () => payload};
      const page = {on: (_event, callback) => { listener = callback; }, goto: async () => listener(response),
        waitForTimeout: async () => {}, mouse: {wheel: async () => {}}};
      const directory = join(root, String(terminated));
      const receipt = await captureBookmarks({directory, maxScrolls: 1, launch: async () => ({
        newPage: async () => page, close: async () => { closed = true; }
      })});
      assert.equal(receipt.terminated, terminated);
      assert.equal(receipt.pages, 1);
      assert.equal(closed, true);
      const file = join(directory, 'bookmarks-000001.json');
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), payload);
      assert.equal((await stat(file)).mode & 0o077, 0);
      await assert.rejects(captureBookmarks({directory}), /EEXIST/);
    }
  } finally { await rm(root, {recursive: true, force: true}); }
});
