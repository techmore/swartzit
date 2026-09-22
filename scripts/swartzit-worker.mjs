// Run due crawler jobs. Provider adapters must be explicit: this worker never
// scrapes a login session or claims success without a configured adapter.
import {spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile, mkdir} from 'node:fs/promises';
import {collectReddit, collectX, collectRss} from './crawler-adapters.mjs';
const exec = promisify((cmd, args, opts, cb) => { const p=spawn(cmd,args,opts); let out='',err=''; p.stdout.on('data',d=>out+=d); p.stderr.on('data',d=>err+=d); p.on('close',code=>cb(null,{code,out,err})); });
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
// Keep small public X avatars local after imports. A cache miss is harmless;
// the web UI falls back to the source URL until a later run succeeds.
try {
  const cached=await exec(process.execPath,['scripts/cache-profile-images.mjs'],{cwd:process.cwd(),env:process.env});
  if(cached.code!==0) console.error(cached.err.slice(-1000)||'profile image cache failed');
} catch(e) { console.error(`profile image cache failed: ${e.message}`); }
await call('/api/sessions','DELETE');
console.log(JSON.stringify({processed}));
