import test from 'node:test';
import assert from 'node:assert/strict';
import {BROWSER_DEMO_ACCOUNTS, BROWSER_DEMO_DEFAULTS, browserDemoOptions, collectFromEgoSession} from './x-ego-session-runner.mjs';

test('browser demo uses the two fixed accounts and bounded pacing', () => {
  assert.deepEqual(BROWSER_DEMO_ACCOUNTS, ['beautyshowcase', 'Rawpkw']);
  assert.deepEqual(browserDemoOptions(), {
    accounts: ['beautyshowcase', 'Rawpkw'],
    hours: 168,
    limit: 8,
    perSource: 20,
    delayMs: 2000
  });
  assert.equal(BROWSER_DEMO_DEFAULTS.delayMs, 2000);
});

test('browser demo rejects unsafe bounds', () => {
  assert.throws(() => browserDemoOptions({delayMs: 500}), /delay/);
  assert.throws(() => browserDemoOptions({hours: 169}), /hours/);
  assert.throws(() => browserDemoOptions({limit: 9}), /limit/);
});

test('browser demo accepts a bounded JSON receipt from the session bridge', async () => {
  const posts = await collectFromEgoSession({limit: 1}, {
    spaceId: 35,
    cli: 'ego-browser',
    resolve: async sourceUrl => ({provider: 'x', source_url: sourceUrl, media: [{kind: 'video', src: 'https://video.twimg.com/demo.mp4'}]}),
    run: async (script, cli) => {
      assert.equal(cli, 'ego-browser');
      assert.match(script, /beautyshowcase/);
      assert.match(script, /Rawpkw/);
      return {posts: [{provider: 'x', source_url: 'https://x.com/beautyshowcase/status/1'}]};
    }
  });
  assert.deepEqual(posts, [{
    provider: 'x',
    source_url: 'https://x.com/beautyshowcase/status/1',
    media: [{kind: 'video', src: 'https://video.twimg.com/demo.mp4'}],
    content_rating: 'general',
    attribution: 'Collected from a dedicated read-only Ego Lite X session; source: https://x.com/beautyshowcase/status/1'
  }]);
});
