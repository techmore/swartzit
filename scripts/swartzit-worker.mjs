// Run due crawler jobs. Provider adapters must be explicit: this worker never
// scrapes a login session or claims success without a configured adapter.
import {spawn} from 'node:child_process';
import {writeFile, mkdir, readFile, stat} from 'node:fs/promises';
import {dirname, extname} from 'node:path';
import {collectReddit, collectX, collectRss} from './crawler-adapters.mjs';
import {renderRunnerPrompt} from './runner-prompt.mjs';
import {drawThingsArgs, drawThingsBody, drawThingsGeneration, expandHome, expandPromptPermutations, parseDrawThingsProgress, runnerOutputPath} from './draw-things-runner.mjs';
import {contentPackageArgv, contentPackageEnvironment, contentPackageWorkingDirectory, packageFrameCheckpoint, packageFramePercent, parseContentPackageFrame, validateContentPackageManifest} from './content-package-runner.mjs';
import {currentWorkerPaths as workerPaths} from './worker-runtime.mjs';
const exec = (cmd, args, opts={}) => new Promise(resolve => {
  const started = Date.now();
  const {timeoutMs: configuredTimeoutMs = 0, onStdout, onStderr, onChild, ...spawnOptions} = opts;
  const child = spawn(cmd, args, spawnOptions);
  try { onChild?.(child); } catch {}
  let out='', err='', timedOut=false, finished=false;
  const timeoutMs = Number(configuredTimeoutMs);
  let timer;
  const finish = (result) => { if (finished) return; finished=true; if (timer) clearTimeout(timer); resolve({...result,durationMs:Date.now()-started}); };
  child.stdout.on('data', data => { const text = String(data); out += text; try { onStdout?.(text); } catch {} });
  child.stderr.on('data', data => { const text = String(data); err += text; try { onStderr?.(text); } catch {} });
  child.on('error', error => finish({code:null,signal:null,out,err:err || error.message,timedOut}));
  child.on('close', (code, signal) => finish({code,signal,out,err,timedOut}));
  if (timeoutMs > 0) timer=setTimeout(() => { timedOut=true; child.kill('SIGTERM'); setTimeout(() => { if (!finished) child.kill('SIGKILL'); }, 5000); }, timeoutMs);
});
const api=process.env.API_URL??'http://127.0.0.1:18080';
const handle=process.env.SCHEDULER_HANDLE, password=process.env.SCHEDULER_PASSWORD;
if(!handle||!password) throw Error('SCHEDULER_HANDLE and SCHEDULER_PASSWORD are required');
const workerRoot=workerPaths.root;
const workerStateDir=workerPaths.stateDir;
const workerEnv={...process.env,SWARTZIT_WORKER_ROOT:workerRoot,SWARTZIT_WORKER_STATE_DIR:workerStateDir};
const scheduledImportsScript=workerPaths.script('scheduled-imports.mjs');
const statePath=name=>workerPaths.state(name);
await mkdir(workerStateDir,{recursive:true});
async function responseValue(path, response) {
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = null; }
  if (!response.ok) {
    const detail = value?.error || value?.message || text.trim().replace(/\s+/g, ' ').slice(0, 300);
    throw Error(`${path}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
  }
  return response.status === 204 ? null : value;
}
function truncateLog(value, maxBytes) {
  const text = String(value || '');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  return bytes.subarray(bytes.length - maxBytes).toString('utf8');
}
async function call(path,method='GET',body){const r=await fetch(api+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)}); return responseValue(path,r);}
async function callBinary(path, contentType, body) { const r = await fetch(api + path, {method:'POST',headers:{'content-type':contentType,authorization:'Bearer '+token},body,signal:AbortSignal.timeout(30000)}); return responseValue(path,r); }
const token=(await (async()=>{const r=await fetch(api+'/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle,password})}); if(!r.ok) throw Error('scheduler login failed'); return (await r.json()).token;})());
const skipCrawlers=process.env.SWARTZIT_WORKER_SKIP_CRAWLERS === '1';
let jobs=skipCrawlers ? [] : await call('/api/admin/crawler-jobs'); let processed=0;
for(const job of jobs.filter(j=>j.enabled)){
  let claim; try{claim=await call(`/api/admin/crawler-jobs/${job.id}/claim`,'POST')}catch{continue;}
  processed++;
  let result={status:'skipped',imported_count:0,error:null,detail:{provider:job.provider}};
  try{
    if(job.provider==='commons'){
      const r=await exec(process.execPath,[scheduledImportsScript,'--job','ddario','--limit',String(job.max_items),'--due-hours',String(job.interval_seconds/3600),'--state',statePath('sync-ddario.json')],{cwd:workerRoot,env:workerEnv});
      if(r.code!==0) throw Error(r.err.slice(-1000)||'Commons publisher failed');
      const receipt=JSON.parse(r.out.trim().split('\n').at(-1));
      result={status:receipt.status==='success'?'success':'skipped',imported_count:(receipt.created??0)+(receipt.updated??0),error:receipt.error??null,detail:receipt};
    }else if(job.provider==='reddit'||job.provider==='x'||job.provider==='rss'){
      if(!job.community) throw Error('Assign a destination community before enabling this job');
      const items=job.provider==='reddit'?await collectReddit(job):job.provider==='x'?await collectX(job):await collectRss(job);
      if(!items.length) { result={status:'skipped',imported_count:0,error:null,detail:{provider:job.provider,reason:'no eligible public posts'}}; }
      else {
        const batchDir=statePath('worker-batches'); await mkdir(batchDir,{recursive:true}); const path=statePath('worker-batches',`job-${job.id}-${Date.now()}.json`); await writeFile(path,JSON.stringify(items));
        const r=await exec(process.execPath,[scheduledImportsScript,'--job','feed','--batch',path,'--limit',String(items.length),'--state',statePath(`sync-job-${job.id}.json`)],{cwd:workerRoot,env:workerEnv});
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
async function uploadRunnerMedia(file) {
  const contentType = runnerContentType(file);
  if (!contentType) throw Error(`Unsupported runner image extension: ${extname(file) || '(none)'}`);
  const info = await stat(file);
  if (info.size < 1 || info.size > 5_242_880) throw Error('Runner images must be between 1 byte and 5 MB');
  const bytes = await readFile(file);
  try {
    return await callBinary('/api/admin/content-runners/media/raw', contentType, bytes);
  } catch (error) {
    // Keep workers compatible with a pre-raw-upload API during rolling
    // upgrades. A real upload error is preserved; only an absent endpoint
    // falls back to the older JSON/hex contract.
    if (!/HTTP (404|405)\b/.test(error.message)) throw error;
    return call('/api/admin/content-runners/media', 'POST', {data_hex: bytes.toString('hex'), content_type: contentType});
  }
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
async function existingRunnerSourceUrls(posts) {
  const grouped = new Map();
  for (const post of posts) {
    const provider = String(post?.provider || '').trim().toLowerCase();
    const sourceUrl = typeof post?.source_url === 'string' ? post.source_url.trim() : '';
    if (!['x', 'reddit', 'rss', 'commons'].includes(provider) || !sourceUrl) continue;
    if (!grouped.has(provider)) grouped.set(provider, new Set());
    grouped.get(provider).add(sourceUrl);
  }
  const existing = new Set();
  for (const [provider, sourceUrls] of grouped) {
    const result = await call('/api/admin/content-runners/source-status', 'POST', {provider, source_urls: [...sourceUrls]});
    for (const sourceUrl of (result?.existing_source_urls || [])) existing.add(String(sourceUrl));
  }
  return existing;
}
async function publishRunnerPosts(posts, claim, dryRun, maxPosts = posts.length) {
  const previews = [], published = [], warnings = [], skippedExisting = [];
  if (!Number.isInteger(maxPosts) || maxPosts < 1 || maxPosts > 8) throw Error('Runner post limit must be an integer from 1 to 8');
  const payloads = [];
  const delayedMedia = [];
  for (let index = 0; index < posts.length; index += 1) {
    const raw = posts[index];
    if (!raw || typeof raw !== 'object') throw Error(`Runner post ${index + 1} is not an object`);
    const hasSourceUrl = Boolean(raw.source_url);
    const media = hasSourceUrl ? (raw.media ?? []) : await materializeRunnerMedia(raw.media, dryRun);
    const payload = {...raw, author: claim.author, community: claim.community, media};
    if (!payload.source_url) payload.source_url = runnerSourceUrl(media, claim, index);
    payloads.push(payload);
    delayedMedia.push(hasSourceUrl);
  }
  const existing = await existingRunnerSourceUrls(payloads);
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];
    if (payload.source_url && existing.has(String(payload.source_url).trim())) {
      skippedExisting.push({index: index + 1, source_url: payload.source_url});
      continue;
    }
    if (previews.length + published.length >= maxPosts) break;
    try {
      if (delayedMedia[index]) payload.media = await materializeRunnerMedia(posts[index].media, dryRun);
      if (dryRun) previews.push(payload);
      else published.push(await call('/api/admin/content-runners/publish', 'POST', payload));
    } catch (error) {
      warnings.push(`Post ${index + 1}: ${error.message}`);
    }
  }
  return {previews, published, warnings, skippedExisting};
}

function createDrawThingsProgressReporter(runId, startedAt, index, total) {
  let lineBuffer = '';
  let queued = null;
  let drainPromise = null;
  let lastSentAt = 0;
  let lastSignature = '';

  const drain = async () => {
    while (queued) {
      const payload = queued;
      queued = null;
      try {
        await call(`/api/admin/content-runner-runs/${runId}/progress`, 'POST', payload);
      } catch {
        // Progress is advisory. A temporary telemetry failure must never
        // turn a successful local generation into a failed runner.
      }
    }
    drainPromise = null;
    if (queued) drainPromise = drain();
  };

  const queue = payload => {
    queued = payload;
    if (!drainPromise) drainPromise = drain();
  };

  const payloadFor = info => {
    const localPercent = Math.min(100, Math.max(0, Number(info.percent) || 0));
    const overallPercent = Math.min(100, Math.max(0, Math.round(((index + localPercent / 100) / total) * 100)));
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const etaSeconds = overallPercent > 0 && elapsedSeconds >= 3
      ? Math.max(0, Math.round(elapsedSeconds * (100 - overallPercent) / overallPercent))
      : null;
    return {
      progress_percent: overallPercent,
      phase: info.phase,
      message: total > 1 ? `Image ${index + 1}/${total}: ${info.message}` : info.message,
      current_step: info.currentStep,
      total_steps: info.totalSteps,
      eta_seconds: etaSeconds
    };
  };

  const observe = info => {
    if (!info) return;
    const payload = payloadFor(info);
    const signature = `${payload.progress_percent}:${payload.phase}:${payload.current_step ?? ''}:${payload.message}`;
    const now = Date.now();
    const due = !lastSentAt || now - lastSentAt >= 4000 || payload.progress_percent >= 100;
    if (!due || signature === lastSignature) return;
    lastSentAt = now;
    lastSignature = signature;
    queue(payload);
  };

  const observeText = text => {
    lineBuffer += String(text);
    const lines = lineBuffer.split(/\r\n|\n|\r/);
    lineBuffer = lines.pop() || '';
    for (const line of lines) observe(parseDrawThingsProgress(line));
  };

  const start = () => observe({percent: 0, phase: 'starting', message: `Preparing image ${index + 1} of ${total}`, currentStep: null, totalSteps: null});
  const flush = async () => {
    if (lineBuffer) {
      observe(parseDrawThingsProgress(lineBuffer));
      lineBuffer = '';
    }
    if (queued && !drainPromise) drainPromise = drain();
    if (drainPromise) await drainPromise;
    if (queued) await flush();
  };

  return {start, observeText, flush};
}

function createContentPackageProgressReporter(runId, startedAt) {
  let queued = null;
  let drainPromise = null;
  let lastSentAt = 0;
  let lastSignature = '';

  const drain = async () => {
    while (queued) {
      const payload = queued;
      queued = null;
      try {
        await call(`/api/admin/content-runner-runs/${runId}/progress`, 'POST', payload);
      } catch {
        // Telemetry must not turn a successful local generation into a failure.
      }
    }
    drainPromise = null;
    if (queued) drainPromise = drain();
  };

  const queue = payload => {
    queued = payload;
    if (!drainPromise) drainPromise = drain();
  };

  const observe = frame => {
    const percent = packageFramePercent(frame);
    const checkpoint = packageFrameCheckpoint(frame);
    const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const payload = {
      ...(percent == null ? {heartbeat: true} : {progress_percent: percent}),
      phase: String(frame?.phase || frame?.type || 'running').slice(0, 64),
      message: String(frame?.message || frame?.checkpoint?.message || '').slice(0, 300),
      current_step: Number.isInteger(frame?.current_step) ? frame.current_step : null,
      total_steps: Number.isInteger(frame?.total_steps) ? frame.total_steps : null,
      eta_seconds: percent != null && percent > 0 && elapsed >= 3
        ? Math.max(0, Math.round(elapsed * (100 - percent) / percent))
        : null,
      ...(checkpoint ? {checkpoint} : {})
    };
    const signature = JSON.stringify(payload);
    const now = Date.now();
    if (signature === lastSignature || (now - lastSentAt < 4000 && percent !== 100)) return;
    lastSignature = signature;
    lastSentAt = now;
    queue(payload);
  };

  const heartbeat = () => queue({heartbeat: true, phase: 'running', message: 'Adapter is still working'});
  const start = () => observe({type: 'progress', phase: 'starting', message: 'Starting content package adapter', percent: 0});
  const flush = async () => {
    if (queued && !drainPromise) drainPromise = drain();
    if (drainPromise) await drainPromise;
    if (queued) await flush();
  };
  return {start, observe, heartbeat, flush};
}

async function contentRunnerControl(runId) {
  try {
    return await call(`/api/admin/content-runner-runs/${runId}/control`);
  } catch {
    return null;
  }
}

async function runContentPackage(claim, config, runnerEnv, runStarted) {
  const argv = contentPackageArgv(config);
  const workingDirectory = contentPackageWorkingDirectory(config, workerRoot);
  const options = contentPackageEnvironment(config);
  const progress = createContentPackageProgressReporter(claim.run_id, runStarted);
  let child = null;
  let stdoutBuffer = '';
  let frameQueue = Promise.resolve();
  let packageManifest = null;
  let latestCheckpoint = null;
  let requestedAction = null;
  let adapterCancelled = false;
  let adapterError = null;
  let controlTimer = null;
  let heartbeatTimer = null;

  const stopIfRequested = async () => {
    if (!child || requestedAction === 'cancel') return;
    const control = await contentRunnerControl(claim.run_id);
    const action = control?.control_request;
    if (action === 'cancel') {
      requestedAction = 'cancel';
      child.kill('SIGTERM');
    } else if (action === 'pause' && latestCheckpoint) {
      requestedAction = 'pause';
      child.kill('SIGTERM');
    }
  };

  const handleFrame = async frame => {
    if (frame.type === 'progress') progress.observe(frame);
    if (frame.type === 'checkpoint') {
      latestCheckpoint = packageFrameCheckpoint(frame) || latestCheckpoint;
      progress.observe(frame);
      await stopIfRequested();
    }
    if (frame.type === 'package') {
      packageManifest = validateContentPackageManifest(frame.package);
      progress.observe({type: 'progress', phase: 'complete', message: 'Content package is ready', percent: 100});
    }
    if (frame.type === 'cancelled') adapterCancelled = true;
    if (frame.type === 'error') adapterError = String(frame.message || frame.error || 'Content package adapter failed');
  };

  const observeStdout = chunk => {
    stdoutBuffer += String(chunk);
    const lines = stdoutBuffer.split(/\r\n|\n|\r/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const frame = parseContentPackageFrame(line);
      if (frame) frameQueue = frameQueue.then(() => handleFrame(frame));
    }
  };

  progress.start();
  controlTimer = setInterval(() => { void stopIfRequested(); }, 3000);
  controlTimer.unref?.();
  heartbeatTimer = setInterval(() => { progress.heartbeat(); }, 15000);
  heartbeatTimer.unref?.();
  let result;
  try {
    result = await exec(argv[0], argv.slice(1), {
      cwd: workingDirectory,
      env: {
        ...runnerEnv,
        RUNNER_PROMPT: claim.prompt,
        RUNNER_OUTPUT_PATH: statePath(`runner-output-${claim.id}-${Date.now()}.json`),
        RUNNER_DRY_RUN: String(claim.dry_run === true),
        SWARTZIT_RUNNER_NAME: claim.name,
        SWARTZIT_RUNNER_RUN_ID: String(claim.run_id),
        SWARTZIT_RUNNER_PROTOCOL: 'jsonl',
        RUNNER_PACK_ID: String(config.pack || ''),
        RUNNER_PACK_OPTIONS_JSON: JSON.stringify(options),
        RUNNER_RESUME_CHECKPOINT_JSON: JSON.stringify(claim.resume_checkpoint || {}),
      },
      timeoutMs: claim.timeout_seconds * 1000,
      onChild: value => { child = value; },
      onStdout: observeStdout,
    });
    if (stdoutBuffer.trim()) {
      const frame = parseContentPackageFrame(stdoutBuffer);
      if (frame) frameQueue = frameQueue.then(() => handleFrame(frame));
    }
    await frameQueue;
  } finally {
    if (controlTimer) clearInterval(controlTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await progress.flush();
  }
  if (requestedAction === 'pause') return {status: 'paused', result, packageManifest, latestCheckpoint};
  if (requestedAction === 'cancel') return {status: 'cancelled', result, packageManifest, latestCheckpoint};
  if (adapterCancelled) return {status: 'cancelled', result, packageManifest, latestCheckpoint};
  if (result.timedOut) throw Error(`Runner exceeded its ${claim.timeout_seconds}s timeout`);
  if (result.code !== 0) throw Error(adapterError || result.err.slice(-1500) || `Content package adapter exited with ${result.code}`);
  if (adapterError) throw Error(adapterError);
  if (!packageManifest) throw Error('Content package adapter did not emit a package frame');
  return {status: 'success', result, packageManifest, latestCheckpoint};
}

async function publishContentPackageFeedItem(manifest, claim, config, dryRun) {
  const feed = manifest?.feed_item && typeof manifest.feed_item === 'object'
    ? manifest.feed_item
    : {title: manifest.title, body: manifest.summary || `Generated ${manifest.units.length} content units.`};
  const media = await materializeRunnerMedia(feed.media, dryRun);
  const provenance = contentPackageProvenance(manifest);
  const generationConfig = {
    ...(feed.generation_config && typeof feed.generation_config === 'object' ? feed.generation_config : {}),
    provider: 'content_package',
    format: manifest.format,
    pack: manifest.pack,
    package_id: manifest.id,
    unit_count: manifest.units.length,
    provenance,
  };
  const payload = {
    ...feed,
    title: String(feed.title || manifest.title).slice(0, 300),
    body: String(feed.body || manifest.summary || '').slice(0, 50000),
    author: claim.author,
    community: claim.community,
    provider: 'runner',
    source_url: feed.source_url || `swartzit://content-package/${encodeURIComponent(String(manifest.pack?.id || 'pack'))}/${encodeURIComponent(String(manifest.id || Date.now()))}`,
    media,
    attribution: feed.attribution || `Generated by the ${manifest.pack?.id || 'content package'} extension.`,
    generation_config: generationConfig,
  };
  if (dryRun) return {preview: payload, published: null};
  return {preview: null, published: await call('/api/admin/content-runners/publish', 'POST', payload)};
}

