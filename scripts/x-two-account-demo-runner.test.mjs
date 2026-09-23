import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDemoOptions, DEMO_ACCOUNTS, DEMO_DEFAULTS, labelDemoPosts} from './x-two-account-demo-runner.mjs';

test('locks the demo to the two requested X accounts and a bounded recent window', () => {
  assert.deepEqual(DEMO_ACCOUNTS, ['beautyshowcase', 'Rawpkw']);
  assert.deepEqual(buildDemoOptions(), {
    accounts: ['beautyshowcase', 'Rawpkw'],
    hours: DEMO_DEFAULTS.hours,
    limit: 8,
    perSource: 50
  });
  assert.equal(DEMO_DEFAULTS.hours, 168);
});

test('labels collected posts as X content with an explicit default rating', () => {
  const [post] = labelDemoPosts([{title: 'Demo', provider: 'other', attribution: ''}]);
  assert.equal(post.provider, 'x');
  assert.equal(post.content_rating, 'general');
  assert.match(post.attribution, /two-account X labeling demo/);
});
