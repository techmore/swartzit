import test from 'node:test';
import assert from 'node:assert/strict';
import { bibleMode, parseBibleConfig, resetBibleModeCache, viewerMode, safeNext } from './bible-mode.mjs';

test('only an explicit enabled flag makes the mode available', () => {
  assert.equal(parseBibleConfig(null).available, false);
  assert.equal(parseBibleConfig({ enabled: 'true' }).available, false);
  assert.deepEqual(parseBibleConfig({ enabled: true, communities: ['sermons', 'Bad Slug', 3] }).communities, ['sermons']);
});

test('the mode is cached and survives an API outage', async () => {
  resetBibleModeCache();
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, json: async () => ({ enabled: true, communities: ['scripture'] }) }; };
  assert.equal((await bibleMode(ok)).available, true);
  assert.equal((await bibleMode(ok)).available, true);
  assert.equal(calls, 1);
  const down = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal((await bibleMode(down, Date.now() + 60_000)).available, true);
});

test('each visitor picks a mode; the instance sets the starting mode', () => {
  const startBible = parseBibleConfig({ enabled: true, default_mode: 'bible', communities: ['scripture'] });
  const startStandard = parseBibleConfig({ enabled: true, default_mode: 'standard', communities: ['scripture'] });
  assert.equal(viewerMode(startBible, undefined).enabled, true);
  assert.equal(viewerMode(startBible, 'standard').enabled, false);
  assert.equal(viewerMode(startStandard, undefined).enabled, false);
  assert.equal(viewerMode(startStandard, 'bible').enabled, true);
  assert.equal(viewerMode(startStandard, 'nonsense').mode, 'standard');
  // Older servers send no default: everyone started in Bible mode.
  assert.equal(parseBibleConfig({ enabled: true }).defaultMode, 'bible');
  // When the admin turns the mode off, a saved choice is ignored.
  const off = viewerMode(parseBibleConfig({ enabled: false }), 'bible');
  assert.equal(off.enabled, false);
  assert.equal(off.available, false);
});

test('the mode switch only redirects within the site', () => {
  assert.equal(safeNext('/bible/titus?x=1'), '/bible/titus?x=1');
  assert.equal(safeNext('//evil.example'), '/');
  assert.equal(safeNext('/\\evil.example'), '/');
  assert.equal(safeNext('https://evil.example'), '/');
  assert.equal(safeNext(undefined), '/');
});