function contentPackageProvenance(manifest) {
  const rawProvenance = manifest?.provenance && typeof manifest.provenance === 'object'
    ? manifest.provenance
    : {};
  // Do not expose worker-local paths or the full adapter manifest through the
  // public external_posts source payload.
  return Object.fromEntries(['generator', 'created_at', 'seed', 'model', 'pipeline_complete']
    .filter(key => rawProvenance[key] !== undefined)
    .map(key => [key, rawProvenance[key]]));
}

function contentPackageUnitSourceUrl(manifest, unit) {
  const packId = encodeURIComponent(String(manifest?.pack?.id || 'pack'));
  const packageId = encodeURIComponent(String(manifest?.id || Date.now()));
  const unitId = encodeURIComponent(String(unit?.id || `day-${unit?.order || 1}`));
  return `swartzit://content-package/${packId}/${packageId}/${unitId}`;
}

async function publishContentPackageArticleUnits(manifest, claim, config, dryRun) {
  const units = Array.isArray(manifest?.units) ? manifest.units : [];
  if (!units.length) throw Error('Content package has no article units to publish');
  const previews = [], published = [], warnings = [];
  const provenance = contentPackageProvenance(manifest);
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (!unit || typeof unit !== 'object') throw Error(`Content package unit ${index + 1} is invalid`);
    const order = Number.isInteger(Number(unit.order)) ? Number(unit.order) : index + 1;
    const unitTitle = String(unit.title || `Day ${order}`).trim();
    const title = `${manifest.title} · Day ${order}: ${unitTitle}`.slice(0, 300);
    const body = String(unit.body || '').trim();
    if (!body) throw Error(`Content package unit ${index + 1} has no story body`);
    const media = await materializeRunnerMedia(unit.media, dryRun);
    const generationConfig = {
      provider: 'content_package',
      content_kind: 'article',
      format: manifest.format,
      pack: manifest.pack,
      package_id: manifest.id,
      series_title: manifest.title,
      unit_id: String(unit.id || `day-${order}`),
      unit_order: order,
      unit_count: units.length,
      provenance,
      ...(unit.metadata && typeof unit.metadata === 'object' ? {unit_metadata: unit.metadata} : {}),
      ...(config.article_generation_config && typeof config.article_generation_config === 'object'
        ? config.article_generation_config
        : {}),
    };
    const payload = {
      title,
      body,
      content_kind: 'article',
      content_rating: unit.content_rating || manifest.content_rating,
      author: claim.author,
      community: claim.community,
      provider: 'runner',
      source_url: contentPackageUnitSourceUrl(manifest, unit),
      media,
      attribution: unit.attribution || `Generated by the ${manifest.pack?.id || 'content package'} extension.`,
      generation_config: generationConfig,
    };
    if (dryRun) previews.push(payload);
    else {
      try {
        published.push(await call('/api/admin/content-runners/publish', 'POST', payload));
      } catch (error) {
        warnings.push(`Day ${order}: ${error.message}`);
      }
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
      const outputPath = statePath(`runner-output-${claim.id}-${Date.now()}.json`);
      const inheritedKeys = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'NODE_PATH'];
      const runnerEnv = {
        ...Object.fromEntries(inheritedKeys.filter(key => process.env[key]).map(key => [key, process.env[key]])),
        SWARTZIT_WORKER_ROOT: workerRoot,
        SWARTZIT_WORKER_STATE_DIR: workerStateDir,
      };
      for (const key of (Array.isArray(claim.environment_keys) ? claim.environment_keys : [])) if (process.env[key] !== undefined) runnerEnv[key] = process.env[key];
      const runStarted = Date.now();
      const generatedFiles = [], previews = [], published = [], warnings = [], skippedExisting = [];
      if (claim.kind === 'draw_things') {
        const config = claim.command && typeof claim.command === 'object' ? claim.command : {};
        const promptPermutations = expandPromptPermutations(config.prompt_permutations);
        const total = config.prompt_permutations?.length
          ? promptPermutations.length
          : Math.min(8, Math.max(1, Number(config.posts_per_run ?? 1)));
        for (let index = 0; index < total; index += 1) {
          const output = runnerOutputPath(config.output_path, claim.id, index, total, runStarted, workerStateDir);
          await mkdir(dirname(output), {recursive: true});
          const seed = config.seed === null || config.seed === undefined ? null : Number(config.seed) + index;
          const promptVariables = promptPermutations[index] || {};
          const prompt = renderRunnerPrompt(claim.prompt, {now: runStarted, runner: claim.name, community: claim.community, author: claim.author, runId: claim.run_id, seed, index: index + 1, total, dryRun, variables: promptVariables});
          const argv = [expandHome(String(config.executable || 'draw-things-cli')), ...drawThingsArgs(config, prompt, output, index)];
          const progress = createDrawThingsProgressReporter(claim.run_id, runStarted, index, total);
          progress.start();
          let r;
          try {
            r = await exec(argv[0], argv.slice(1), { cwd: workerRoot, env: { ...runnerEnv, RUNNER_PROMPT: prompt, RUNNER_OUTPUT_PATH: output, RUNNER_DRY_RUN: String(dryRun), SWARTZIT_RUNNER_NAME: claim.name }, timeoutMs: claim.timeout_seconds * 1000, onStdout: progress.observeText });
          } finally {
            await progress.flush();
          }
          if (claim.capture_output !== false) { result.stdout += r.out; result.stderr += r.err; }
          result.exit_code = r.code; result.duration_ms = (result.duration_ms || 0) + r.durationMs; result.timed_out ||= r.timedOut;
          if (r.timedOut) throw Error(`Runner exceeded its ${claim.timeout_seconds}s timeout`);
          if (r.code !== 0) throw Error(r.err.slice(-1500) || `Draw Things exited with ${r.code}`);
          const file = await stat(output).catch(() => null);
          if (!file || !file.isFile()) throw Error(`Draw Things did not create ${output}`);
          generatedFiles.push(output);
          const generation = drawThingsGeneration(config, prompt, seed, index, {promptTemplate: claim.prompt, promptVariables, permutationIndex: index + 1, permutationTotal: total});
          const media = dryRun ? [{kind: 'image', path: output, alt: prompt}] : [{...(await uploadRunnerMedia(output)), alt: prompt}];
          const title = `${config.title_prefix || 'Draw Things generation'}${total > 1 ? ` · ${index + 1}` : ''}`;
          const payload = {title, body: drawThingsBody(generation), media, source_url: runnerSourceUrl(media, claim, index), attribution: 'Generated by Draw Things via a configured Swartzit runner.', generation_config: generation};
          if (dryRun) previews.push(payload);
          else {
            const response = await call('/api/admin/content-runners/publish', 'POST', {...payload, author: claim.author, community: claim.community});
            published.push(response);
          }
        }
      } else if (claim.kind === 'content_package') {
        const config = claim.command && typeof claim.command === 'object' && !Array.isArray(claim.command) ? claim.command : {};
        const outcome = await runContentPackage(claim, config, runnerEnv, runStarted);
        const adapterResult = outcome.result || {};
        if (claim.capture_output !== false) { result.stdout = adapterResult.out; result.stderr = adapterResult.err; }
        result.exit_code = adapterResult.code;
        result.duration_ms = adapterResult.durationMs;
        result.timed_out = adapterResult.timedOut;
        const packageDetail = {
          format: outcome.packageManifest?.format || 'content-package.v1',
          package: outcome.packageManifest,
          checkpoint: outcome.latestCheckpoint,
          control_action: outcome.status === 'success' ? null : outcome.status,
          published: [],
          previews: [],
        };
        if (outcome.status === 'paused' || outcome.status === 'cancelled') {
          result.status = outcome.status;
          result.error = outcome.status === 'paused' ? 'Paused at the latest adapter checkpoint' : 'Cancelled by administrator';
          result.detail = packageDetail;
        } else {
          const publishMode = String(
            config.publish_mode || config.options?.publish_mode || 'feed_item',
          ).trim().toLowerCase();
          if (publishMode === 'none') {
            previews.push({title: outcome.packageManifest.title, body: outcome.packageManifest.summary || '', package: outcome.packageManifest});
          } else if (publishMode === 'article_units' || publishMode === 'articles') {
            const publication = await publishContentPackageArticleUnits(outcome.packageManifest, claim, config, dryRun);
            previews.push(...publication.previews);
            published.push(...publication.published);
            warnings.push(...publication.warnings);
          } else {
            const publication = await publishContentPackageFeedItem(outcome.packageManifest, claim, config, dryRun);
            if (publication.preview) previews.push(publication.preview);
            if (publication.published) published.push(publication.published);
          }
          result.status = 'success';
          result.post_id = published[0]?.post_id ?? null;
          result.detail = {...packageDetail, published, previews, publish_mode: publishMode};
        }
      } else {
        const argv = Array.isArray(claim.command) ? claim.command.map(String) : [];
        if (!argv.length || argv.length > 32) throw Error('Runner command must contain an executable and argv');
        const prompt = renderRunnerPrompt(claim.prompt, {now: runStarted, runner: claim.name, community: claim.community, author: claim.author, runId: claim.run_id, dryRun});
        const r = await exec(argv[0], argv.slice(1), { cwd: workerRoot, env: { ...runnerEnv, RUNNER_PROMPT: prompt, RUNNER_OUTPUT_PATH: outputPath, RUNNER_DRY_RUN: String(dryRun), SWARTZIT_RUNNER_NAME: claim.name }, timeoutMs: claim.timeout_seconds * 1000 });
        if (claim.capture_output !== false) { result.stdout = truncateLog(r.out, maxLogBytes); result.stderr = truncateLog(r.err, maxLogBytes); }
        result.exit_code = r.code; result.duration_ms = r.durationMs; result.timed_out = r.timedOut;
        if (r.timedOut) throw Error(`Runner exceeded its ${claim.timeout_seconds}s timeout`);
        if (r.code !== 0) throw Error(r.err.slice(-1500) || `Runner exited with ${r.code}`);
        const parsed = JSON.parse(r.out.trim().split('\n').at(-1));
        const envelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.posts) ? parsed : null;
        const posts = envelope ? envelope.posts : [parsed];
        if (!posts.length && claim.kind !== 'cross_post') throw Error('Runner output must contain between 1 and 8 posts');
        if (posts.length > (claim.kind === 'cross_post' ? 100 : 8)) throw Error(`Runner output must contain at most ${claim.kind === 'cross_post' ? 100 : 8} posts`);
        const maxPosts = claim.kind === 'cross_post' ? envelope?.max_posts ?? 8 : Math.min(posts.length, 8);
        if (claim.kind === 'cross_post' && (!Number.isInteger(maxPosts) || maxPosts < 1 || maxPosts > 8)) throw Error('Cross-post max_posts must be an integer from 1 to 8');
        const outcome = posts.length ? await publishRunnerPosts(posts, claim, dryRun, maxPosts) : {previews: [], published: [], warnings: [], skippedExisting: []};
        previews.push(...outcome.previews); published.push(...outcome.published); warnings.push(...outcome.warnings);
        skippedExisting.push(...outcome.skippedExisting);
      }
    if (!['paused', 'cancelled'].includes(result.status) && !dryRun && !published.length) {
      if (warnings.length) throw Error(warnings.join('; '));
      if (!skippedExisting.length && claim.kind !== 'cross_post') throw Error('Runner did not publish a post');
    }
      if (!['paused', 'cancelled'].includes(result.status)) {
        result.status = !dryRun && !published.length && skippedExisting.length ? 'skipped' : 'success';
        result.post_id = published[0]?.post_id ?? null;
        result.error = warnings.length ? warnings.join('; ') : null;
        result.detail = {dry_run: dryRun, generated_files: generatedFiles, previews, published, skipped_existing: skippedExisting, warnings, ...(result.detail || {})};
      }
    } catch (e) { result.status = result.timed_out ? 'timeout' : 'failed'; result.error = e.message; result.detail = { command: claim.command, attempt: claim.attempt }; }
    if (claim.capture_output !== false) { result.stdout = truncateLog(result.stdout, maxLogBytes); result.stderr = truncateLog(result.stderr, maxLogBytes); }
    await call(`/api/admin/content-runner-runs/${claim.run_id}/complete`, 'POST', result);
  }
}
// Keep small public X avatars local after imports. A cache miss is harmless;
// the web UI falls back to the source URL until a later run succeeds.
try {
  const cached=await exec(process.execPath,[workerPaths.script('cache-profile-images.mjs')],{cwd:workerRoot,env:{...workerEnv,PROFILE_IMAGE_CACHE_DIR:workerPaths.state('profile-cache')}});
  if(cached.code!==0) console.error(cached.err.slice(-1000)||'profile image cache failed');
} catch(e) { console.error(`profile image cache failed: ${e.message}`); }
await call('/api/sessions','DELETE');
console.log(JSON.stringify({processed}));
