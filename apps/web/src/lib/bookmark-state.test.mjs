import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * The coalescing under test: several posts render at once, so their status
 * checks share one request. Node has `queueMicrotask` already, which is all
 * the module needs beyond `fetch`.
 */
function installBrowserStubs() {
  const calls = [];
  let nextResponse = () => ({ ok: true, status: 200, json: async () => ({}) });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return nextResponse();
  };
  return {
    calls,
    respondWith(fn) {
      nextResponse = fn;
    }
  };
}

test('a signed-in viewer resolving several posts gets every status, not a crash', async () => {
  const browser = installBrowserStubs();
  const token = 'token-abc';
  browser.respondWith(() => ({
    ok: true,
    status: 200,
    json: async () => ({ items: { 1: { saved: true, folder_id: 2 }, 2: { saved: false, folder_id: null } } })
  }));

  // Import the real module against the stubs.
  const { getBookmarkStatus } = await import('./bookmark-state.js');

  // Several posts render at once, which is exactly the coalescing path.
  const results = await Promise.all([
    getBookmarkStatus(token, 1),
    getBookmarkStatus(token, 2),
    getBookmarkStatus(token, 1)
  ]);

  // One batched request, not one per post.
  assert.equal(browser.calls.length, 1, 'the status checks should coalesce into one request');
  assert.match(browser.calls[0].url, /post_ids=1%2C2/);

  // Each caller receives its own answer, and a repeat request is served from
  // the cache rather than rejecting.
  assert.deepEqual(results[0], { saved: true, folder_id: 2 });
  assert.deepEqual(results[1], { saved: false, folder_id: null });
  assert.deepEqual(results[2], { saved: true, folder_id: 2 });
});

test('a post with no bookmark is reported as unsaved rather than omitted', async () => {
  const browser = installBrowserStubs();
  browser.respondWith(() => ({ ok: true, status: 200, json: async () => ({ items: {} }) }));
  const { getBookmarkStatus } = await import('./bookmark-state.js');

  const status = await getBookmarkStatus('token-def', 99);
  assert.deepEqual(status, { saved: false, folder_id: null });
});

test('a failing request rejects with the server message, not an internal error', async () => {
  const browser = installBrowserStubs();
  browser.respondWith(() => ({
    ok: false,
    status: 401,
    json: async () => ({ error: 'Authentication required' })
  }));
  const { getBookmarkStatus } = await import('./bookmark-state.js');

  // BookmarkButton treats this exact message as "session expired" and clears
  // the stored token, so a mangled error here would strand the viewer.
  await assert.rejects(
    () => getBookmarkStatus('token-ghi', 7),
    error => {
      assert.equal(error.message, 'Authentication required');
      return true;
    }
  );
});
