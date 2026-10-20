import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { currentUser, loadCurrentUser, readSessionToken, resetCurrentUser } from './session-store.js';

const storageWith = token => ({ getItem: key => (key === 'swartzit_session' ? token : null) });

test.beforeEach(() => resetCurrentUser());

test('without a token the store settles to signed out without calling the API', async () => {
  let calls = 0;
  const user = await loadCurrentUser({ fetch: async () => { calls += 1; }, storage: storageWith(null) });
  assert.equal(user, null);
  assert.equal(get(currentUser), null);
  assert.equal(calls, 0);
});

test('a valid token loads the account once and shares it between callers', async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.equal(url, '/api/me');
    assert.equal(init.headers.authorization, 'Bearer abc');
    return { ok: true, async json() { return { handle: 'person', is_admin: false }; } };
  };
  const [first, second] = await Promise.all([
    loadCurrentUser({ fetch: fetchImpl, storage: storageWith('abc') }),
    loadCurrentUser({ fetch: fetchImpl, storage: storageWith('abc') })
  ]);
  assert.deepEqual(first, { handle: 'person', is_admin: false });
  assert.equal(second, first);
  assert.equal(calls, 1);
  assert.deepEqual(get(currentUser), { handle: 'person', is_admin: false });
});

test('rejected or unreachable sessions read as signed out', async () => {
  assert.equal(await loadCurrentUser({ fetch: async () => ({ ok: false, status: 401, async json() { return { error: 'Authentication required' }; } }), storage: storageWith('stale') }), null);
  resetCurrentUser();
  assert.equal(await loadCurrentUser({ fetch: async () => { throw new TypeError('Failed to fetch'); }, storage: storageWith('abc') }), null);
  assert.equal(get(currentUser), null);
});

test('reading the token tolerates blocked storage', () => {
  assert.equal(readSessionToken({ getItem() { throw new Error('SecurityError'); } }), '');
  assert.equal(readSessionToken(undefined), '');
  assert.equal(readSessionToken(storageWith('abc')), 'abc');
});
