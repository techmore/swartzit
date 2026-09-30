import test from 'node:test';
import assert from 'node:assert/strict';
import { requestNativeShare } from './share-action.mjs';

test('native share calls the operating-system share target chooser with the supplied data', async () => {
  const expected = { title: 'Swartzit', text: 'Join the discussion', url: 'https://stoverparc.org/post/abc' };
  let received;
  const navigatorObject = { share(data) { received = data; return Promise.resolve(); } };

  const pending = requestNativeShare(navigatorObject, expected);
  assert.equal(received, expected, 'the chooser is invoked synchronously within the click handler call');
  assert.equal(await pending, 'shared');
});

test('native share reports unsupported browsers for the clipboard fallback', async () => {
  assert.equal(await requestNativeShare({}, { url: 'https://stoverparc.org/post/abc' }), 'unavailable');
});

test('native share distinguishes a user dismissing the chooser from an error', async () => {
  const cancelled = new Error('dismissed');
  cancelled.name = 'AbortError';
  assert.equal(await requestNativeShare({ share: () => Promise.reject(cancelled) }, {}), 'cancelled');
  assert.equal(await requestNativeShare({ share: () => Promise.reject(new Error('failed')) }, {}), 'failed');
});
