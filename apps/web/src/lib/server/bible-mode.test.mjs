import test from 'node:test';
import assert from 'node:assert/strict';
import { bibleMode, parseBibleConfig, resetBibleModeCache } from './bible-mode.mjs';

test('only an explicit enabled flag turns the mode on', () => {
  assert.equal(parseBibleConfig(null).enabled, false);
  assert.equal(parseBibleConfig({ enabled: 'true' }).enabled, false);
  assert.deepEqual(parseBibleConfig({ enabled: true, communities: ['sermons', 'Bad Slug', 3] }).communities, ['sermons']);
});

test('the mode is cached and survives an API outage', async () => {
  resetBibleModeCache();
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, json: async () => ({ enabled: true, communities: ['scripture'] }) }; };
  assert.equal((await bibleMode(ok)).enabled, true);
  assert.equal((await bibleMode(ok)).enabled, true);
  assert.equal(calls, 1);
  const down = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal((await bibleMode(down, Date.now() + 60_000)).enabled, true);
});
