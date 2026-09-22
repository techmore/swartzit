import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('freshness, partial failure receipts, session cleanup and due guard',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'swartzit-sync-'));
  let imports=0,revoked=0;
  const server=createServer(async(req,res)=>{
    for await(const _ of req){}
    res.setHeader('content-type','application/json');
    if(req.url==='/api/sessions'&&req.method==='POST')return res.end(JSON.stringify({token:'test-token'}));
    if(req.url==='/api/sessions'&&req.method==='DELETE'){revoked++;res.statusCode=204;return res.end();}
    if(req.url==='/api/admin/imports'){imports++;res.statusCode=imports%2===0?500:200;return res.end(JSON.stringify({created:true,id:imports}));}
    res.statusCode=404;res.end('{}');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const env={...process.env,SWARTZIT_TEST_SKIP_MEDIA:'1',API_URL:`http://127.0.0.1:${server.address().port}`,SCHEDULER_HANDLE:'test',SCHEDULER_PASSWORD:'test'};
  const state=join(dir,'state.json'),batch=join(dir,'batch.json');
  const run=extra=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['scripts/scheduled-imports.mjs','--job','x','--batch',batch,'--state',state,...extra],{env,stdio:'pipe'});let output='';p.stdout.on('data',d=>output+=d);p.on('error',reject);p.on('close',code=>resolve({code,receipt:JSON.parse(output)}));});
  try{
    const item={provider:'x',observed_at:new Date().toISOString()};
    await writeFile(batch,JSON.stringify([item,item]));
    const partial=await run([]);
    assert.equal(partial.code,1);assert.equal(partial.receipt.created,1);assert.equal(partial.receipt.failed,1);assert.equal(revoked,1);
    assert.equal(JSON.parse(await readFile(state)).last_success,undefined);
    await writeFile(batch,JSON.stringify([{provider:'x',observed_at:'2020-01-01T00:00:00Z'}]));
    assert.equal((await run([])).code,1);assert.equal(imports,2);
    await writeFile(batch,JSON.stringify([item]));
    assert.equal((await run([])).code,0);assert.equal(imports,3);
    assert.equal((await run(['--due-hours','24'])).receipt.status,'not_due');assert.equal(imports,3);
    await writeFile(state+'.lock',String(process.pid));
    assert.equal((await run([])).code,1);assert.equal(imports,3);
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
