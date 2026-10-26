import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('a collected crawler batch reaches the publisher as a file under worker-batches', async () => {
  const state = await mkdtemp(join(tmpdir(), 'swartzit-worker-'));
  let origin, completion, imported = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('content-type', 'application/json');
    const reply = value => res.end(JSON.stringify(value));
    if (req.url === '/api/sessions' && req.method === 'POST') return reply({token: 'test'});
    if (req.url === '/api/sessions' && req.method === 'DELETE') { res.statusCode = 204; return res.end(); }
    if (req.url === '/api/admin/crawler-jobs') return reply([{id: 1, enabled: true, provider: 'rss', source: `${origin}/feed`, community: 'general', max_items: 1}]);
    if (req.url === '/api/admin/crawler-jobs/1/claim') return reply({run_id: 2});
    if (req.url === '/api/admin/crawler-runs/2/complete') { completion = JSON.parse(body); return reply({}); }
    if (req.url === '/api/admin/settings') return reply({modules: {content_runners: {enabled: false}}});
    if (req.url === '/api/admin/imports') { imported++; return reply({id: 3, created: true}); }
    if (req.url.startsWith('/api/posts?')) return reply({posts: [], has_more: false});
    if (req.url === '/feed') return res.end('<rss><channel><item><title>One</title><link>https://example.test/post</link><description>A collected item</description></item></channel></rss>');
    res.statusCode = 404; return reply({error: req.url});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [new URL('./swartzit-worker.mjs', import.meta.url).pathname], {
        env: {...process.env, API_URL: origin, SCHEDULER_HANDLE: 'test', SCHEDULER_PASSWORD: 'test', SWARTZIT_WORKER_STATE_DIR: state},
        stdio: 'pipe'
      });
      let stderr = '';
      child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject);
      child.on('close', code => resolve({code, stderr}));
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(completion.status, 'success', JSON.stringify(completion));
    assert.equal(imported, 1);
    const files = await readdir(join(state, 'worker-batches'));
    assert.equal(files.length, 1);
    assert.equal(JSON.parse(await readFile(join(state, 'worker-batches', files[0]), 'utf8'))[0].title, 'One');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(state, {recursive: true, force: true});
  }
});
