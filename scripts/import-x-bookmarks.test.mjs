import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('CLI persists private receipts and resumes using batched saved-state checks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'swartzit-bookmark-cli-'));
  const calls = [], saved = new Map();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    calls.push([request.method, url.pathname]);
    let body = ''; for await (const chunk of request) body += chunk;
    const data = body ? JSON.parse(body) : {};
    response.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/me') return response.end(JSON.stringify({ handle: 'techmore' }));
    if (url.pathname === '/api/bookmarks/import-x') return response.end(JSON.stringify({ found: false }));
    if (url.pathname === '/api/posts/cross-post') {
      assert.equal(data.provider, 'x'); return response.end(JSON.stringify({ id: 7, status: 'pending' }));
    }
    if (url.pathname === '/api/posts/7/bookmark') { saved.set('7', data.folder_id); response.statusCode = 204; return response.end(); }
    if (url.pathname === '/api/bookmarks/status') {
      assert.equal(request.method, 'GET'); assert.equal(url.searchParams.get('post_ids'), '7');
      return response.end(JSON.stringify({ items: Object.fromEntries([...saved].map(([id, folder_id]) => [id, { saved: true, folder_id }])) }));
    }
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const manifest = join(directory, 'manifest.json'), token = join(directory, 'session'), receipt = join(directory, 'receipt.json');
    await writeFile(manifest, JSON.stringify({ format: 'swartzit-x-bookmarks-v1', bookmarks: [{ tweetId: '123' }], posts: [{ provider: 'x', source_url: 'https://x.com/i/status/123' }] }));
    await writeFile(token, 'a'.repeat(64), { mode: 0o600 });
    const args = ['scripts/import-x-bookmarks.mjs', '--file', manifest, '--account', 'techmore', '--base-url', `http://127.0.0.1:${server.address().port}`, '--session-file', token, '--receipt', receipt, '--apply'];
    const run = promisify(execFile);
    await run(process.execPath, args);
    const state = JSON.parse(await readFile(receipt, 'utf8'));
    assert.equal(state.saved['123'].postId, 7); assert.equal((await stat(receipt)).mode & 0o077, 0);
    await run(process.execPath, args);
    assert.equal(calls.filter(([, path]) => path === '/api/posts/cross-post').length, 1);
    assert.equal(calls.filter(([, path]) => path === '/api/bookmarks/status').length, 1);
    const before = calls.length;
    await assert.rejects(run(process.execPath, args.map(value => value === 'techmore' ? 'someone_else' : value)), /Expected u\/someone_else/);
    assert.deepEqual(calls.slice(before), [['GET', '/api/me']]);
  } finally {
    await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true });
  }
});
