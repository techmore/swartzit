// Run due crawler jobs. Provider adapters must be explicit: this worker never
// scrapes a login session or claims success without a configured adapter.
import {spawn} from 'node:child_process';
import {writeFile, mkdir, readFile, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, extname, isAbsolute, resolve} from 'node:path';
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

const runnerContentType = file => ({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif'
}[extname(file).toLowerCase()] || null);
const expandHome = value => value === '~' ? homedir() : value.startsWith('~/') ? `${homedir()}/${value.slice(2)}` : value;
function runnerOutputPath(template, claimId, index, total, startedAt) {
  const raw = String(template || `.local/draw-things/${claimId}-${startedAt}-${index + 1}.png`);
  let output = expandHome(raw)
    .replaceAll('{runner_id}', String(claimId))
    .replaceAll('{index}', String(index + 1))
    .replaceAll('{timestamp}', String(startedAt));
  if (total > 1 && index > 0 && !raw.includes('{index}')) {
    const extension = extname(output);
    output = `${output.slice(0, output.length - extension.length)}-${index + 1}${extension}`;
  }
  return isAbsolute(output) ? output : resolve(process.cwd(), output);
}
function drawThingsArgs(config, prompt, output, index) {
  const args = ['generate'];
  if (config.models_dir) args.push('--models-dir', expandHome(String(config.models_dir)));
  args.push('--model', String(config.model), '--prompt', prompt);
  for (const [key, flag] of [['width', '--width'], ['height', '--height'], ['steps', '--steps'], ['cfg', '--cfg']]) {
    if (config[key] !== undefined && config[key] !== null && config[key] !== '') args.push(flag, String(config[key]));
  }
  if (config.seed !== undefined && config.seed !== null && config.seed !== '') args.push('--seed', String(Number(config.seed) + index));
  if (Array.isArray(config.loras) && config.loras.length) args.push('--config-json', JSON.stringify({loras: config.loras}));
  args.push('--output', output);
  return args;
}
function drawThingsGeneration(config, prompt, seed, index) {
  return {
    provider: 'draw_things',
    prompt,
    model: config.model,
    models_dir: config.models_dir || null,
    loras: Array.isArray(config.loras) ? config.loras : [],
    width: Number(config.width ?? 1024),
    height: Number(config.height ?? 1024),
    steps: Number(config.steps ?? 4),
    cfg: Number(config.cfg ?? 3.5),
    seed: seed ?? null,
    variant: index + 1
  };
}
function drawThingsBody(generation) {
  const loras = generation.loras.length
    ? generation.loras.map(lora => `${lora.file} (${lora.version}, weight ${lora.weight})`).join(', ')
    : 'None';
  return [
    'Generated with Draw Things via Swartzit.',
    '',
    `Prompt: ${generation.prompt}`,
    '',
    `Model: ${generation.model}`,
    `LoRAs: ${loras}`,
    `Settings: ${generation.width}×${generation.height} · ${generation.steps} steps · CFG ${generation.cfg} · seed ${generation.seed ?? 'automatic'}`
  ].join('\n');
}
async function uploadRunnerMedia(file) {
  const contentType = runnerContentType(file);
  if (!contentType) throw Error(`Unsupported runner image extension: ${extname(file) || '(none)'}`);
  const info = await stat(file);
  if (info.size < 1 || info.size > 5_242_880) throw Error('Runner images must be between 1 byte and 5 MB');
  const bytes = await readFile(file);
  return call('/api/admin/content-runners/media', 'POST', {data_hex: bytes.toString('hex'), content_type: contentType});
}
async function materializeRunnerMedia(media, dryRun) {
  if (!Array.isArray(media)) return [];
  const result = [];
  for (const item of media.slice(0, 8)) {
    if (typeof item === 'string') { result.push(item); continue; }
    if (!item || typeof item !== 'object') throw Error('Runner media items must be strings or objects');
    if (item.path) {
      if (dryRun) { result.push({...item}); continue; }
      const uploaded = await uploadRunnerMedia(expandHome(String(item.path)));
      const {path, ...withoutPath} = item;
      result.push({...withoutPath, kind: 'image', src: uploaded.src});
    } else result.push(item);
  }
  return result;
}
function runnerSourceUrl(media, claim, index) {
  const src = Array.isArray(media) ? (typeof media[0] === 'string' ? media[0] : media[0]?.src) : null;
  if (!src) return null;
  return `${src}${src.includes('?') ? '&' : '?'}runner=${claim.run_id}-${index + 1}`;
}
async function publishRunnerPosts(posts, claim, dryRun) {
  const previews = [], published = [], warnings = [];
  for (let index = 0; index < posts.length; index += 1) {
    const raw = posts[index];
    if (!raw || typeof raw !== 'object') throw Error(`Runner post ${index + 1} is not an object`);
    const media = await materializeRunnerMedia(raw.media, dryRun);
    const payload = {...raw, author: claim.author, community: claim.community, media};
    if (!payload.source_url) payload.source_url = runnerSourceUrl(media, claim, index);
    if (dryRun) { previews.push(payload); continue; }
    try {
      const response = await call('/api/admin/content-runners/publish', 'POST', payload);
      published.push(response);
    } catch (error) {
      warnings.push(`Post ${index + 1}: ${error.message}`);
    }
  }
  return {previews, published, warnings};
}

