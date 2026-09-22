// Collection is performed by the thread heartbeat; this runner publishes bounded batches.
import {readFile,writeFile,mkdir,rename,open,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {enrichX} from './x-media.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=n=>{const i=args.indexOf(n);return i<0?undefined:args[i+1];};
const job=option('--job'),limit=Number(option('--limit')??(job==='ddario'?3:10));
const dueHours=Number(option('--due-hours')??0);
if(!['x','feed','ddario'].includes(job)||!Number.isInteger(limit)||limit<1||limit>100||!Number.isFinite(dueHours)||dueHours<0)throw Error('Use --job x|feed|ddario --limit 1..100 [--due-hours N]');
const api=process.env.API_URL??'http://127.0.0.1:18080';
const statePath=resolve(root,option('--state')??`.local/sync-${job}.json`);
const lockPath=statePath+'.lock';
let token,locked=false,state={published:[],history:[]};
const receipt={started_at:new Date().toISOString(),job,created:0,updated:0,skipped:0,failed:0};
async function save(){await mkdir(dirname(statePath),{recursive:true});const tmp=statePath+'.tmp';await writeFile(tmp,JSON.stringify(state,null,2),{mode:0o600});await rename(tmp,statePath);}
async function call(path,method='GET',body){const r=await fetch(api+path,{method,signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json().catch(()=>null);if(!r.ok)throw Error(`${path}: HTTP ${r.status}`);return data;}
async function acquire(){
  await mkdir(dirname(statePath),{recursive:true});
  try{const f=await open(lockPath,'wx',0o600);await f.writeFile(String(process.pid));await f.close();locked=true;}
  catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(await readFile(lockPath,'utf8'));if(!Number.isInteger(pid)||pid<=0)throw Error('Invalid lock; inspect '+lockPath);try{process.kill(pid,0);}catch(err){if(err.code==='ESRCH'){await unlink(lockPath);return acquire();}throw err;}throw Error('Another '+job+' import is running');}
}
async function main(){
  await acquire();
  try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!Array.isArray(state.published)||!Array.isArray(state.history))throw Error('Invalid sync state');
  if(dueHours && state.last_success && Date.now()-Date.parse(state.last_success)<dueHours*3600000){receipt.status='not_due';return;}
  let items;
  if(job==='x'||job==='feed'){
    if(!option('--batch'))throw Error('X requires --batch FILE from a fresh browser collection; old archives are not a live sync');
    items=JSON.parse(await readFile(resolve(root,option('--batch')),'utf8'));
    if(!Array.isArray(items)||!items.length||items.length>limit)throw Error('X batch must contain 1..limit records');
    for(const p of items){const age=Date.now()-Date.parse(p.observed_at);if(!['x','reddit','rss'].includes(p.provider)||!Number.isFinite(age)||age< -300000||age>7200000)throw Error('Feed batch contains a stale or invalid snapshot');}
    if(!process.env.SWARTZIT_TEST_SKIP_MEDIA)for(let i=0;i<items.length;i++)if(items[i].provider==='x')items[i]=await enrichX(items[i]);
  }else{
    const exclude=statePath+'.exclude.json';await writeFile(exclude,JSON.stringify(state.published),{mode:0o600});
    const child=spawnSync(process.execPath,['scripts/prepare-import.mjs','--manifest',option('--manifest')??'/Users/seandolbec/clawd/media/alexandra-daddario/manifest.json','--limit',String(limit),'--exclude',exclude],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
    if(child.status!==0)throw Error('Photo preparation failed: '+(child.error?.message??child.stderr).slice(0,500));
    items=JSON.parse(child.stdout);
  }
  const creds={handle:process.env.SCHEDULER_HANDLE,password:process.env.SCHEDULER_PASSWORD};
  if(!creds.handle||!creds.password){const env=await readFile(resolve(root,option('--env-file')??'.local/import-scheduler.env'),'utf8');for(const line of env.split('\n')){const m=line.match(/^\s*(SCHEDULER_HANDLE|SCHEDULER_PASSWORD)\s*=\s*(.+?)\s*$/);if(m)creds[m[1]==='SCHEDULER_HANDLE'?'handle':'password']=m[2].replace(/^['"]|['"]$/g,'');}}
  if(!creds.handle||!creds.password)throw Error('Missing scheduler credentials');
  token=(await call('/api/sessions','POST',creds)).token;
  const seen=new Set(state.published);
  for(const item of items){
    try{const r=await call('/api/admin/imports','POST',item);receipt[r.created?'created':r.updated?'updated':'skipped']++;if(job==='ddario'){seen.add(item.source_url);state.published=[...seen];await save();}}
    catch(e){receipt.failed++;receipt.error=e.message;}
  }
  if(receipt.failed)throw Error(`${receipt.failed} imports failed; successful items are checkpointed`);
  receipt.status=items.length?'success':'exhausted';state.last_success=new Date().toISOString();
}
try{await main();}catch(e){receipt.status='failed';receipt.error=e.message;process.exitCode=1;}
finally{
  if(token){try{await call('/api/sessions','DELETE');}catch{receipt.session_cleanup_failed=true;}}
  if(locked){receipt.finished_at=new Date().toISOString();state.history=[...(state.history??[]),receipt].slice(-100);await save();await unlink(lockPath);}
  console.log(JSON.stringify(receipt));
}
