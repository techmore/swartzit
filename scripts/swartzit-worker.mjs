// Run due crawler jobs. Provider adapters must be explicit: this worker never
// scrapes a login session or claims success without a configured adapter.
import {spawn} from 'node:child_process';
import {writeFile, mkdir} from 'node:fs/promises';
import {collectReddit, collectX, collectRss} from './crawler-adapters.mjs';
const exec = (cmd, args, opts={}) => new Promise(resolve => {
  const started = Date.now();
  const child = spawn(cmd, args, opts);
  let out='', err='', timedOut=false, finished=false;
  const timeoutMs = Number(opts.timeoutMs ?? 0);
  let timer;
  const finish = (result) => { if (finished) return; finished=true; if (timer) clearTimeout(timer); resolve({...result,durationMs:Date.now()-started}); };
  child.stdout.on('data', data => { out += data; });
  child.stderr.on('data', data => { err += data; });
  child.on('error', error => finish({code:null,signal:null,out,err:err || error.message,timedOut}));
  child.on('close', (code, signal) => finish({code,signal,out,err,timedOut}));
  if (timeoutMs > 0) timer=setTimeout(() => { timedOut=true; child.kill('SIGTERM'); setTimeout(() => { if (!finished) child.kill('SIGKILL'); }, 5000); }, timeoutMs);
});
const api=process.env.API_URL??'http://127.0.0.1:18080';
const handle=process.env.SCHEDULER_HANDLE, password=process.env.SCHEDULER_PASSWORD;
if(!handle||!password) throw Error('SCHEDULER_HANDLE and SCHEDULER_PASSWORD are required');
async function call(path,method='GET',body){const r=await fetch(api+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)}); if(!r.ok) throw Error(`${path}: HTTP ${r.status}`); return r.status===204?null:r.json();}
const token=(await (async()=>{const r=await fetch(api+'/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle,password})}); if(!r.ok) throw Error('scheduler login failed'); return (await r.json()).token;})());
let jobs=await call('/api/admin/crawler-jobs'); let processed=0;
for(const job of jobs.filter(j=>j.enabled)){
  let claim; try{claim=await call(`/api/admin/crawler-jobs/${job.id}/claim`,'POST')}catch{continue;}
  processed++;
  let result={status:'skipped',imported_count:0,error:null,detail:{provider:job.provider}};
  try{
    if(job.provider==='commons'){
      const r=await exec(process.execPath,['scripts/scheduled-imports.mjs','--job','ddario','--limit',String(job.max_items),'--due-hours',String(job.interval_seconds/3600)],{cwd:process.cwd(),env:process.env});
      if(r.code!==0) throw Error(r.err.slice(-1000)||'Commons publisher failed');
      const receipt=JSON.parse(r.out.trim().split('\n').at(-1));
      result={status:receipt.status==='success'?'success':'skipped',imported_count:(receipt.created??0)+(receipt.updated??0),error:receipt.error??null,detail:receipt};
    }else if(job.provider==='reddit'||job.provider==='x'||job.provider==='rss'){
      if(!job.community) throw Error('Assign a destination community before enabling this job');
      const items=job.provider==='reddit'?await collectReddit(job):job.provider==='x'?await collectX(job):await collectRss(job);
      if(!items.length) { result={status:'skipped',imported_count:0,error:null,detail:{provider:job.provider,reason:'no eligible public posts'}}; }
      else {
        await mkdir('.local/worker-batches',{recursive:true}); const path=`.local/worker-batches/job-${job.id}-${Date.now()}.json`; await writeFile(path,JSON.stringify(items));
        const r=await exec(process.execPath,['scripts/scheduled-imports.mjs','--job','feed','--batch',path,'--limit',String(items.length)],{cwd:process.cwd(),env:process.env});
        if(r.code!==0) throw Error(r.err.slice(-1000)||'Import failed');
        const receipt=JSON.parse(r.out.trim().split('\n').at(-1)); result={status:receipt.status==='success'?'success':'failed',imported_count:(receipt.created??0)+(receipt.updated??0),error:receipt.error??null,detail:receipt};
      }
    }else{
      throw Error(`No ${job.provider} adapter is configured`);
    }
  }catch(e){result={...result,status:'failed',error:e.message};}
  await call(`/api/admin/crawler-runs/${claim.run_id}/complete`,'POST',result);
}

// Content runners are deliberately processed in the API's priority order and
// awaited one at a time. A runner command must print one JSON object:
// {"title":"…","body":"…","source_url":"https://…","media":[{"kind":"image","src":"https://…"}]}
// The command receives RUNNER_PROMPT and RUNNER_OUTPUT_PATH in its environment.
// argv is stored by the admin API, so no shell expansion or shell pipeline is
// involved.
if ((await call('/api/admin/settings')).modules?.content_runners?.enabled) {
  const runners = await call('/api/admin/content-runners');
  for (const runner of runners.filter(r => r.enabled)) {
    let claim; try { claim = await call(`/api/admin/content-runners/${runner.id}/claim`, 'POST'); } catch { continue; }
    processed++;
    let result = { status: 'failed', post_id: null, error: null, detail: {}, stdout: '', stderr: '', exit_code: null, duration_ms: null, timed_out: false };
    try {
      const argv = Array.isArray(claim.command) ? claim.command.map(String) : [];
      if (!argv.length || argv.length > 32) throw Error('Runner command must contain an executable and argv');
      const outputPath = `.local/runner-output-${claim.id}-${Date.now()}.json`;
      const inheritedKeys = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'NODE_PATH'];
      const runnerEnv = Object.fromEntries(inheritedKeys.filter(key => process.env[key]).map(key => [key, process.env[key]]));
      for (const key of (Array.isArray(claim.environment_keys) ? claim.environment_keys : [])) if (process.env[key] !== undefined) runnerEnv[key] = process.env[key];
      const r = await exec(argv[0], argv.slice(1), { cwd: process.cwd(), env: { ...runnerEnv, RUNNER_PROMPT: claim.prompt, RUNNER_OUTPUT_PATH: outputPath, SWARTZIT_RUNNER_NAME: claim.name }, timeoutMs: claim.timeout_seconds * 1000 });
      const maxLogBytes = Math.min(20000, Math.max(1024, Number(claim.max_log_bytes) || 20000));
      if (claim.capture_output !== false) { result.stdout = r.out.slice(-maxLogBytes); result.stderr = r.err.slice(-maxLogBytes); }
      result.exit_code = r.code; result.duration_ms = r.durationMs; result.timed_out = r.timedOut;
      if (r.timedOut) throw Error(`Runner exceeded its ${claim.timeout_seconds}s timeout`);
      if (r.code !== 0) throw Error(r.err.slice(-1500) || `Runner exited with ${r.code}`);
      const raw = r.out.trim().split('\n').at(-1);
      const parsed = JSON.parse(raw);
      const payload = { ...parsed, author: claim.author, community: claim.community };
      for (const key of ['title', 'author', 'community']) if (typeof payload[key] !== 'string' || !payload[key].trim()) throw Error(`Runner output requires ${key}`);
      const published = await call('/api/admin/content-runners/publish', 'POST', payload);
      result.status = 'success'; result.post_id = published.post_id; result.error = null; result.detail = { moderation: published.status, output: payload };
    } catch (e) { result.status = result.timed_out ? 'timeout' : 'failed'; result.error = e.message; result.detail = { command: claim.command, attempt: claim.attempt }; }
    await call(`/api/admin/content-runner-runs/${claim.run_id}/complete`, 'POST', result);
  }
}
// Keep small public X avatars local after imports. A cache miss is harmless;
// the web UI falls back to the source URL until a later run succeeds.
try {
  const cached=await exec(process.execPath,['scripts/cache-profile-images.mjs'],{cwd:process.cwd(),env:process.env});
  if(cached.code!==0) console.error(cached.err.slice(-1000)||'profile image cache failed');
} catch(e) { console.error(`profile image cache failed: ${e.message}`); }
await call('/api/sessions','DELETE');
console.log(JSON.stringify({processed}));
