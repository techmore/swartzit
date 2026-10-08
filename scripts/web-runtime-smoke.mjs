import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('../apps/web/', import.meta.url));
const communities = [{ slug: 'general', name: 'Runtime endpoint fixture', description: 'Smoke fixture', post_count: 0 }];
const fixture = createServer((request, response) => {
  const path = new URL(request.url, 'http://fixture').pathname;
  const body = path === '/api/communities' ? communities
    : path === '/api/posts' ? { posts: [], has_more: false }
    : path === '/api/adsense/config' ? { enabled: false } : {};
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
});
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
await listen(fixture);
const reservation = createServer();
await listen(reservation);
const webPort = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const child = spawn(process.execPath, ['build/index.js'], {
  cwd: webRoot,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(webPort), API_URL: `http://127.0.0.1:${fixture.address().port}` },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', data => output += data);
child.stderr.on('data', data => output += data);
const origin = `http://127.0.0.1:${webPort}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${origin}/api/communities`, { signal: AbortSignal.timeout(1000) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), communities);
      ready = true;
      break;
    } catch {
      if (child.exitCode !== null) throw new Error(`Web process exited: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  assert.ok(ready, `Built app did not use runtime API_URL: ${output}`);
  for (const path of ['/', '/communities', '/login', '/about']) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, `${path} failed SSR`);
    assert.match(await response.text(), /swartzit/i);
  }
  console.log('Built web app honors runtime API_URL; public pages render successfully.');
} finally {
  child.kill('SIGTERM');
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
}
