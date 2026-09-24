import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFromPlaywrightRecommended, playwrightHeadless, playwrightProfilePath, playwrightRecommendedOptions} from './x-playwright-recommended-runner.mjs';

test('Playwright runner uses the same bounded Recommended defaults', () => {
  const options = playwrightRecommendedOptions();
  assert.equal(options.candidateLimit, 20);
  assert.equal(options.scrolls, 5);
  assert.equal(options.delayMs, 900);
  assert.equal(options.seenLimit, 1000);
});

test('Playwright runner defaults to a worker-local persistent profile', () => {
  assert.equal(playwrightProfilePath({cwd: '/tmp/swartzit', env: {}}), '/tmp/swartzit/.local/x-playwright-profile');
  assert.equal(playwrightProfilePath({cwd: '/tmp/swartzit', env: {X_PLAYWRIGHT_USER_DATA_DIR: '~/x-profile'}}), `${process.env.HOME}/x-profile`);
});

test('Playwright runner is headless unless explicitly configured otherwise', () => {
  assert.equal(playwrightHeadless({env: {}}), true);
  assert.equal(playwrightHeadless({env: {X_PLAYWRIGHT_HEADLESS: '0'}}), false);
});

test('Playwright runner resolves and remembers one unseen status', async () => {
  const saved = [];
  const posts = await collectFromPlaywrightRecommended({}, {
    statePath: '/tmp/swz-playwright-test.json',
    load: async () => ['https://x.com/i/status/1'],
    save: async (_path, urls, limit) => saved.push({urls, limit}),
    run: async () => ({source_urls: ['https://x.com/i/status/1', 'https://twitter.com/example/status/2']}),
    resolve: async sourceUrl => ({source_url: sourceUrl, title: 'One', body: 'A public post'})
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].source_url, 'https://x.com/i/status/2');
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].urls, ['https://x.com/i/status/1', 'https://x.com/i/status/2']);
  assert.equal(saved[0].limit, 1000);
});