// Content runners are deliberately processed in the API's priority order and
// awaited one at a time. Generic runners print a JSON object or {"posts":[]}.
// Draw Things runners use a structured config and turn local output files into
// Swartzit media assets before the post enters moderation.
if ((await call('/api/admin/settings')).modules?.content_runners?.enabled) {
  const runners = await call('/api/admin/content-runners');
  for (const runner of runners.filter(r => r.enabled || r.test_requested)) {
    let claim; try { claim = await call(`/api/admin/content-runners/${runner.id}/claim`, 'POST'); } catch { continue; }
    processed++;
    let result = { status: 'failed', post_id: null, error: null, detail: {}, stdout: '', stderr: '', exit_code: null, duration_ms: null, timed_out: false };
    const maxLogBytes = Math.min(20000, Math.max(1024, Number(claim.max_log_bytes) || 20000));
    try {
      const dryRun = claim.dry_run === true;
      const outputPath = `.local/runner-output-${claim.id}-${Date.now()}.json`;
      const inheritedKeys = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'NODE_PATH'];
      const runnerEnv = Object.fromEntries(inheritedKeys.filter(key => process.env[key]).map(key => [key, process.env[key]]));
      for (const key of (Array.isArray(claim.environment_keys) ? claim.environment_keys : [])) if (process.env[key] !== undefined) runnerEnv[key] = process.env[key];
      const runStarted = Date.now();
      const generatedFiles = [], previews = [], published = [], warnings = [];
      if (claim.kind === 'draw_things') {
        const config = claim.command && typeof claim.command === 'object' ? claim.command : {};
        const total = Math.min(8, Math.max(1, Number(config.posts_per_run ?? 1)));
        for (let index = 0; index < total; index += 1) {
          const output = runnerOutputPath(config.output_path, claim.id, index, total, runStarted);
          await mkdir(dirname(output), {recursive: true});
          const seed = config.seed === null || config.seed === undefined ? null : Number(config.seed) + index;
          const argv = [expandHome(String(config.executable || 'draw-things-cli')), ...drawThingsArgs(config, claim.prompt, output, index)];
          const r = await exec(argv[0], argv.slice(1), { cwd: process.cwd(), env: { ...runnerEnv, RUNNER_PROMPT: claim.prompt, RUNNER_OUTPUT_PATH: output, RUNNER_DRY_RUN: String(dryRun), SWARTZIT_RUNNER_NAME: claim.name }, timeoutMs: claim.timeout_seconds * 1000 });
          if (claim.capture_output !== false) { result.stdout += r.out; result.stderr += r.err; }
          result.exit_code = r.code; result.duration_ms = (result.duration_ms || 0) + r.durationMs; result.timed_out ||= r.timedOut;
          if (r.timedOut) throw Error(`Runner exceeded its ${claim.timeout_seconds}s timeout`);
          if (r.code !== 0) throw Error(r.err.slice(-1500) || `Draw Things exited with ${r.code}`);
          const file = await stat(output).catch(() => null);
          if (!file || !file.isFile()) throw Error(`Draw Things did not create ${output}`);
          generatedFiles.push(output);
          const generation = drawThingsGeneration(config, claim.prompt, seed, index);
          const media = dryRun ? [{kind: 'image', path: output, alt: claim.prompt}] : [{...(await uploadRunnerMedia(output)), alt: claim.prompt}];
          const title = `${config.title_prefix || 'Draw Things generation'}${total > 1 ? ` · ${index + 1}` : ''}`;
          const payload = {title, body: drawThingsBody(generation), media, source_url: runnerSourceUrl(media, claim, index), attribution: 'Generated by Draw Things via a configured Swartzit runner.', generation_config: generation};
          if (dryRun) previews.push(payload);
          else {
            const response = await call('/api/admin/content-runners/publish', 'POST', {...payload, author: claim.author, community: claim.community});
            published.push(response);
          }
        }
      } else {
        const argv = Array.isArray(claim.command) ? claim.command.map(String) : [];
        if (!argv.length || argv.length > 32) throw Error('Runner command must contain an executable and argv');
        const r = await exec(argv[0], argv.slice(1), { cwd: process.cwd(), env: { ...runnerEnv, RUNNER_PROMPT: claim.prompt, RUNNER_OUTPUT_PATH: outputPath, RUNNER_DRY_RUN: String(dryRun), SWARTZIT_RUNNER_NAME: claim.name }, timeoutMs: claim.timeout_seconds * 1000 });
        if (claim.capture_output !== false) { result.stdout = r.out.slice(-maxLogBytes); result.stderr = r.err.slice(-maxLogBytes); }
        result.exit_code = r.code; result.duration_ms = r.durationMs; result.timed_out = r.timedOut;
        if (r.timedOut) throw Error(`Runner exceeded its ${claim.timeout_seconds}s timeout`);
        if (r.code !== 0) throw Error(r.err.slice(-1500) || `Runner exited with ${r.code}`);
        const parsed = JSON.parse(r.out.trim().split('\n').at(-1));
        const posts = Array.isArray(parsed.posts) ? parsed.posts : [parsed];
        if (!posts.length || posts.length > 8) throw Error('Runner output must contain between 1 and 8 posts');
        const outcome = await publishRunnerPosts(posts, claim, dryRun);
        previews.push(...outcome.previews); published.push(...outcome.published); warnings.push(...outcome.warnings);
      }
      if (!dryRun && !published.length) throw Error(warnings.join('; ') || 'Runner did not publish a post');
      result.status = 'success'; result.post_id = published[0]?.post_id ?? null; result.error = warnings.length ? warnings.join('; ') : null;
      result.detail = {dry_run: dryRun, generated_files: generatedFiles, previews, published, warnings};
    } catch (e) { result.status = result.timed_out ? 'timeout' : 'failed'; result.error = e.message; result.detail = { command: claim.command, attempt: claim.attempt }; }
    if (claim.capture_output !== false) { result.stdout = result.stdout.slice(-maxLogBytes); result.stderr = result.stderr.slice(-maxLogBytes); }
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
