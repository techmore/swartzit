import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { archivedXMedia } from './archive-source.mjs';
import { GET } from '../routes/archived-media/+server.js';

test('only trusted X media is routed to the archive', () => {
  assert.match(archivedXMedia('https://pbs.twimg.com/media/a.jpg'), /^\/archived-media\?/);
  assert.equal(archivedXMedia('https://evil.example/x'), 'https://evil.example/x');
  assert.equal(archivedXMedia('https://pbs.twimg.com@evil.example/x'), 'https://pbs.twimg.com@evil.example/x');
});
test('serves stored bytes and video ranges, with a safe fallback before archival', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'swartzit-archive-')); process.env.SWARTZIT_ARCHIVE_ROOT = root;
  try {
    await mkdir(path.join(root, 'index')); await mkdir(path.join(root, 'objects'));
    const src = 'https://video.twimg.com/media/test.mp4'; const uri = new URL(`https://swartzit.test/archived-media?src=${encodeURIComponent(src)}`);
    const request = new Request(uri); let result = await GET({url:uri,request});
    assert.equal(result.status,302); assert.equal(result.headers.get('location'),src);
    const data = Buffer.from('0123456789'); const digest = createHash('sha256').update(data).digest('hex'); const key = createHash('sha256').update(src).digest('hex');
    await writeFile(path.join(root,'objects',digest),data); await writeFile(path.join(root,'index',key+'.json'),JSON.stringify({sha256:digest,size:data.length,mime:'video/mp4'}));
    result = await GET({url:uri,request:new Request(uri,{headers:{range:'bytes=2-5'}})});
    assert.equal(result.status,206); assert.equal(result.headers.get('content-range'),'bytes 2-5/10'); assert.equal(await result.text(),'2345');
    result = await GET({url:uri,request:new Request(uri,{headers:{range:'bytes=-3'}})}); assert.equal(await result.text(),'789');
    result = await GET({url:uri,request:new Request(uri,{headers:{range:'bytes=50-60'}})}); assert.equal(result.status,416);
    const unsafe = new URL('https://swartzit.test/archived-media?src=https%3A%2F%2Fevil.example%2Fx'); assert.equal((await GET({url:unsafe,request:new Request(unsafe)})).status,404);
  } finally { delete process.env.SWARTZIT_ARCHIVE_ROOT; await rm(root,{recursive:true,force:true}); }
});
