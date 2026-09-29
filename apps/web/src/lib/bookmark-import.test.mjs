import assert from 'node:assert/strict';
import test from 'node:test';
import { createBookmarkRequest, runXBookmarkImport } from './bookmark-import.mjs';
const plan = { bookmarks: [{ id: '123', folderPath: ['Research'] }, { id: '456', folderPath: [] }], folderPaths: [['Research']] };

test('checks account before writes and rejects mismatches', async () => {
  const calls = [];
  await assert.rejects(runXBookmarkImport({ plan, expectedHandle: 'techmore', request: async path => { calls.push(path); return { handle: 'other' }; } }), /Expected u\/techmore/);
  assert.deepEqual(calls, ['/api/me']);
});
test('reuses folders and copies, records receipts only after saves', async () => {
  const calls = [], saved = [];
  const result = await runXBookmarkImport({ plan, expectedHandle: 'techmore', onSaved: async (...args) => saved.push(args), request: async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === '/api/me') return { handle: 'techmore' };
    if (path.endsWith('/import-path')) return { id: 4 };
    if (path.endsWith('/import-x')) return body.source_url.endsWith('/123') ? { found: true, id: 1, status: 'approved' } : { found: false };
    if (path === '/api/cross-post') return { id: 2, status: 'pending' };
    return null;
  } });
  assert.equal(result.saved, 2); assert.equal(result.pending, 1); assert.equal(result.failed, 0);
  assert.equal(calls.filter(c => c.path === '/api/cross-post').length, 1);
  assert.deepEqual(saved.map(([item, entry]) => [item.id, entry.folderId]).sort(), [['123', 4], ['456', null]]);
  assert.ok(calls.some(c => c.path === '/api/posts/2/bookmark'));
});
test('failed writes are retained for retry without reporting a saved bookmark', async () => {
  const result = await runXBookmarkImport({ plan, expectedHandle: 'techmore', request: async path => {
    if (path === '/api/me') return { handle: 'techmore' };
    if (path.endsWith('/import-path')) return { id: 4 };
    throw new Error('Unavailable source');
  } });
  assert.equal(result.saved, 0); assert.equal(result.failed, 2); assert.equal(result.completed, 2);
  assert.deepEqual(result.failures[0].folderPath, ['Research']);
});
test('HTTP throttles are retried with bounded delays, authentication errors are not', async () => {
  let count = 0; const delays = [];
  const request = createBookmarkRequest({ token: 'a'.repeat(64), sleep: async ms => delays.push(ms), fetcher: async () => {
    count++; return { ok: count === 3, status: count === 3 ? 200 : 429, headers: { get: () => '90' }, json: async () => ({ handle: 'techmore' }) };
  } });
  assert.equal((await request('/api/me')).handle, 'techmore'); assert.deepEqual(delays, [30000, 30000]);
  let attempts = 0;
  const denied = createBookmarkRequest({ token: 'a'.repeat(64), fetcher: async () => { attempts++; return { ok: false, status: 401, json: async () => ({ error: 'Sign in' }) }; } });
  await assert.rejects(denied('/api/me'), /Sign in/); assert.equal(attempts, 1);
});
test('aborted runs wait for all workers before returning', async () => {
  const controller = new AbortController(); let settled = 0;
  await assert.rejects(runXBookmarkImport({ plan, expectedHandle: 'techmore', signal: controller.signal, request: async path => {
    if (path === '/api/me') return { handle: 'techmore' };
    if (path.endsWith('/import-path')) return { id: 4 };
    await Promise.resolve(); controller.abort(); await Promise.resolve(); settled++; throw controller.signal.reason;
  } }), /abort/i);
  assert.equal(settled, 2);
});
