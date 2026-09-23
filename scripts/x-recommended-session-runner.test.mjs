import test from 'node:test';
import assert from 'node:assert/strict';
import {RECOMMENDED_DEFAULTS, browserScript, canonicalStatusUrl, collectFromRecommendedSession, recommendedOptions, recommendedStatePath} from './x-recommended-session-runner.mjs';

test('recommended runner defaults to one bounded candidate scan', () => {
  assert.deepEqual(recommendedOptions(), RECOMMENDED_DEFAULTS);
  assert.equal(canonicalStatusUrl('https://twitter.com/example/status/123?s=20'), 'https://x.com/i/status/123');
  assert.equal(canonicalStatusUrl('https://x.com/example'), null);
  assert.match(browserScript(recommendedOptions(), 41, ['https://x.com/i/status/9']), /https:\/\/x\.com\/home/);
  assert.match(browserScript(recommendedOptions(), 41, []), /window\.scrollBy/);
  assert.match(browserScript(recommendedOptions(), 41, []), /For You/);
});

test('recommended runner resolves and remembers one unseen status', async () => {
  const saved = [];
  const posts = await collectFromRecommendedSession({}, {
    spaceId: 41,
    statePath: '/tmp/swz-recommended-test.json',
    load: async () => ['https://x.com/i/status/1'],
    save: async (_path, urls, limit) => saved.push({urls, limit}),
    run: async () => ({source_urls: ['https://x.com/i/status/1', 'https://twitter.com/example/status/2']}),
    resolve: async sourceUrl => ({source_url: sourceUrl, title: 'One', body: 'A public post'})
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].source_url, 'https://x.com/i/status/2');
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].urls, ['https://x.com/i/status/1', 'https://x.com/i/status/2']);
  assert.equal(saved[0].limit, RECOMMENDED_DEFAULTS.seenLimit);
});

test('recommended runner does not persist dry-run selections', async () => {
  let saved = false;
  const posts = await collectFromRecommendedSession({}, {
    spaceId: 41,
    statePath: recommendedStatePath({runnerName: 'test-runner', cwd: '/tmp'}),
    dryRun: true,
    load: async () => [],
    save: async () => { saved = true; },
    run: async () => ({source_urls: ['https://x.com/i/status/3']}),
    resolve: async sourceUrl => ({source_url: sourceUrl})
  });
  assert.equal(posts.length, 1);
  assert.equal(saved, false);
});
