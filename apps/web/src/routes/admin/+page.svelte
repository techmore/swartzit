<script>
  import { onMount } from 'svelte';
  import SessionNav from '$lib/SessionNav.svelte';
  import ImportPanel from '$lib/ImportPanel.svelte';
  const tabs = ['Overview', 'Users', 'Content', 'Reports', 'Moderation', 'Security', 'Settings', 'Server', 'Analytics', 'Logs', 'Imports', 'Crawler Jobs', 'Content Runners'];
  let tab = 'Overview', overview = null, storage = null, rows = [], trend = [], jobs = [], runs = [], runners = [], runnerRuns = [], moderationHistory = [], uptime = null, settings = null, loading = true, error = '', notice = '';
  let jobName = '', jobProvider = 'reddit', jobSource = '', jobCommunity = '', jobInterval = 900, jobMax = 10, jobMode = 'review';
  let runnerName = '', runnerKind = 'command', runnerCommand = '', runnerPrompt = '', runnerAuthor = '', runnerCommunity = '', runnerInterval = 1800, runnerDays = [1, 2, 3, 4, 5, 6, 7], runnerPriority = 100, runnerTimeout = 900, runnerAttempts = 3, runnerBackoff = 60, runnerThreshold = 3, runnerRetention = 30, runnerEnvironmentKeys = '', runnerCaptureOutput = true, runnerMaxLogBytes = 20000, editingRunner = null;
  let drawExecutable = 'draw-things-cli', drawModelsDir = '', drawModel = '', drawWidth = 1024, drawHeight = 1024, drawSteps = 4, drawCfg = '', drawSeed = '', drawLoras = '[]', drawOutputPath = '', drawPostsPerRun = 1, drawTitlePrefix = 'Draw Things generation';
  let crossAccounts = '', crossTopics = '', crossQueries = '', crossHours = 24, crossLimit = 8, crossPerSource = 50, crossStartTime = '', crossEndTime = '', crossIncludeReplies = false, crossIncludeRetweets = false;
  let search = '', level = '', kind = 'posts', cursors = [], before = null, paused = false, refreshed = null, busy = false, security = null, blockIp = '', blockReason = '', blockExpiry = '';
  let runnerEditorOpen = false, runnerFilter = 'all', runnerSearch = '', runnerFormError = '';
  let generation = 0, authState = 'signed_out', authError = '';
  const number = value => new Intl.NumberFormat().format(value ?? 0);
  const date = value => value ? new Date(value).toLocaleString() : '—';
  const size = value => {
    if (value == null) return '—';
    const bytes = Number(value);
    if (!Number.isFinite(bytes)) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let index = 0, scaled = Math.max(0, bytes);
    while (scaled >= 1024 && index < units.length - 1) { scaled /= 1024; index += 1; }
    return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  };
  const accessTone = value => Number(value) >= 500 ? 'danger' : Number(value) >= 400 ? 'warning' : 'positive';
  const runnerKinds = { draw_things: 'Draw Things', command: 'Command runner', cross_post: 'Cross-post adapter' };
  const runnerKindDescriptions = { draw_things: 'Generate images on this host', command: 'Run an allow-listed command', cross_post: 'Collect public X posts into a bounded batch' };
  const runnerTemplates = [
    { key: 'smoke', kind: 'command', name: 'Safe smoke test', description: 'A deterministic single post that proves the worker, command runner, and dry-run receipt are connected.', command: ['node', 'scripts/runner-starter.mjs', '--template', 'smoke'], prompt: 'Replace this with your own test note.', interval: 86400 },
    { key: 'prompt', kind: 'command', name: 'Prompt draft', description: 'Passes the configured prompt into a simple post-shaped receipt so you can validate your prompt workflow before adding an AI tool.', command: ['node', 'scripts/runner-starter.mjs', '--template', 'prompt'], prompt: 'Write a concise daily note for this community.', interval: 86400 },
    { key: 'batch', kind: 'command', name: 'Bounded batch', description: 'Emits two posts in one execution to verify batch handling, limits, structured history, and dry-run previews.', command: ['node', 'scripts/runner-starter.mjs', '--template', 'batch'], prompt: 'Generate a two-item test batch.', interval: 604800 },
    { key: 'x-window', kind: 'cross_post', name: 'X topic window', description: 'Collects public posts from multiple accounts and/or topics from the last day, deduplicates them, and caps the batch at eight.', command: ['node', 'scripts/x-cross-post-runner.mjs', '--hours', '24', '--limit', '8', '--per-source', '50'], prompt: 'Cross-post the strongest public X posts for this window.', interval: 21600, environmentKeys: 'X_BEARER_TOKEN' },
    { key: 'draw-things', kind: 'draw_things', name: 'Draw Things dynamic image', description: 'Uses the local Draw Things CLI and expands date, community, runner, and variant tokens before generation. Blank CFG preserves the model’s recommended guidance.', command: { executable: 'draw-things-cli', model: 'flux_1_schnell_q5p.ckpt', width: 1024, height: 1024, steps: 4, cfg: null, seed: null, loras: [], posts_per_run: 1, output_path: '~/Library/Application Support/Swartzit/generated/draw-{runner_id}-{timestamp}-{index}.png', title_prefix: 'Draw Things · dynamic prompt' }, prompt: 'Editorial illustration for {community}: a thoughtful local scene inspired by {weekday}, {date}.', interval: 86400 },
    { key: 'draw-things-variants', kind: 'draw_things', name: 'Draw Things variants', description: 'Generates two deterministic prompt variants per run so you can compare output, timing, and memory pressure before enabling it.', command: { executable: 'draw-things-cli', model: 'flux_1_schnell_q5p.ckpt', width: 1024, height: 1024, steps: 4, cfg: null, seed: 42, loras: [], posts_per_run: 2, output_path: '~/Library/Application Support/Swartzit/generated/variant-{runner_id}-{timestamp}-{index}.png', title_prefix: 'Draw Things · variant' }, prompt: 'A clean editorial illustration for {community}; variant {index} of {total}; runner {runner}; {date}.', interval: 604800 },
    { key: 'draw-things-lora', kind: 'draw_things', name: 'Draw Things designer LoRA', description: 'A disabled Dev-model recipe showing the exact LoRA file, flux1 version, weight, seed, and long-form settings used for designer experiments.', command: { executable: 'draw-things-cli', model: 'flux_1_dev_q8p.ckpt', width: 1024, height: 1024, steps: 28, cfg: 3.5, seed: 123, loras: [{ file: 'flux_alexandra_daddario_lora_f16.ckpt', version: 'flux1', weight: 0.8 }], posts_per_run: 1, output_path: '~/DrawThings/bombshell_iterations/draw-{runner_id}-{timestamp}.png', title_prefix: 'Draw Things · designer LoRA' }, prompt: 'A realistic webcam-style bedroom photo of an adult person sitting on a bed, in a modern popular outfit, natural lighting.', interval: 604800 }
  ];
  const runnerStates = { enabled: 'Enabled', retrying: 'Retrying', running: 'Running', paused: 'Paused', draft: 'Draft', archived: 'Archived' };
  const runnerKindLabel = value => runnerKinds[value] ?? value ?? 'Runner';
  const runnerStateLabel = value => runnerStates[value] ?? value ?? 'Unknown';
  const runnerStateTone = value => ['enabled', 'running'].includes(value) ? 'positive' : ['retrying', 'paused'].includes(value) ? 'warning' : value === 'archived' ? 'neutral' : 'accent';
  const runStateTone = value => ['success', 'completed'].includes(value) ? 'positive' : ['failed', 'error'].includes(value) ? 'danger' : ['running', 'claimed', 'retrying'].includes(value) ? 'warning' : 'neutral';
  const runStateLabel = value => value ? value.replaceAll('_', ' ') : 'Never run';
  function durationLabel(value) {
    const seconds = Math.max(0, Math.round(Number(value) || 0));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    if (minutes < 60) return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const minuteRemainder = minutes % 60;
    return minuteRemainder ? `${hours}h ${minuteRemainder}m` : `${hours}h`;
  }
  function progressPercent(run) {
    const value = Number(run?.progress_percent);
    return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;
  }
  function elapsedSeconds(run) {
    if (!run?.started_at) return null;
    if (run.duration_ms != null && run.finished_at) return Math.max(0, Math.round(Number(run.duration_ms) / 1000));
    const started = new Date(run.started_at).getTime();
    if (!Number.isFinite(started)) return null;
    const ended = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
    return Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : null;
  }
  function progressPhase(run) { return run?.progress_phase ? run.progress_phase.replaceAll('_', ' ') : ''; }
  function progressDetail(run) {
    if (!run) return '';
    const parts = [];
    const phase = progressPhase(run);
    if (phase) parts.push(phase);
    if (run.current_step != null && run.total_steps != null && Number(run.total_steps) > 0) parts.push(`step ${run.current_step}/${run.total_steps}`);
    if (run.eta_seconds != null && run.status === 'running') parts.push(run.eta_seconds > 0 ? `~${durationLabel(run.eta_seconds)} left` : 'finishing');
    const elapsed = elapsedSeconds(run);
    if (elapsed != null) parts.push(`elapsed ${durationLabel(elapsed)}`);
    return parts.join(' · ');
  }
  function progressLabel(run) {
    const percent = progressPercent(run);
    if (percent == null) return run?.status === 'running' ? 'Running' : runStateLabel(run?.status);
    return `${percent}%${progressPhase(run) ? ` · ${progressPhase(run)}` : ''}`;
  }
  const compactDate = value => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
  function intervalLabel(seconds) {
    const value = Number(seconds || 0);
    if (!value) return 'Not scheduled';
    if (value % 86400 === 0) return `Every ${value / 86400} day${value / 86400 === 1 ? '' : 's'}`;
    if (value % 3600 === 0) return `Every ${value / 3600} hour${value / 3600 === 1 ? '' : 's'}`;
    return `Every ${Math.round(value / 60)} min`;
  }
  function daysLabel(days) {
    if (!Array.isArray(days) || days.length === 0 || days.length === 7) return 'Every day';
    return days.map(day => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1]).filter(Boolean).join(' · ');
  }
  function runnerRecipeLabel(runner) {
    const config = runner.command && typeof runner.command === 'object' && !Array.isArray(runner.command) ? runner.command : {};
    if (runner.kind === 'draw_things') return config.model || 'Model not configured';
    if (runner.kind === 'cross_post') return 'X public API';
    return Array.isArray(runner.command) && runner.command.length ? String(runner.command[0]) : 'Command not configured';
  }
  function runnerRecipeDetail(runner) {
    const config = runner.command && typeof runner.command === 'object' && !Array.isArray(runner.command) ? runner.command : {};
    if (runner.kind === 'draw_things') {
      const dimensions = config.width && config.height ? `${config.width}×${config.height}` : 'size not set';
      const steps = config.steps ? `${config.steps} steps` : 'steps not set';
      const guidance = config.cfg == null || config.cfg === '' ? 'CFG recommended' : `CFG ${config.cfg}`;
      const loraCount = Array.isArray(config.loras) ? config.loras.length : 0;
      const lora = loraCount ? `${loraCount} LoRA${loraCount === 1 ? '' : 's'}` : 'No LoRA';
      const variants = Number(config.posts_per_run || 1) > 1 ? `${config.posts_per_run} variants` : '1 variant';
      return [dimensions, steps, guidance, lora, variants].join(' · ');
    }
    if (runner.kind === 'cross_post') return 'Bounded X source window · worker-side token';
    return Array.isArray(runner.command) ? runner.command.slice(1, 4).join(' ') || 'No arguments' : 'No command arguments';
  }
  function runnerPromptText(runner) { return String(runner.prompt || '').trim() || 'No prompt configured'; }
  function latestRun(runner) { return runner.latest_run ?? {}; }
  function latestRunLabel(runner) { return runStateLabel(latestRun(runner).status || runner.last_status); }
  function latestRunDate(runner) { return latestRun(runner).finished_at || latestRun(runner).started_at || runner.last_run_at; }
  function runnerRuntimeState(runner) {
    const latest = latestRun(runner);
    if (latest.status === 'running') return { label: latest.dry_run ? `Test ${progressPercent(latest) == null ? 'running' : progressPercent(latest) + '%'}` : progressPercent(latest) == null ? 'Running now' : `Running ${progressPercent(latest)}%`, tone: 'positive', detail: progressDetail(latest) || 'Worker claimed this execution' };
    if (runner.test_requested) return { label: 'Test queued', tone: 'warning', detail: 'Waiting for the worker to claim it' };
    if (runner.state === 'retrying') return { label: 'Retrying', tone: 'warning', detail: runner.last_error || 'Waiting for the next attempt' };
    if (latest.status) return { label: runStateLabel(latest.status), tone: runStateTone(latest.status), detail: runner.last_error || 'Latest execution completed' };
    return { label: runnerStateLabel(runner.state), tone: runnerStateTone(runner.state), detail: runner.state === 'enabled' ? 'Schedule is active' : 'No execution yet' };
  }
  function runnerIsRunning(runner) { return latestRun(runner).status === 'running'; }
  function openNewRunner() { resetRunnerForm(); runnerFormError = ''; runnerEditorOpen = true; }
  function closeRunnerEditor() { resetRunnerForm(); runnerFormError = ''; runnerEditorOpen = false; }
  function templateCommandLabel(template) { return template.kind === 'draw_things' ? `${template.command.executable} generate --model ${template.command.model} --prompt "…"` : template.command.join(' '); }
  function commandOptions(command, name) { const values = []; for (let index = 0; index < command.length; index += 1) if (command[index] === name && command[index + 1] !== undefined) values.push(command[index + 1]); return values; }
  function localDateTime(value) { if (!value) return ''; const dateValue = new Date(value); return Number.isNaN(dateValue.getTime()) ? '' : new Date(dateValue.getTime() + dateValue.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function crossPostCommand() { const command = ['node', 'scripts/x-cross-post-runner.mjs']; if (crossAccounts.trim()) command.push('--accounts', crossAccounts.trim()); if (crossTopics.trim()) command.push('--topics', crossTopics.trim()); if (crossQueries.trim()) command.push('--query', crossQueries.trim()); if (crossStartTime) command.push('--start-time', new Date(crossStartTime).toISOString()); else command.push('--hours', String(Number(crossHours))); if (crossEndTime) command.push('--end-time', new Date(crossEndTime).toISOString()); command.push('--limit', String(Number(crossLimit)), '--per-source', String(Number(crossPerSource))); if (crossIncludeReplies) command.push('--include-replies'); if (crossIncludeRetweets) command.push('--include-retweets'); return command; }
  function loadCrossPostCommand(command) { const values = Array.isArray(command) ? command : []; crossAccounts = commandOptions(values, '--accounts')[0] || ''; crossTopics = commandOptions(values, '--topics')[0] || ''; crossQueries = commandOptions(values, '--query').join('\n'); crossHours = Number(commandOptions(values, '--hours')[0] || 24); crossLimit = Number(commandOptions(values, '--limit')[0] || 8); crossPerSource = Number(commandOptions(values, '--per-source')[0] || 50); crossStartTime = localDateTime(commandOptions(values, '--start-time')[0]); crossEndTime = localDateTime(commandOptions(values, '--end-time')[0]); crossIncludeReplies = values.includes('--include-replies'); crossIncludeRetweets = values.includes('--include-retweets'); }
  function useRunnerTemplate(template) { resetRunnerForm(); runnerFormError = ''; runnerEditorOpen = true; runnerKind = template.kind || 'command'; runnerName = template.name; runnerPrompt = template.prompt; runnerInterval = template.interval; runnerEnvironmentKeys = template.environmentKeys || ''; if (template.kind === 'draw_things') { drawExecutable = template.command.executable; drawModelsDir = template.command.models_dir || ''; drawModel = template.command.model; drawWidth = template.command.width; drawHeight = template.command.height; drawSteps = template.command.steps; drawCfg = template.command.cfg; drawSeed = template.command.seed == null ? '' : template.command.seed; drawLoras = JSON.stringify(template.command.loras || [], null, 2); drawOutputPath = template.command.output_path || ''; drawPostsPerRun = template.command.posts_per_run; drawTitlePrefix = template.command.title_prefix || 'Draw Things generation'; } else if (template.kind === 'cross_post') { loadCrossPostCommand(template.command); } else { runnerCommand = JSON.stringify(template.command); } }
  function duplicateRunner(runner) { editRunner(runner); editingRunner = null; runnerName = `${runner.name} copy`; runnerFormError = ''; }
  $: visibleRunners = runners.filter(runner => {
    const matchesFilter = runnerFilter === 'all' || runner.state === runnerFilter;
    const query = runnerSearch.trim().toLowerCase();
    const matchesSearch = !query || [runner.name, runner.author, runner.community, runner.kind].some(value => String(value ?? '').toLowerCase().includes(query));
    return matchesFilter && matchesSearch;
  });
  $: enabledRunnerCount = runners.filter(runner => ['enabled', 'running', 'retrying'].includes(runner.state)).length;
  $: runningRunnerCount = runners.filter(runnerIsRunning).length;
  $: attentionRunnerCount = runners.filter(runner => ['retrying', 'paused'].includes(runner.state) || runner.last_error).length;
  $: nextRunner = runners.filter(runner => runner.next_run_at && runner.state !== 'archived').sort((a, b) => new Date(a.next_run_at) - new Date(b.next_run_at))[0];
  async function api(path, method = 'GET', body) {
    const token = localStorage.getItem('swartzit_session');
    if (!token) throw new Error('Sign in with an administrator account to continue.');
    const response = await fetch('/api/admin/' + path, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
      if (response.status === 401) { localStorage.removeItem('swartzit_session'); authState = 'signed_out'; }
      if (response.status === 403) authState = 'forbidden';
      throw new Error((await response.json().catch(() => ({}))).error ?? 'Request failed');
    }
    return response.status === 204 ? null : response.json();
  }
  async function establishAdminSession() {
    const token = localStorage.getItem('swartzit_session');
    if (!token) { authState = 'signed_out'; loading = false; return; }
    authState = 'checking';
    try {
      const response = await fetch('/api/me', { headers: { authorization: 'Bearer ' + token } });
      if (response.status === 401) {
        localStorage.removeItem('swartzit_session');
        authState = 'signed_out';
        loading = false;
        return;
      }
      if (!response.ok) throw new Error('Unable to verify your session.');
      const user = await response.json();
      if (!user.is_admin) { authState = 'forbidden'; loading = false; return; }
      authState = 'authenticated';
      await refresh();
    } catch (e) {
      authState = 'error';
      authError = e.message;
      loading = false;
    }
  }
  async function refresh() {
    const version = ++generation;
    try {
      const params = new URLSearchParams({ q: search, level, kind });
      if (before) params.set('before', before);
      const endpoint = { Users: 'users', Content: 'content', Reports: 'reports', Moderation: 'moderation', Logs: 'logs' }[tab];
      const [stats, storageData, items, daily, scheduled, history, runnerData, runnerLogData, securityData, uptimeData, settingsData, moderationHistoryData] = await Promise.all([
        api('overview'), tab === 'Settings' || tab === 'Server' ? api('storage') : Promise.resolve(null), endpoint ? api(endpoint + '?' + params) : Promise.resolve([]),
        tab === 'Analytics' ? api('analytics') : Promise.resolve([]),
        tab === 'Crawler Jobs' ? api('crawler-jobs') : Promise.resolve([]),
        tab === 'Crawler Jobs' ? api('crawler-runs') : Promise.resolve([]),
        tab === 'Content Runners' ? api('content-runners') : Promise.resolve([]),
        tab === 'Content Runners' ? api('content-runner-runs') : Promise.resolve([]),
        tab === 'Security' ? api('security') : Promise.resolve(null),
        tab === 'Settings' ? api('uptime') : Promise.resolve(null),
        tab === 'Settings' || tab === 'Content Runners' || tab === 'Moderation' ? api('settings') : Promise.resolve(null),
        tab === 'Moderation' ? api('moderation-history') : Promise.resolve([])
      ]);
      if (version !== generation) return;
      overview = stats; storage = storageData; rows = items; trend = daily; jobs = scheduled; runs = history; runners = runnerData; runnerRuns = runnerLogData; moderationHistory = tab === 'Moderation' ? moderationHistoryData : []; security = tab === 'Security' ? securityData : null; uptime = tab === 'Settings' ? uptimeData : null; settings = ['Settings', 'Content Runners', 'Moderation'].includes(tab) ? settingsData : null; error = ''; refreshed = new Date();
    } catch (e) { if (version === generation) { error = e.message; overview = null; storage = null; rows = []; trend = []; jobs = []; runs = []; runners = []; runnerRuns = []; moderationHistory = []; uptime = null; settings = null; } }
    finally { if (version === generation) loading = false; }
  }
  function selectTab(next) {
    tab = next; search = ''; level = ''; kind = next === 'Moderation' ? '' : 'posts'; before = null; cursors = []; rows = []; notice = ''; loading = true;
    if (next !== 'Content Runners') closeRunnerEditor();
    history.replaceState(null, '', '/admin?tab=' + next.toLowerCase());
    refresh();
  }
  function filter() { before = null; cursors = []; loading = true; refresh(); }
  function next() { cursors = [...cursors, before]; before = rows.at(-1).id; refresh(); }
  function previous() { before = cursors.at(-1); cursors = cursors.slice(0, -1); refresh(); }
  async function action(path, question, method = 'POST') {
    if (!window.confirm(question)) return;
    busy = true; notice = '';
    try { await api(path, method); notice = 'Change saved and recorded in the operational log.'; await refresh(); }
    catch (e) { notice = e.message; } finally { busy = false; }
  }
  async function createJob(event) {
    event.preventDefault(); busy = true; notice = '';
    try {
      await api('crawler-jobs', 'POST', { name: jobName, provider: jobProvider, source: jobSource, community: jobCommunity || null, interval_seconds: Number(jobInterval), max_items: Number(jobMax), mode: jobMode, filters: {} });
      notice = 'Crawler job created. The worker will run it when enabled.';
      jobName = ''; jobSource = ''; jobCommunity = ''; await refresh();
    } catch (e) { notice = e.message; } finally { busy = false; }
  }
  async function blockAddress(event) {
    event.preventDefault(); busy = true; notice = '';
    try { await api('security', 'POST', { ip: blockIp, reason: blockReason, expires_at: blockExpiry ? new Date(blockExpiry).toISOString() : null }); notice = 'Address blocked. The event was recorded without storing the raw address.'; blockIp = ''; blockReason = ''; blockExpiry = ''; await refresh(); }
    catch (e) { notice = e.message; } finally { busy = false; }
  }
  async function removeJob(id) {
    if (!window.confirm('Delete this crawler job and its run history?')) return;
    busy = true; notice = '';
    try { await api('crawler-jobs/' + id, 'DELETE'); notice = 'Crawler job deleted.'; await refresh(); }
    catch (e) { notice = e.message; } finally { busy = false; }
  }
  async function toggleOrchard(enabled) {
    busy = true; notice = '';
    try {
      await api('settings', 'POST', { orchard_enabled: enabled });
      notice = enabled ? 'Orchard integration enabled.' : 'Orchard integration disabled. Orchard was not uninstalled.';
      await refresh();
    } catch (e) { notice = e.message; }
    finally { busy = false; }
  }
  async function toggleRunners(enabled) { busy = true; notice = ''; try { await api('settings', 'POST', { content_runners_enabled: enabled }); notice = enabled ? 'Content runners enabled.' : 'Content runners disabled.'; await refresh(); } catch (e) { notice = e.message; } finally { busy = false; } }
  async function toggleModeration(enabled) { busy = true; notice = ''; try { await api('settings', 'POST', { moderation_enabled: enabled }); notice = enabled ? 'Publication moderation enabled for posts and comments.' : 'Publication moderation disabled. Posts and comments publish immediately; profile changes always publish immediately.'; await refresh(); } catch (e) { notice = e.message; } finally { busy = false; } }
  async function updateMediaSettings(body, message = 'Media storage settings saved.') { busy = true; notice = ''; try { await api('settings', 'POST', body); notice = message; await refresh(); } catch (e) { notice = e.message; } finally { busy = false; } }
  async function mediaAction(path, question) { await action(path, question); }
  function parseCommand(value) { const command = value.trim().startsWith('[') ? JSON.parse(value) : value.trim().split(/\s+/); if (!Array.isArray(command) || !command.length || command.some(item => typeof item !== 'string')) throw new Error('Command must be a JSON argv array, for example ["draw-things-cli","generate"]'); return command; }
  function parseLoras(value) { const loras = JSON.parse(value || '[]'); if (!Array.isArray(loras)) throw new Error('LoRAs must be a JSON array, for example [{"file":"style.ckpt","version":"flux1","weight":0.8}]'); return loras; }
  function drawCommand() { return { executable: drawExecutable.trim(), models_dir: drawModelsDir.trim() || undefined, model: drawModel.trim(), width: Number(drawWidth), height: Number(drawHeight), steps: Number(drawSteps), ...(drawCfg === '' || drawCfg == null ? {} : { cfg: Number(drawCfg) }), seed: drawSeed === '' ? null : Number(drawSeed), loras: parseLoras(drawLoras), output_path: drawOutputPath.trim() || undefined, posts_per_run: Number(drawPostsPerRun), title_prefix: drawTitlePrefix.trim() || undefined }; }
  function runnerPayload(source) { return { name: source.name, kind: source.kind, command: source.kind === 'draw_things' ? drawCommand() : source.kind === 'cross_post' ? crossPostCommand() : parseCommand(source.command), prompt: source.prompt, author: source.author, community: source.community, interval_seconds: Number(source.interval), days_of_week: runnerDays, priority: Number(source.priority), timeout_seconds: Number(source.timeout), max_attempts: Number(source.attempts), retry_backoff_seconds: Number(source.backoff), failure_threshold: Number(source.threshold), retention_days: Number(source.retention), environment_keys: source.environmentKeys.split(',').map(value => value.trim()).filter(Boolean), capture_output: source.captureOutput, max_log_bytes: Number(source.maxLogBytes) }; }
  function resetRunnerForm() { runnerName = ''; runnerKind = 'command'; runnerCommand = ''; runnerPrompt = ''; runnerAuthor = ''; runnerCommunity = ''; runnerInterval = 1800; runnerDays = [1, 2, 3, 4, 5, 6, 7]; runnerPriority = 100; runnerTimeout = 900; runnerAttempts = 3; runnerBackoff = 60; runnerThreshold = 3; runnerRetention = 30; runnerEnvironmentKeys = ''; runnerCaptureOutput = true; runnerMaxLogBytes = 20000; crossAccounts = ''; crossTopics = ''; crossQueries = ''; crossHours = 24; crossLimit = 8; crossPerSource = 50; crossStartTime = ''; crossEndTime = ''; crossIncludeReplies = false; crossIncludeRetweets = false; drawExecutable = 'draw-things-cli'; drawModelsDir = ''; drawModel = ''; drawWidth = 1024; drawHeight = 1024; drawSteps = 4; drawCfg = ''; drawSeed = ''; drawLoras = '[]'; drawOutputPath = ''; drawPostsPerRun = 1; drawTitlePrefix = 'Draw Things generation'; editingRunner = null; }
  async function saveRunner(event) { event.preventDefault(); busy = true; notice = ''; runnerFormError = ''; const testAfterSave = event.submitter?.value === 'test'; const wasEditing = Boolean(editingRunner); const source = { name: runnerName, kind: runnerKind, command: runnerCommand, prompt: runnerPrompt, author: runnerAuthor, community: runnerCommunity, interval: runnerInterval, priority: runnerPriority, timeout: runnerTimeout, attempts: runnerAttempts, backoff: runnerBackoff, threshold: runnerThreshold, retention: runnerRetention, environmentKeys: runnerEnvironmentKeys, captureOutput: runnerCaptureOutput, maxLogBytes: runnerMaxLogBytes }; let savedRunner; try { savedRunner = await api(editingRunner ? 'content-runners/' + editingRunner.id : 'content-runners', 'POST', runnerPayload(source)); } catch (e) { runnerFormError = e.message || 'The runner could not be saved.'; busy = false; return; } if (testAfterSave) { try { await api('content-runners/' + (savedRunner?.id ?? editingRunner?.id) + '/test', 'POST'); } catch (e) { resetRunnerForm(); runnerEditorOpen = false; notice = `Runner saved, but the no-publish test could not be queued: ${e.message || 'unknown error'}`; await refresh(); busy = false; return; } notice = wasEditing ? 'Saved and queued a no-publish test. Watch the runner card for Test queued → Test running → Success.' : 'Saved as a draft and queued a no-publish test. Watch the runner card for Test queued → Test running → Success.'; } else { notice = wasEditing ? 'Runner configuration updated.' : 'Runner saved as a draft. Test it before enabling the schedule.'; } resetRunnerForm(); runnerEditorOpen = false; await refresh(); busy = false; }
  function editRunner(runner) { editingRunner = runner; runnerFormError = ''; runnerEditorOpen = true; runnerName = runner.name; runnerKind = runner.kind; runnerCommand = runner.kind === 'draw_things' || runner.kind === 'cross_post' ? '' : JSON.stringify(runner.command); runnerPrompt = runner.prompt; runnerAuthor = runner.author; runnerCommunity = runner.community; runnerInterval = runner.interval_seconds; runnerDays = Array.isArray(runner.days_of_week) && runner.days_of_week.length ? runner.days_of_week : [1, 2, 3, 4, 5, 6, 7]; runnerPriority = runner.priority; runnerTimeout = runner.timeout_seconds; runnerAttempts = runner.max_attempts; runnerBackoff = runner.retry_backoff_seconds; runnerThreshold = runner.failure_threshold; runnerRetention = runner.retention_days; runnerEnvironmentKeys = (runner.environment_keys || []).join(', '); runnerCaptureOutput = runner.capture_output !== false; runnerMaxLogBytes = runner.max_log_bytes || 20000; if (runner.kind === 'draw_things') { const config = runner.command || {}; drawExecutable = config.executable || 'draw-things-cli'; drawModelsDir = config.models_dir || ''; drawModel = config.model || ''; drawWidth = config.width || 1024; drawHeight = config.height || 1024; drawSteps = config.steps || 4; drawCfg = config.cfg ?? ''; drawSeed = config.seed == null ? '' : config.seed; drawLoras = JSON.stringify(config.loras || [], null, 2); drawOutputPath = config.output_path || ''; drawPostsPerRun = config.posts_per_run || 1; drawTitlePrefix = config.title_prefix || 'Draw Things generation'; } else if (runner.kind === 'cross_post') loadCrossPostCommand(runner.command); }
  function toggleRunnerDay(day, event) { runnerDays = event.currentTarget.checked ? [...new Set([...runnerDays, day])].sort((a, b) => a - b) : runnerDays.filter(value => value !== day); }
  async function testRunner(id) { busy = true; notice = ''; runnerFormError = ''; try { await api('content-runners/' + id + '/test', 'POST'); notice = 'No-publish test queued. The runner card will update as the worker claims and completes it.'; await refresh(); } catch (e) { notice = e.message; } finally { busy = false; } }
  function logsFor(id) { return runnerRuns.filter(run => run.runner_id === id).slice(0, 10); }
  async function moderationAction(id, decision) {
    const labels = { approve: 'Approve and publish this item?', reject: 'Reject and keep this item hidden?', dismiss: 'Dismiss the flags and publish this item?', suspend: 'Reject this item and suspend the author for 24 hours?', escalate: 'Escalate this item for urgent review?' };
    if (!window.confirm(labels[decision])) return;
    busy = true; notice = '';
    try {
      await api('moderation/' + id, 'POST', { action: decision, duration_minutes: decision === 'suspend' ? 1440 : undefined });
      notice = decision === 'escalate' ? 'Item escalated for urgent human review.' : 'Moderation decision saved and audited.';
      await refresh();
    } catch (e) { notice = e.message; } finally { busy = false; }
  }
  async function copyOrchardInstall() {
    try {
      await navigator.clipboard.writeText('brew install orchard');
      notice = 'Copied the Orchard Homebrew command.';
    } catch {
      notice = 'Copy unavailable. Run: brew install orchard';
    }
  }
  onMount(() => {
    const requested = new URLSearchParams(location.search).get('tab');
    tab = tabs.find(t => t.toLowerCase() === requested) ?? 'Overview';
    if (tab === 'Moderation') kind = '';
    establishAdminSession();
    let timer;
    const poll = () => {
      timer = setTimeout(() => {
        if (authState === 'authenticated' && !paused && !loading && !busy && !document.hidden) refresh();
        poll();
      }, tab === 'Content Runners' ? 5000 : 10000);
    };
    poll();
    return () => { clearTimeout(timer); generation++; };
  });
</script>

<svelte:head><title>Administration · Swartzit</title></svelte:head>
{#if authState !== 'authenticated'}
  <header><a class="brand" href="/">swartzit</a><span>Instance administration</span></header>
  <main class="auth admin-auth" aria-live="polite">
    {#if authState === 'checking'}
      <p role="status">Checking administrator access…</p>
    {:else if authState === 'forbidden'}
      <p class="eyebrow">ADMINISTRATION</p><h1>Administrator access required</h1>
      <p class="lede">You’re signed in, but this account does not have permission to open the control room.</p>
      <p><a href="/">Return to Swartzit →</a> · <a href="/logout">Sign out</a></p>
    {:else if authState === 'error'}
      <p class="eyebrow">ADMINISTRATION</p><h1>We couldn’t verify your session</h1>
      <p class="lede">{authError}</p><p><a href="/login?next=%2Fadmin">Try signing in again →</a></p>
    {:else}
      <p class="eyebrow">ADMINISTRATION</p><h1>Sign in to continue</h1>
      <p class="lede">The Swartzit control room is only available to signed-in administrators.</p>
      <p><a class="admin-sign-in" href="/login?next=%2Fadmin">Sign in to admin →</a></p>
    {/if}
  </main>
{:else}
<header><a class="brand" href="/">swartzit</a><span>Instance administration</span><SessionNav /></header>
<main class="admin">
  <div class="admin-heading"><div><p class="eyebrow">YOUR COMMUNITY, YOUR INSTANCE</p><h1>Control room</h1><p class="muted">People, conversations, and the services that keep them connected.</p></div>
    <div class="refresh-controls"><button onclick={() => { paused = !paused; }}>{paused ? 'Resume live updates' : 'Pause live updates'}</button><button onclick={refresh}>Refresh</button><small>{refreshed ? 'Updated ' + refreshed.toLocaleTimeString() : 'Connecting…'}</small></div>
  </div>
  <nav class="admin-tabs" aria-label="Administration sections">{#each tabs as item}<button class:active={tab === item} aria-current={tab === item ? 'page' : undefined} onclick={() => selectTab(item)}>{item}</button>{/each}</nav>
  {#if notice}<p class="admin-notice" role="status">{notice}</p>{/if}
  {#if error}<div class="panel" role="alert"><h2>Unable to load this view</h2><p>{error}</p><a href="/login">Sign in</a> · <button onclick={refresh}>Retry</button></div>
  {:else if loading || !overview}<p role="status">Loading {tab.toLowerCase()}…</p>
  {:else}
    <div class="section-heading"><h2>{tab}</h2><span class="muted">{paused ? 'Live updates paused' : 'Live · updates every 10 seconds'}</span></div>
    {#if tab === 'Overview'}
      <section class="metrics">
        <div><span>Registered users</span><strong>{number(overview.users)}</strong><small>Excludes demo identities</small></div>
        <div><span>Discussions</span><strong>{number(overview.posts)}</strong><small>Across {overview.communities} communities</small></div>
        <div><span>Comments</span><strong>{number(overview.comments)}</strong><small>Public conversation</small></div>
        <div><span>Open reports</span><strong>{number(overview.open_reports)}</strong><button onclick={() => selectTab('Reports')}>Review reports →</button></div>
        <div><span>Moderation queue</span><strong>{number(overview.pending_moderation)}</strong><small>Pending or escalated</small><button onclick={() => selectTab('Moderation')}>Review queue →</button></div>
      </section>
      <div class="admin-columns"><section class="panel"><h3>Instance pulse</h3><dl><dt>API requests since restart</dt><dd>{number(overview.runtime.requests)}</dd><dt>Server errors since restart</dt><dd>{number(overview.runtime.server_errors)}</dd><dt>Database size</dt><dd>{size(overview.database_size_bytes)}</dd><dt>API started</dt><dd>{date(overview.started_at)}</dd></dl><button onclick={() => selectTab('Server')}>Inspect server →</button></section>
      <section class="panel"><h3>Administration</h3><p>Browse accounts, review new submissions, resolve reports, inspect public content, or investigate recent requests.</p><p class="muted">Role changes and password recovery remain host-side commands. Moderation decisions are human-reviewed and audited.</p><button onclick={() => selectTab('Logs')}>Open log explorer →</button></section></div>
    {:else if tab === 'Imports'}
      <ImportPanel />
    {:else if tab === 'Crawler Jobs'}
      <section class="panel">
        <h3>Scheduled collectors</h3>
        <p class="muted">Jobs define what the server worker is allowed to collect. Provider credentials stay in the server environment; this panel stores no tokens.</p>
        <form class="admin-toolbar" onsubmit={createJob}>
          <input aria-label="Job name" placeholder="Job name" bind:value={jobName} required maxlength="80" />
          <select aria-label="Provider" bind:value={jobProvider}><option value="reddit">Reddit</option><option value="x">X</option><option value="rss">RSS</option><option value="commons">Commons</option></select>
          <input aria-label="Source" placeholder="Source URL or feed identifier" bind:value={jobSource} required maxlength="2048" />
          <input aria-label="Community" placeholder="Community slug" bind:value={jobCommunity} maxlength="40" />
          <label>Every <input aria-label="Interval seconds" type="number" min="300" max="604800" step="300" bind:value={jobInterval} /> sec</label>
          <label>Up to <input aria-label="Maximum items" type="number" min="1" max="100" bind:value={jobMax} /> posts</label>
          <select aria-label="Moderation mode" bind:value={jobMode}><option value="review">Review queue</option><option value="automatic">Automatic</option></select>
          <button disabled={busy}>Add job</button>
        </form>
      </section>
      <div class="panel table-wrap">
        {#if jobs.length === 0}<div class="admin-empty"><h3>No crawler jobs</h3><p>Add a source above, then configure provider credentials on the server.</p></div>
        {:else}<table><thead><tr><th>Job</th><th>Source</th><th>Schedule</th><th>Status</th><th>Actions</th></tr></thead><tbody>{#each jobs as job}<tr><td><strong>{job.name}</strong><small>{job.provider} · {job.mode}</small></td><td>{job.source}<small>{job.community ? '→ c/' + job.community : 'No destination community'}</small></td><td>Every {Math.round(job.interval_seconds / 60)} min<small>Next {date(job.next_run_at)}</small></td><td><span class="badge">{job.enabled ? job.last_status : 'paused'}</span>{#if job.latest_run}<small>{job.latest_run.imported_count} imported · {date(job.latest_run.finished_at || job.latest_run.started_at)}</small>{/if}{#if job.last_error}<small>{job.last_error}</small>{/if}</td><td><button disabled={busy} onclick={() => action('crawler-jobs/' + job.id + '/run-now', 'Queue this crawler job immediately?')}>Run now</button><button disabled={busy} onclick={() => action('crawler-jobs/' + job.id + '/toggle', (job.enabled ? 'Pause' : 'Enable') + ' this crawler job?')}>{job.enabled ? 'Pause' : 'Enable'}</button><button disabled={busy} onclick={() => removeJob(job.id)}>Delete</button></td></tr>{/each}</tbody></table>{/if}
      </div>
      {#if runs.length}<section class="panel table-wrap crawler-history"><h3>Recent run history</h3><p class="muted">The worker records every claim, import count, and provider error. Newest first.</p><table><thead><tr><th>Job</th><th>Started</th><th>Finished</th><th>Status</th><th>Imported</th><th>Error</th></tr></thead><tbody>{#each runs.slice(0, 25) as run}<tr><td><strong>{run.name}</strong><small>Run #{run.id}</small></td><td>{date(run.started_at)}</td><td>{date(run.finished_at)}</td><td><span class={'badge ' + run.status}>{run.status}</span></td><td>{number(run.imported_count)}</td><td>{run.error ?? '—'}</td></tr>{/each}</tbody></table></section>{/if}
    {:else if tab === 'Content Runners'}
      <div class="runner-page">
        <section class="runner-hero">
          <div class="runner-hero-copy">
            <div class="runner-kicker"><span class:online={settings?.modules?.content_runners?.enabled === true} class="runner-status-dot"></span>{settings?.modules?.content_runners?.enabled === true ? 'Module enabled' : 'Module disabled'}</div>
            <h2>Scheduled publishing, kept under control.</h2>
            <p>Content runners turn trusted host-side tools into repeatable posts. Draft first, dry-run safely, then enable only the schedules you understand.</p>
          </div>
          <div class="runner-hero-actions">
            <label class="runner-switch"><input type="checkbox" checked={settings?.modules?.content_runners?.enabled === true} onchange={(event) => toggleRunners(event.currentTarget.checked)} disabled={busy} /><span class="runner-switch-track"></span><span>{settings?.modules?.content_runners?.enabled === true ? 'Enabled' : 'Enable module'}</span></label>
            <button class="runner-primary" onclick={openNewRunner} disabled={busy || settings?.modules?.content_runners?.enabled !== true}>+ New runner</button>
          </div>
        </section>

        <section class="runner-metrics" aria-label="Runner overview">
          <div class="runner-metric"><span>Configured</span><strong>{number(runners.length)}</strong><small>{runners.length === 1 ? 'runner' : 'runners'} in this instance</small></div>
          <div class="runner-metric"><span>Active schedules</span><strong>{number(enabledRunnerCount)}</strong><small>{enabledRunnerCount ? 'worker has work to claim' : 'nothing will publish'}</small></div>
          <div class="runner-metric"><span>Running now</span><strong class:active={runningRunnerCount > 0}>{number(runningRunnerCount)}</strong><small>{runningRunnerCount ? 'worker has claimed a run' : 'no active execution'}</small></div>
          <div class="runner-metric"><span>Needs attention</span><strong class:attention={attentionRunnerCount > 0}>{number(attentionRunnerCount)}</strong><small>{attentionRunnerCount ? 'paused or retrying' : 'no runner warnings'}</small></div>
          <div class="runner-metric"><span>Next scheduled run</span><strong class="runner-metric-text">{nextRunner ? compactDate(nextRunner.next_run_at) : '—'}</strong><small>{nextRunner ? nextRunner.name : 'No upcoming work'}</small></div>
        </section>

        {#if !settings?.modules?.content_runners?.enabled}
          <div class="runner-callout runner-callout-warning"><span class="runner-callout-icon">!</span><div><strong>Publishing is paused at the module level.</strong><p>Existing runner definitions are safe. Enable the module above when you are ready for the worker to claim scheduled work.</p></div></div>
        {:else}
          <div class="runner-callout"><span class="runner-callout-icon">✓</span><div><strong>Safe publishing workflow</strong><p>New runners start as drafts. Use <em>Test</em> to execute without publishing, then enable the schedule when the output looks right.</p></div></div>
        {/if}

        {#if runnerEditorOpen}
          <section class="runner-editor-shell panel">
            <div class="runner-editor-heading"><div><p class="runner-eyebrow">{editingRunner ? 'EDIT CONFIGURATION' : 'NEW CONFIGURATION'}</p><h3>{editingRunner ? 'Tune this runner' : 'Create a runner'}</h3><p class="muted">Set the destination and recipe first. Reliability controls live in the right column so the important choices stay visible.</p></div><button type="button" class="runner-close" aria-label="Close runner editor" onclick={closeRunnerEditor}>×</button></div>
            {#if runnerFormError}<div class="runner-form-alert" role="alert"><strong>Runner was not saved.</strong><span>{runnerFormError}</span><small>Check the highlighted fields and try again. Save &amp; test will only queue a run after the configuration is saved.</small></div>{/if}
            <form class="runner-form" onsubmit={saveRunner}>
              <div class="runner-form-main">
                <fieldset class="runner-form-section"><legend>Identity</legend><div class="runner-form-grid"><label>Runner name<input bind:value={runnerName} placeholder="Morning field notes" required maxlength="80" /></label><label>Runner type<select aria-label="Runner type" bind:value={runnerKind}><option value="draw_things">Draw Things image generator</option><option value="command">Command / generator</option><option value="cross_post">Cross-post adapter</option></select><small>{runnerKindDescriptions[runnerKind]}</small></label><label>Author handle<input bind:value={runnerAuthor} placeholder="editor" required /></label><label>Community slug<input bind:value={runnerCommunity} placeholder="general" required /></label></div></fieldset>
                <fieldset class="runner-form-section"><legend>Recipe</legend><label>{runnerKind === 'draw_things' ? 'Generation prompt' : 'Runner prompt'}<textarea class="runner-prompt" placeholder="What should this runner create?" bind:value={runnerPrompt} required maxlength="20000"></textarea></label><p class="field-help">Dynamic tokens are expanded at run time: <code>&#123;date&#125;</code> <code>&#123;time&#125;</code> <code>&#123;weekday&#125;</code> <code>&#123;runner&#125;</code> <code>&#123;community&#125;</code> <code>&#123;author&#125;</code> <code>&#123;seed&#125;</code> <code>&#123;index&#125;</code>/<code>&#123;total&#125;</code>. Unknown tokens are left unchanged.</p>
                  {#if runnerKind === 'draw_things'}
                    <div class="runner-subsection"><div class="runner-subsection-heading"><strong>Draw Things settings</strong><span>Saved with every generated post</span></div><div class="runner-form-grid runner-draw-grid"><label>Executable<input bind:value={drawExecutable} placeholder="draw-things-cli" /></label><label>Model<input bind:value={drawModel} placeholder="flux_1_schnell_q5p.ckpt" required /></label><label>Models directory<input bind:value={drawModelsDir} placeholder="Default Draw Things Models directory" /></label><label>Output path / template<input bind:value={drawOutputPath} placeholder="~/DrawThings/lighthouse-{index}.png" /></label><label>Width<input type="number" min="64" max="4096" bind:value={drawWidth} /></label><label>Height<input type="number" min="64" max="4096" bind:value={drawHeight} /></label><label>Steps<input type="number" min="1" max="200" bind:value={drawSteps} /></label><label>CFG (optional)<input type="number" min="0" max="50" step="0.1" bind:value={drawCfg} placeholder="Model recommended" /></label><label>Starting seed<input type="number" min="0" bind:value={drawSeed} placeholder="automatic" /></label><label>Posts per run<input type="number" min="1" max="8" bind:value={drawPostsPerRun} /></label><label class="span-two">Title prefix<input bind:value={drawTitlePrefix} placeholder="Draw Things generation" /></label></div><label>LoRAs (JSON)<textarea bind:value={drawLoras} rows="3"></textarea></label><p class="field-help">The worker invokes the local CLI without a shell. Leave CFG blank to keep the model’s recommended guidance. For multiple posts, <code>&#123;index&#125;</code> in the output path and prompt becomes the one-based variant number; <code>&#123;timestamp&#125;</code> makes each run unique. Test after saving to generate files without publishing.</p></div>
                  {:else if runnerKind === 'cross_post'}
                    <div class="runner-subsection"><div class="runner-subsection-heading"><strong>X source window</strong><span>Official public API · no browser session</span></div><div class="runner-form-grid runner-cross-grid"><label>Accounts<input bind:value={crossAccounts} placeholder="@account_one, @account_two" /><small>Handles or X profile URLs</small></label><label>Topics<input bind:value={crossTopics} placeholder="local AI, Draw Things" /><small>Comma-separated terms or phrases</small></label><label class="span-two">Exact X queries<textarea rows="2" bind:value={crossQueries} placeholder="Optional: one query per line, for advanced X syntax"></textarea></label><label>Rolling window<input type="number" min="1" max="168" bind:value={crossHours} /><small>hours, unless start/end are set</small></label><label>Posts per run<input type="number" min="1" max="8" bind:value={crossLimit} /></label><label>Posts per source<input type="number" min="5" max="100" bind:value={crossPerSource} /></label><label>Start time<input type="datetime-local" bind:value={crossStartTime} /><small>Optional local time</small></label><label>End time<input type="datetime-local" bind:value={crossEndTime} /><small>Optional local time</small></label></div><div class="runner-check-row"><label><input type="checkbox" bind:checked={crossIncludeReplies} /> Include replies</label><label><input type="checkbox" bind:checked={crossIncludeRetweets} /> Include reposts</label></div><p class="field-help">The worker passes <code>X_BEARER_TOKEN</code> from its environment. X recent search has provider plan and recency limits; an empty window is a successful no-content run, not a fabricated post.</p></div>
                  {:else}
                    <label>Command argv JSON<textarea class="runner-command" placeholder='["node", "scripts/my-runner.mjs"]' bind:value={runnerCommand} required></textarea></label><p class="field-help">The final stdout line must be one post object or <code>&#123;"posts":[...]&#125;</code>. Local media paths are uploaded before publication.</p>
                  {/if}
                </fieldset>
              </div>
              <aside class="runner-form-side">
                <fieldset class="runner-form-section"><legend>Schedule</legend><label>Run every<input type="number" min="300" max="604800" bind:value={runnerInterval} /><small>Seconds · {intervalLabel(runnerInterval)}</small></label><div class="day-picker" aria-label="Days of week">{#each [['1','Mon'],['2','Tue'],['3','Wed'],['4','Thu'],['5','Fri'],['6','Sat'],['7','Sun']] as [value,label]}<label><input type="checkbox" checked={runnerDays.includes(Number(value))} onchange={(event) => toggleRunnerDay(Number(value), event)} /> {label}</label>{/each}</div></fieldset>
                <fieldset class="runner-form-section"><legend>Reliability</legend><div class="runner-side-grid"><label>Priority<input type="number" min="0" max="10000" bind:value={runnerPriority} /></label><label>Timeout<input type="number" min="30" max="86400" bind:value={runnerTimeout} /><small>seconds</small></label><label>Attempts<input type="number" min="1" max="10" bind:value={runnerAttempts} /></label><label>Backoff<input type="number" min="10" max="86400" bind:value={runnerBackoff} /><small>seconds</small></label><label>Pause after<input type="number" min="1" max="100" bind:value={runnerThreshold} /><small>failed runs</small></label><label>Keep logs<input type="number" min="1" max="3650" bind:value={runnerRetention} /><small>days</small></label></div></fieldset>
                <details class="runner-advanced"><summary>Advanced execution</summary><div class="runner-advanced-body"><label>Allowed worker environment keys<input placeholder="KEY_ONE, KEY_TWO" bind:value={runnerEnvironmentKeys} /></label><label><input type="checkbox" bind:checked={runnerCaptureOutput} /> Capture stdout and stderr</label><label>Max log bytes<input type="number" min="1024" max="20000" bind:value={runnerMaxLogBytes} /></label><p class="field-help">Secrets stay in the worker environment; only explicitly allow-listed key names are passed to the command.</p></div></details>
              </aside>
              <div class="runner-form-actions"><button type="submit" name="intent" value="save" class="runner-primary" disabled={busy || settings?.modules?.content_runners?.enabled === false}>{editingRunner ? 'Save changes' : 'Save as draft'}</button><button type="submit" name="intent" value="test" class="runner-secondary" disabled={busy || settings?.modules?.content_runners?.enabled === false}>Save &amp; test</button><button type="button" class="runner-secondary" onclick={closeRunnerEditor}>Cancel</button><span class="field-help">Save &amp; test queues a no-publish execution; watch the card for queued, running, and completed states.</span></div>
            </form>
          </section>
        {/if}

        <section class="runner-templates"><div class="runner-templates-heading"><div><p class="runner-eyebrow">STARTER RUNNERS</p><h3>Begin with a known-good recipe</h3><p>These disabled templates use the runner JSON contract and are covered by local tests. Choose one, add an author and community, then save it as a draft. X templates need a worker-side bearer token; Draw Things templates need a local model.</p></div><span class="runner-template-note">Disabled until you enable them</span></div><div class="runner-template-grid">{#each runnerTemplates as template}<article class="runner-template-card"><div class="runner-template-top"><span class="runner-template-mark">{template.kind === 'draw_things' ? '✦' : template.kind === 'cross_post' ? '↗' : template.key === 'batch' ? '2×' : template.key === 'prompt' ? '✎' : '✓'}</span><span class="runner-pill neutral"><span></span>Draft template</span></div><h4>{template.name}</h4><p>{template.description}</p><code>{templateCommandLabel(template)}</code><button class="runner-secondary" onclick={() => useRunnerTemplate(template)} disabled={busy || settings?.modules?.content_runners?.enabled !== true}>Use template</button></article>{/each}</div></section>

        <section class="runner-list-section">
          <div class="runner-list-heading"><div><p class="runner-eyebrow">RUNNER INVENTORY</p><h3>Your runners <span>{number(visibleRunners.length)}</span></h3></div><div class="runner-list-controls"><label class="runner-search"><span aria-hidden="true">⌕</span><input aria-label="Search runners" placeholder="Search runners" bind:value={runnerSearch} /></label><select aria-label="Filter runners" bind:value={runnerFilter}><option value="all">All states</option><option value="enabled">Enabled</option><option value="retrying">Retrying</option><option value="paused">Paused</option><option value="draft">Drafts</option><option value="archived">Archived</option></select></div></div>
          {#if visibleRunners.length === 0}
            <div class="runner-empty"><div class="runner-empty-mark">◎</div>{#if runners.length === 0}<h3>Start with one trusted workflow</h3><p>Create a draft, test it without publishing, then turn on the schedule when you are ready.</p><button class="runner-primary" onclick={openNewRunner} disabled={settings?.modules?.content_runners?.enabled !== true}>Create your first runner</button>{:else}<h3>No runners match this view</h3><p>Try a different state or search term.</p><button class="runner-secondary" onclick={() => { runnerFilter = 'all'; runnerSearch = ''; }}>Clear filters</button>{/if}</div>
          {:else}
            <div class="runner-list">{#each visibleRunners as runner}
              <article class="runner-card">
                <div class="runner-card-heading"><div class="runner-identity"><div class={'runner-kind-mark ' + runner.kind}>{runner.kind === 'draw_things' ? '✦' : runner.kind === 'cross_post' ? '↗' : '⌘'}</div><div><h4>{runner.name}</h4><p>{runnerKindLabel(runner.kind)} <span>·</span> config v{runner.config_version}</p></div></div><span class={'runner-pill ' + runnerRuntimeState(runner).tone}><span></span>{runnerRuntimeState(runner).label}</span></div>
                <div class="runner-card-grid"><div class="runner-card-recipe"><span>{runner.kind === 'draw_things' ? 'Model' : runner.kind === 'cross_post' ? 'Source' : 'Command'}</span><strong title={runnerRecipeLabel(runner)}>{runnerRecipeLabel(runner)}</strong><small title={runnerRecipeDetail(runner)}>{runnerRecipeDetail(runner)}</small></div><div class="runner-card-prompt"><span>Prompt</span><details class="runner-prompt-details"><summary title={runnerPromptText(runner)}>{runnerPromptText(runner)}</summary><p>{runnerPromptText(runner)}</p></details></div><div><span>Destination</span><strong>u/{runner.author} <em>·</em> c/{runner.community}</strong><small>{runner.kind === 'draw_things' ? (runner.command?.posts_per_run || 1) + ' post(s) per run' : 'Receipt-defined posts'}</small></div><div><span>Schedule</span><strong>{intervalLabel(runner.interval_seconds)}</strong><small>{daysLabel(runner.days_of_week)} · priority {runner.priority}{runner.next_run_at && runner.state !== 'archived' ? ` · next ${compactDate(runner.next_run_at)}` : ''}</small></div><div><span>Latest run</span><strong class={runStateTone(latestRun(runner).status || runner.last_status)}>{latestRunLabel(runner)}</strong><small>{latestRunDate(runner) ? date(latestRunDate(runner)) : 'No execution yet'}{runner.run_count ? ` · ${number(runner.run_count)} total` : ''}{runnerIsRunning(runner) ? ` · ${runnerRuntimeState(runner).detail}` : ''}</small></div></div>
                {#if runnerIsRunning(runner)}
                  <div class="runner-live-progress" role="status" aria-live="polite">
                    <div class="runner-live-progress-heading"><div><strong>{progressLabel(latestRun(runner))}</strong><small>{progressDetail(latestRun(runner)) || 'Waiting for Draw Things progress…'}</small></div><span>{progressPercent(latestRun(runner)) ?? 0}%</span></div>
                    <div class="runner-progress-track" aria-hidden="true"><span style={`width: ${progressPercent(latestRun(runner)) ?? 0}%`}></span></div>
                    {#if latestRun(runner).progress_message}<p>{latestRun(runner).progress_message}</p>{/if}
                  </div>
                {/if}
                <div class="runner-card-footer"><div class="runner-card-footer-note">{runner.last_error ? 'Last run needs attention' : runnerIsRunning(runner) ? 'Worker is executing this runner now · ETA is approximate' : runner.test_requested ? 'No-publish test is waiting for the worker' : runner.state === 'draft' ? 'Draft · disabled until you enable it' : runner.state === 'archived' ? 'History retained · no longer scheduled' : runner.next_run_at ? 'Next run ' + date(runner.next_run_at) : 'Ready for a manual run'}</div><div class="runner-card-actions"><button class="runner-secondary" disabled={busy} onclick={() => editRunner(runner)}>Configure</button><button class="runner-secondary" disabled={busy} onclick={() => duplicateRunner(runner)}>Duplicate</button><button class="runner-secondary" disabled={busy} onclick={() => testRunner(runner.id)}>Test</button><button class="runner-primary runner-action-primary" disabled={busy} onclick={() => action('content-runners/' + runner.id + '/run-now', 'Queue this runner now?')}>Run now</button><button class="runner-secondary" disabled={busy || runner.state === 'archived'} onclick={() => action('content-runners/' + runner.id + '/toggle', (runner.enabled ? 'Pause' : 'Enable') + ' this runner?')}>{runner.enabled ? 'Pause' : 'Enable'}</button><button class="runner-text-action" disabled={busy || runner.state === 'archived'} onclick={() => action('content-runners/' + runner.id + '/archive', 'Archive this runner? It will remain in history but cannot run again.')}>Archive</button></div></div>
                {#if logsFor(runner.id).length}<details class="runner-history"><summary><span>Recent execution history</span><small>{logsFor(runner.id).length} latest {logsFor(runner.id).length === 1 ? 'run' : 'runs'}</small></summary><div class="runner-history-list">{#each logsFor(runner.id) as log}<div class="runner-history-row"><div><strong>#{log.id}</strong><small>{date(log.started_at)}{log.dry_run ? ' · dry run' : ''}{log.timed_out ? ' · timed out' : ''}</small></div><span class={'runner-pill ' + runStateTone(log.status)}><span></span>{log.status === 'running' && progressPercent(log) != null ? progressPercent(log) + '%' : runStateLabel(log.status)}</span><div><strong>{log.status === 'running' ? progressLabel(log) : log.duration_ms != null ? log.duration_ms + ' ms' : '—'}</strong><small>{log.status === 'running' ? progressDetail(log) || 'Worker is executing' : `attempt ${log.attempt} / ${runner.max_attempts}`}</small></div><details class="runner-log-detail"><summary>{log.error || (log.stdout ? 'View stdout' : 'View output')}</summary><pre>{log.stderr || log.stdout || JSON.stringify(log.detail, null, 2)}</pre></details><button class="runner-text-action" disabled={busy} onclick={() => action('content-runner-runs/' + log.id + '/replay', 'Replay this runner execution?')}>Replay</button></div>{/each}</div></details>{/if}
              </article>
            {/each}</div>
          {/if}
        </section>

        <section class="runner-how-it-works"><div><p class="runner-eyebrow">HOW IT WORKS</p><h3>A deliberate path from idea to publish.</h3></div><div class="runner-steps"><div><span>01</span><strong>Draft</strong><p>Define the host tool, destination, and schedule.</p></div><div><span>02</span><strong>Test</strong><p>Run the real command without creating a post.</p></div><div><span>03</span><strong>Enable</strong><p>Let the worker claim work and keep the receipt.</p></div></div></section>
      </div>
    {:else if tab === 'Moderation'}
      <section class="panel">
        <h3>Human review queue</h3>
        <p class="muted">{settings?.modules?.moderation?.enabled === false ? 'Publication moderation is disabled. This queue is retained for historical post/comment records and any older items that were already submitted.' : 'Posts, comments, imports, and runner output can wait here before publication. Profile changes publish immediately and never enter this queue. Flags are deterministic advisory signals; threat flags are urgent but never auto-ban anyone.'}</p>
        <form class="admin-toolbar" onsubmit={(e) => { e.preventDefault(); filter(); }}>
          <input aria-label="Search moderation queue" placeholder="Search handles or content…" bind:value={search} maxlength="200" />
          <select aria-label="Moderation type" bind:value={kind} onchange={filter}><option value="">All types</option><option value="post">Posts</option><option value="comment">Comments</option></select>
          <button>Filter queue</button>
        </form>
      </section>
      <section class="panel table-wrap">
        {#if rows.length === 0}<div class="admin-empty"><h3>Queue is clear</h3><p>No pending or escalated submissions match this filter.</p></div>
        {:else}<table class="moderation-table"><thead><tr><th>Submission</th><th>Author</th><th>Content</th><th>Signals</th><th>Actions</th></tr></thead><tbody>
          {#each rows as item}
            <tr class:urgent={item.urgent}>
              <td><strong>{item.kind}</strong><small>{item.status}{item.urgent ? ' · urgent' : ''}</small><small>{date(item.created_at)}</small></td>
              <td><a href={'/u/' + item.author}>u/{item.author}</a>{#if item.community}<small>c/{item.community}</small>{/if}</td>
              <td>{#if item.title}<strong>{item.title}</strong>{/if}<p class="content-body">{item.body || 'Content submitted for review.'}</p></td>
              <td>{#if item.flags?.length}{#each item.flags as flag}<span class="badge">{flag.category} · {flag.severity}</span>{/each}{:else}<span class="muted">No rule flags</span>{/if}<small>Rules {item.rule_version}</small></td>
              <td class="moderation-actions"><button disabled={busy} onclick={() => moderationAction(item.id, 'approve')}>Approve</button><button disabled={busy} onclick={() => moderationAction(item.id, 'dismiss')}>Dismiss + publish</button><button disabled={busy} onclick={() => moderationAction(item.id, 'reject')}>Reject</button><button disabled={busy} onclick={() => moderationAction(item.id, 'suspend')}>Suspend 24h</button><button disabled={busy} onclick={() => moderationAction(item.id, 'escalate')}>Escalate</button></td>
            </tr>
          {/each}
        </tbody></table>{/if}
      </section>
      {#if moderationHistory.length}<section class="panel table-wrap"><h3>Recent moderation decisions</h3><p class="muted">Actions are retained separately from the content so reviewers can audit who decided what.</p><table><thead><tr><th>Time</th><th>Action</th><th>Item</th><th>Actor</th><th>Subject</th></tr></thead><tbody>{#each moderationHistory.slice(0, 25) as item}<tr><td>{date(item.created_at)}</td><td><span class="badge">{item.action}</span><small>{item.from_status} → {item.to_status}</small></td><td>{item.kind} #{item.moderation_item_id}</td><td>u/{item.actor}</td><td>u/{item.subject}</td></tr>{/each}</tbody></table></section>{/if}
    {:else if tab === 'Security'}
      <section class="panel"><h3>Request security</h3><p class="muted">Activity is keyed by a one-way IP hash. Raw addresses are not retained. Proxy-aware tracking is <strong>{security?.proxy_trust_enabled ? 'enabled' : 'disabled'}</strong>; set <code>TRUST_PROXY=true</code> only when Caddy or another trusted reverse proxy is in front of this API. Detailed access history is a circular buffer of the newest 5,000 requests.</p>
        <form class="inline-form" onsubmit={blockAddress}><label>Address to block<input bind:value={blockIp} placeholder="203.0.113.42" inputmode="numeric" required /></label><label>Reason<input bind:value={blockReason} maxlength="500" placeholder="abuse or automated flooding" /></label><label>Expires (optional)<input type="datetime-local" bind:value={blockExpiry} /></label><button disabled={busy}>Block address</button></form></section>
        <section class="panel table-wrap"><h3>Active blocks</h3>{#if security?.blocks?.length}<table><thead><tr><th>Hash</th><th>Reason</th><th>Expires</th><th>Action</th></tr></thead><tbody>{#each security.blocks as item}<tr><td><code>{item.ip_hash.slice(0,16)}…</code></td><td>{item.reason || '—'}</td><td>{date(item.expires_at)}</td><td><button disabled={busy} onclick={() => action('security/' + item.id, 'Remove this address block?', 'DELETE')}>Unblock</button></td></tr>{/each}</tbody></table>{:else}<p class="muted">No active blocks.</p>{/if}</section>
      <section class="panel table-wrap"><h3>Recent activity · 24 hours</h3>{#if security?.activity?.length}<table><thead><tr><th>Hash</th><th>Requests</th><th>Errors</th><th>Last seen</th></tr></thead><tbody>{#each security.activity as item}<tr><td><code>{item.ip_hash.slice(0,16)}…</code></td><td>{number(item.requests)}</td><td>{number(item.errors)}</td><td>{date(item.last_seen)}</td></tr>{/each}</tbody></table>{:else}<p class="muted">No proxy-derived activity yet.</p>{/if}</section>
      <section class="panel table-wrap"><h3>Recent access</h3>{#if security?.access?.length}<table><thead><tr><th>Time</th><th>Address hash</th><th>Request</th><th>Status</th></tr></thead><tbody>{#each security.access as item}<tr><td>{date(item.created_at)}</td><td><code>{item.ip_hash.slice(0,12)}…</code></td><td><code>{item.method} {item.route}</code></td><td><span class={'badge ' + accessTone(item.status)}>{item.status}</span></td></tr>{/each}</tbody></table>{:else}<p class="muted">No detailed access history yet.</p>{/if}</section>
    {:else if tab === 'Settings'}
      <div class="admin-columns">
        <section class="panel">
          <h3>Publication moderation</h3>
          <p><label><input type="checkbox" checked={settings?.modules?.moderation?.enabled !== false} onchange={(event) => toggleModeration(event.currentTarget.checked)} disabled={busy} /> Hold new posts and comments for review</label></p>
          {#if settings?.modules?.moderation?.enabled === false}<p class="muted">Publication moderation is disabled. The classifier and review gate are bypassed; profile changes are always immediate. Reports, account suspension, security controls, and historical audit records remain available.</p>{:else}<p class="muted">New posts, comments, imports, and scheduled runner output can wait for human review. Profile changes publish immediately and never enter the queue.</p>{/if}
        </section>
        <section class="panel">
          <h3>Optional integration · Orchard</h3>
          <p><label><input type="checkbox" checked={settings?.modules?.content_runners?.enabled === true} onchange={(event) => toggleRunners(event.currentTarget.checked)} disabled={busy} /> Enable scheduled content runners</label></p>
          <p><label><input type="checkbox" checked={settings?.modules?.orchard?.enabled !== false} onchange={(event) => toggleOrchard(event.currentTarget.checked)} disabled={busy} /> Enable Orchard integration</label></p>
          {#if settings?.modules?.orchard?.enabled !== false}
            <p>Orchard is a native macOS interface for Apple’s container runtime. It is a useful companion for Swartzit’s PostgreSQL container, but it does not publish the Swartzit web server or prove that the public origin is reachable.</p>
            <p class="muted">Install it with Homebrew, then use Orchard’s dashboard to inspect the container runtime. Swartzit still owns the API, web process, reverse proxy, and uptime check.</p>
            <div class="admin-toolbar"><button onclick={copyOrchardInstall}>Copy <code>brew install orchard</code></button><a href="orchard://dashboard">Open Orchard ↗</a><a href="https://github.com/andrew-waters/orchard" target="_blank" rel="noreferrer">Orchard project ↗</a></div>
            <p class="muted">The native menu item also exposes <code>swartzit orchard install --yes</code>. Package installation remains explicit because it changes the host.</p>
          {:else}
            <p class="muted">Orchard integration is disabled. Swartzit will hide Orchard controls from the native menu and this panel; it will not uninstall Orchard or change existing containers.</p>
          {/if}
        </section>
        <section class="panel">
          <h3>Uptime pulse</h3>
          <div class="metrics"><div><span>Latest result</span><strong class="pulse-value">{uptime?.pulse?.status ?? 'unknown'}</strong><small>{date(uptime?.pulse?.checked_at)}</small></div><div><span>Latency</span><strong>{uptime?.pulse?.latency_ms != null ? uptime.pulse.latency_ms + ' ms' : '—'}</strong><small>Latest public check</small></div><div><span>Failures in a row</span><strong>{number(uptime?.pulse?.consecutive_failures)}</strong><small>Resets on success</small></div></div>
          <dl><dt>Checked URL</dt><dd><code>{uptime?.pulse?.url || uptime?.configuration?.url || 'Not configured'}</code></dd><dt>Schedule</dt><dd>{uptime?.configuration?.interval_seconds ? 'Every ' + uptime.configuration.interval_seconds + ' seconds' : 'Not configured'}</dd><dt>Last success</dt><dd>{date(uptime?.pulse?.last_up_at)}</dd><dt>Last failure</dt><dd>{date(uptime?.pulse?.last_down_at)}</dd></dl>
          <p class="muted">This is the answer to “is the app serving?”: the monitor requests the configured URL from outside the local process and records the result in persistent state. A healthy database alone is not enough.</p>
          <p><code>swartzit monitor-install</code> installs the native macOS LaunchAgent. Change <code>SWARTZIT_CHECK_URL</code>, <code>SWARTZIT_CHECK_INTERVAL</code>, or <code>SWARTZIT_CHECK_TIMEOUT</code> and reinstall it to apply.</p>
        </section>
        <section class="panel">
          <h3>Media storage</h3>
          <p class="muted">Swartzit keeps stable asset IDs in posts while storing originals in a provider you control. The primary is written during the request; an optional secondary is queued for background replication and read fallback. The local cache is disposable. Catbox is sharing only and never a backup.</p>
          <div class="admin-toolbar">
            <label>Primary
              <select value={settings?.media?.primary ?? 'filesystem'} onchange={(event) => updateMediaSettings({ media_primary: event.currentTarget.value })} disabled={busy}>
                <option value="filesystem">Local filesystem</option>
                <option value="s3">S3-compatible storage</option>
                <option value="ipfs">IPFS</option>
              </select>
            </label>
            <label>Secondary
              <select value={settings?.media?.secondary ?? 'disabled'} onchange={(event) => updateMediaSettings({ media_secondary: event.currentTarget.value })} disabled={busy}>
                <option value="disabled">Disabled</option>
                <option value="filesystem">Local filesystem</option>
                <option value="s3">S3-compatible storage</option>
                <option value="ipfs">IPFS</option>
              </select>
            </label>
            <label><input type="checkbox" checked={settings?.media?.cache_enabled !== false} onchange={(event) => updateMediaSettings({ media_cache_enabled: event.currentTarget.checked })} disabled={busy} /> Enable cache</label>
            <label>Cache limit (GB)
              <input type="number" min="0.001" max="1024" step="0.1" value={(settings?.media?.cache_max_bytes ?? 5368709120) / 1073741824} onchange={(event) => updateMediaSettings({ media_cache_max_bytes: Math.round(Number(event.currentTarget.value) * 1073741824) })} disabled={busy} />
            </label>
            <label>External sharing
              <select value={settings?.media?.share ?? 'disabled'} onchange={(event) => updateMediaSettings({ media_share: event.currentTarget.value })} disabled={busy}>
                <option value="disabled">Disabled</option>
                <option value="catbox">Catbox share/export</option>
              </select>
            </label>
          </div>
          <dl><dt>Primary source</dt><dd>{settings?.media?.primary_source ?? '—'}</dd><dt>Secondary source</dt><dd>{settings?.media?.secondary_source ?? '—'}</dd><dt>Media root</dt><dd><code>{settings?.media?.media_root ?? '—'}</code></dd><dt>Local media footprint</dt><dd>{number(storage?.local_media_files)} files · {size(storage?.local_media_bytes)}</dd><dt>Cache footprint</dt><dd>{number(storage?.cache_files ?? settings?.media?.cache_files)} files · {size(storage?.cache_bytes ?? settings?.media?.cache_bytes)}</dd><dt>Provider configuration</dt><dd>{settings?.media?.s3_configured ? 'S3 credentials loaded' : 'S3 not configured'} · {settings?.media?.ipfs_configured ? 'IPFS endpoint loaded' : 'IPFS not configured'} · {settings?.media?.catbox_configured ? 'Catbox account hash loaded' : 'Catbox anonymous or not configured'}</dd></dl>
          <div class="metrics storage-metrics">
            <div><span>Project footprint</span><strong>{size(storage?.project_size_bytes)}</strong><small>Database + local media + cache</small></div>
            <div><span>Database</span><strong>{size(storage?.database_size_bytes ?? overview?.database_size_bytes)}</strong><small>PostgreSQL physical size</small></div>
            <div><span>Canonical media</span><strong>{size(storage?.canonical_media_bytes)}</strong><small>{number(storage?.canonical_media_assets)} assets · originals only</small></div>
            <div><span>Replica work</span><strong>{number((storage?.replication?.pending_jobs ?? 0) + (storage?.replication?.running_jobs ?? 0))}</strong><small>{number(storage?.replication?.failed_jobs)} failed · {number(storage?.replication?.ready_jobs)} jobs complete</small></div>
          </div>
          <div class="storage-grid">
            <div>
              <h4>Storage by content</h4>
              <div class="table-wrap"><table><thead><tr><th>Type</th><th>Assets</th><th>Logical bytes</th></tr></thead><tbody>
                {#each storage?.content ?? [] as item}<tr><td>{item.media_type}</td><td>{number(item.asset_count)}</td><td>{size(item.bytes)}</td></tr>{:else}<tr><td colspan="3" class="muted">No media assets yet.</td></tr>{/each}
              </tbody></table></div>
            </div>
            <div>
              <h4>Replica consistency</h4>
              <div class="table-wrap"><table><thead><tr><th>Provider / role</th><th>State</th><th>Replicas</th><th>Bytes</th></tr></thead><tbody>
                {#each storage?.replicas ?? [] as item}<tr><td>{item.provider} · {item.role}</td><td><span class="badge">{item.state}</span></td><td>{number(item.replica_count)}</td><td>{size(item.bytes)}</td></tr>{:else}<tr><td colspan="4" class="muted">No replica records yet.</td></tr>{/each}
              </tbody></table></div>
            </div>
          </div>
          <p class="muted">Project footprint is the measured PostgreSQL database plus the configured local media and cache directories. S3/IPFS physical usage is not guessed from local disk; the replica table shows the bytes Swartzit has accounted for and the background queue shows partner consistency. Cache limits and eviction remain unchanged while this data is collected.</p>
          <p class="muted">Changing providers affects new writes. Use Migrate media to copy existing assets into the selected primary and secondary. Set environment credentials or endpoints before selecting a provider; environment overrides are shown as “environment”.</p>
          <div class="admin-toolbar"><button disabled={busy} onclick={() => mediaAction('media/test', 'Test the configured primary and secondary media storage now?')}>Test storage</button><button disabled={busy} onclick={() => mediaAction('media/migrate', 'Copy all media into the configured primary and secondary storage?')}>Migrate media</button><button disabled={busy} onclick={() => mediaAction('media/verify', 'Read and checksum every configured primary and secondary media replica?')}>Verify media</button><button disabled={busy} onclick={() => mediaAction('media/cache/clear', 'Clear the disposable media cache? Originals will remain safe.')}>Clear cache</button></div>
          {#if settings?.media?.share === 'catbox'}<p class="muted">Catbox sharing is enabled. Use the admin share endpoint only for explicit exports; Catbox may remove inactive anonymous files and is not suitable as a CDN, backup, or streaming origin.</p>{/if}
        </section>
      </div>
    {:else if tab === 'Server'}
      <section class="metrics"><div><span>Database</span><strong>{size(storage?.database_size_bytes ?? overview.database_size_bytes)}</strong><small>PostgreSQL physical size</small></div><div><span>Project footprint</span><strong>{size(storage?.project_size_bytes)}</strong><small>Database + local media + cache</small></div><div><span>Canonical media</span><strong>{size(storage?.canonical_media_bytes)}</strong><small>{number(storage?.canonical_media_assets)} logical assets</small></div><div><span>Replica queue</span><strong>{number((storage?.replication?.pending_jobs ?? 0) + (storage?.replication?.running_jobs ?? 0))}</strong><small>{number(storage?.replication?.failed_jobs)} failed · {number(storage?.replication?.ready_jobs)} jobs complete</small></div></section>
      <section class="panel"><h3>Runtime</h3><dl><dt>Started</dt><dd>{date(overview.started_at)}</dd><dt>Host load · 1 / 5 / 15 minutes</dt><dd>{overview.runtime.host_load?.map(v => v.toFixed(2)).join(' / ') ?? 'Unavailable'}</dd><dt>Average API handler latency</dt><dd>{overview.runtime.mean_latency_ms.toFixed(1)} ms</dd><dt>Server errors</dt><dd>{overview.runtime.server_errors}</dd><dt>Unexpired sign-ins</dt><dd>{overview.active_sessions}</dd><dt>Retained operational events</dt><dd>{overview.log_entries} / 1,000</dd></dl><p class="muted">Host load covers the entire machine. Runtime metrics reset on restart. Unexpired sign-ins do not represent online people.</p></section>
    {:else if tab === 'Analytics'}
      <section class="metrics"><div><span>Page loads</span><strong>{number(overview.runtime.page_views)}</strong><small>Since API restart</small></div><div><span>API requests</span><strong>{number(overview.runtime.requests)}</strong><small>Since API restart</small></div><div><span>Mean throughput</span><strong>{overview.runtime.requests_per_second.toFixed(2)}/s</strong><small>Since API restart</small></div><div><span>Mean handler latency</span><strong>{overview.runtime.mean_latency_ms.toFixed(1)} ms</strong><small>Since API restart</small></div></section>
      <section class="panel"><h3>Community activity · last 14 days</h3><p class="muted">UTC dates. Daily registrations, discussions, and comments from stored records.</p>
        <div class="activity-chart" aria-label="Daily post and comment totals">{#each trend as day}<div><span>{day.posts + day.comments}</span><div class="bar" style:height={(day.posts + day.comments) / Math.max(1, ...trend.map(d => d.posts + d.comments)) * 100 + 'px'}></div><small>{day.day.slice(5)}</small></div>{/each}</div>
        <div class="table-wrap"><table><thead><tr><th>Date (UTC)</th><th>New users</th><th>Posts</th><th>Comments</th></tr></thead><tbody>{#each [...trend].reverse() as day}<tr><td>{day.day}</td><td>{day.users}</td><td>{day.posts}</td><td>{day.comments}</td></tr>{/each}</tbody></table></div>
        <p class="muted">Page loads count JavaScript navigation, including repeats, not unique people. No visitor identifiers are collected. Historical traffic is not stored.</p>
      </section>
    {:else}
      <form class="admin-toolbar" onsubmit={(e) => { e.preventDefault(); filter(); }}>
        <input aria-label="Search this view" placeholder={tab === 'Users' ? 'Search handles…' : tab === 'Logs' ? 'Search events or details…' : 'Search content…'} bind:value={search} maxlength="200" />
        {#if tab === 'Logs'}<select aria-label="Severity" bind:value={level} onchange={filter}><option value="">All levels</option><option>info</option><option>warn</option><option>error</option></select>{/if}
        {#if tab === 'Content'}<select aria-label="Content type" bind:value={kind} onchange={filter}><option value="posts">Posts</option><option value="comments">Comments</option><option value="communities">Communities</option></select>{/if}
        <button>Search</button>
      </form>
      {#if tab === 'Logs'}<p class="muted">Newest first · persistent circular log · newest 1,000 retained · search covers retained events only. Expand a row for structured details.</p>{/if}
      <div class="panel table-wrap">
      {#if rows.length === 0}<div class="admin-empty"><h3>No matching {tab.toLowerCase()}</h3><p>Try a different search or return to the first page.</p></div>
      {:else if tab === 'Users'}
        <table><thead><tr><th>User</th><th>Role</th><th>Created</th><th>Posts / comments</th><th>Sessions</th><th>Action</th></tr></thead><tbody>{#each rows as user}<tr><td><strong>u/{user.handle}</strong><small>#{user.id} · {user.registered ? 'Registered' : 'Demo identity'}</small></td><td><span class="badge">{user.is_admin ? 'Admin' : 'Member'}</span></td><td>{date(user.created_at)}</td><td>{user.posts} / {user.comments}</td><td>{user.sessions}</td><td><button disabled={busy || !user.sessions} onclick={() => action('users/' + user.id + '/revoke-sessions', 'Sign u/' + user.handle + ' out of every device?')}>Revoke sessions</button></td></tr>{/each}</tbody></table>
      {:else if tab === 'Content'}
        <table><thead><tr><th>Content</th><th>Author / community</th><th>Created</th><th>Open</th></tr></thead><tbody>{#each rows as item}<tr><td><strong>{item.title ?? item.name ?? 'Comment #' + item.id}</strong>{#if kind === 'posts'}<small>{item.view_count} views · {item.engaged_view_count} engaged (10s) · {item.deep_view_count} deeper reads (30s)</small>{/if}<details><summary>Inspect text</summary><p class="content-body">{item.body ?? item.description}</p></details></td><td>{item.author ? 'u/' + item.author : 'c/' + item.slug}<small>{item.community ? 'c/' + item.community : ''}</small></td><td>{date(item.created_at)}</td><td><a href={kind === 'communities' ? '/?community=' + item.slug : '/post/' + (item.post_id ?? item.id)}>View ↗</a></td></tr>{/each}</tbody></table>
      {:else if tab === 'Reports'}
        <table><thead><tr><th>Report</th><th>Reporter</th><th>Status</th><th>Actions</th></tr></thead><tbody>{#each rows as item}<tr><td>#{item.id}<p class="content-body">{item.reason}</p><small>{date(item.created_at)}</small></td><td>u/{item.reporter}</td><td><span class="badge">{item.resolved_at ? 'Resolved' : 'Open'}</span></td><td><a href={'/post/' + item.discussion_id}>View discussion ↗</a>{#if !item.resolved_at}<button disabled={busy} onclick={() => action('reports/' + item.id + '/resolve', 'Mark report #' + item.id + ' as resolved? This does not remove the content.')}>Resolve</button>{/if}</td></tr>{/each}</tbody></table>
      {:else}
        <table class="log-table"><thead><tr><th>Time</th><th>Level</th><th>Event / details</th></tr></thead><tbody>{#each rows as entry}<tr><td>{date(entry.created_at)}<small>#{entry.id}</small></td><td><span class={'badge ' + entry.level}>{entry.level}</span></td><td><details><summary>{entry.event} {entry.detail.method ?? ''} {entry.detail.route ?? ''} {entry.detail.status ?? ''}</summary><pre>{JSON.stringify(entry.detail, null, 2)}</pre></details></td></tr>{/each}</tbody></table>
      {/if}
      </div>
      <div class="admin-pagination"><button disabled={!cursors.length} onclick={previous}>← Newer</button><span>Page {cursors.length + 1} · {rows.length} results</span><button disabled={rows.length < (tab === 'Logs' ? 100 : 50)} onclick={next}>Older →</button></div>
    {/if}
  {/if}
</main>
{/if}

<style>
  .admin-auth{max-width:620px}
  .admin-sign-in{display:inline-block;background:var(--button-bg,#173d34);color:var(--button-text,#fff);border-radius:6px;padding:12px 20px;font-weight:700}
  .admin-sign-in:hover{background:var(--heading,#28594a)}
  .runner-page{display:grid;gap:20px;margin-top:18px}
  .runner-hero{display:flex;justify-content:space-between;gap:28px;align-items:flex-end;padding:32px;border:1px solid var(--border);border-radius:22px;background:linear-gradient(135deg,color-mix(in srgb,var(--surface) 94%,var(--accent) 6%),color-mix(in srgb,var(--subtle) 82%,var(--surface) 18%));box-shadow:0 16px 34px color-mix(in srgb,var(--heading) 8%,transparent)}
  .runner-hero-copy{max-width:720px}.runner-kicker,.runner-eyebrow{font-size:.69rem;letter-spacing:.15em;text-transform:uppercase;font-weight:800;color:var(--accent)}.runner-kicker{display:flex;align-items:center;gap:8px}.runner-status-dot{width:8px;height:8px;border-radius:50%;background:var(--muted);box-shadow:0 0 0 4px color-mix(in srgb,var(--muted) 14%,transparent)}.runner-status-dot.online{background:#3d9a68;box-shadow:0 0 0 4px color-mix(in srgb,#3d9a68 18%,transparent)}.runner-hero h2{font:600 clamp(2rem,4vw,3.4rem)/1.05 Georgia,serif;letter-spacing:-.045em;color:var(--heading);margin:12px 0}.runner-hero p{color:var(--muted);max-width:650px;font-size:1rem;margin:0}.runner-hero-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:flex-end}.runner-switch{display:inline-flex;align-items:center;gap:9px;color:var(--heading);font-weight:700;cursor:pointer;white-space:nowrap}.runner-switch input{position:absolute;opacity:0;pointer-events:none}.runner-switch-track{width:40px;height:24px;border-radius:999px;background:var(--border);padding:3px;transition:background .18s}.runner-switch-track::after{content:'';display:block;width:18px;height:18px;border-radius:50%;background:var(--surface);box-shadow:0 1px 3px #0003;transition:transform .18s}.runner-switch input:checked + .runner-switch-track{background:var(--accent)}.runner-switch input:checked + .runner-switch-track::after{transform:translateX(16px)}.runner-primary,.runner-secondary,.runner-text-action{font:600 .82rem/1 inherit;cursor:pointer}.runner-primary{border:1px solid var(--button-bg);border-radius:999px!important;padding:11px 17px!important;background:var(--button-bg);color:var(--button-text);box-shadow:0 5px 12px color-mix(in srgb,var(--button-bg) 20%,transparent)}.runner-primary:hover{filter:brightness(1.08)}.runner-secondary{border:1px solid var(--border);border-radius:999px!important;padding:9px 13px!important;background:var(--surface);color:var(--heading)}.runner-secondary:hover{border-color:var(--accent);color:var(--accent)}.runner-text-action{border:0;background:transparent;color:var(--muted);padding:7px!important}.runner-text-action:hover{color:var(--error)}.runner-primary:disabled,.runner-secondary:disabled,.runner-text-action:disabled{opacity:.42;cursor:default;filter:none}
  .runner-metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.runner-metric{min-height:112px;padding:17px 18px;border:1px solid var(--border);border-radius:15px;background:var(--surface)}.runner-metric span,.runner-metric small{display:block;color:var(--muted);font-size:.73rem}.runner-metric strong{display:block;color:var(--heading);font:600 1.75rem/1 Georgia,serif;margin:12px 0 7px}.runner-metric strong.active{color:#2c8154}.runner-metric strong.attention{color:var(--error)}.runner-metric-text{font-size:1.35rem!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .runner-callout{display:flex;gap:13px;align-items:flex-start;padding:16px 18px;border:1px solid color-mix(in srgb,#3d9a68 34%,var(--border));border-radius:14px;background:color-mix(in srgb,#3d9a68 8%,var(--surface))}.runner-callout-warning{border-color:color-mix(in srgb,var(--warning) 38%,var(--border));background:color-mix(in srgb,var(--warning-bg) 54%,var(--surface))}.runner-callout-icon{width:22px;height:22px;display:grid;place-items:center;flex:none;border-radius:50%;background:#3d9a68;color:white;font-size:.75rem;font-weight:800}.runner-callout-warning .runner-callout-icon{background:var(--warning)}.runner-callout strong{font-size:.88rem;color:var(--heading)}.runner-callout p{margin:3px 0 0;color:var(--muted);font-size:.82rem}.runner-callout em{color:var(--heading);font-style:normal;font-weight:700}
  .runner-editor-shell{padding:26px;border-radius:18px;box-shadow:0 12px 30px color-mix(in srgb,var(--heading) 7%,transparent)}.runner-editor-heading{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding-bottom:20px;border-bottom:1px solid var(--border)}.runner-editor-heading h3,.runner-list-heading h3,.runner-how-it-works h3{font:600 1.55rem/1.12 Georgia,serif;color:var(--heading);margin:7px 0}.runner-editor-heading p{margin:0}.runner-close{width:34px;height:34px;padding:0!important;border:1px solid var(--border)!important;border-radius:50%!important;background:transparent!important;color:var(--muted)!important;font-size:1.45rem!important;line-height:1;cursor:pointer}.runner-close:hover{color:var(--heading);border-color:var(--accent)!important}.runner-form-alert{display:grid;gap:3px;margin-top:18px;padding:13px 15px;border:1px solid color-mix(in srgb,var(--error) 38%,var(--border));border-radius:11px;background:color-mix(in srgb,var(--error-bg) 70%,var(--surface));color:var(--error);font-size:.8rem}.runner-form-alert strong{font-size:.82rem}.runner-form-alert small{color:var(--muted);font-size:.71rem}.runner-form{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:18px;margin-top:22px}.runner-form-main,.runner-form-side{display:grid;gap:18px;align-content:start}.runner-form-section{min-width:0;border:1px solid var(--border);border-radius:14px;padding:18px;background:color-mix(in srgb,var(--surface) 75%,var(--subtle) 25%)}.runner-form-section legend{padding:0 7px;color:var(--heading);font-size:.88rem;font-weight:800}.runner-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.runner-form-grid label,.runner-form-section>label,.runner-subsection>label,.runner-advanced-body label{display:flex;flex-direction:column;gap:6px;color:var(--heading);font-size:.78rem;font-weight:750}.runner-form-grid small,.runner-form-section small,.field-help{color:var(--muted);font-size:.72rem;font-weight:400}.runner-form-section input,.runner-form-section select,.runner-form-section textarea,.runner-advanced input{width:100%;font:inherit;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);padding:10px 11px}.runner-form-section textarea{resize:vertical;min-height:94px}.runner-form-section input:focus,.runner-form-section select:focus,.runner-form-section textarea:focus{border-color:var(--accent)}.runner-prompt{min-height:120px}.runner-command{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.79rem;min-height:80px}.runner-subsection{display:grid;gap:12px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)}.runner-subsection-heading{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.runner-subsection-heading strong{color:var(--heading);font-size:.86rem}.runner-subsection-heading span{color:var(--muted);font-size:.72rem}.runner-draw-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.runner-draw-grid .span-two{grid-column:span 2}.runner-side-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.runner-side-grid label{display:flex;flex-direction:column;gap:5px;color:var(--heading);font-size:.75rem;font-weight:750}.runner-side-grid input{width:100%}.day-picker{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px}.day-picker label{display:flex;align-items:center;gap:5px;padding:7px 8px;border:1px solid var(--border);border-radius:7px;color:var(--muted);font-size:.72rem;font-weight:650;cursor:pointer}.day-picker input{width:auto!important;margin:0}.runner-advanced{border:1px solid var(--border);border-radius:14px;background:var(--surface)}.runner-advanced summary{cursor:pointer;padding:14px 16px;color:var(--heading);font-size:.82rem;font-weight:800}.runner-advanced-body{display:grid;gap:12px;padding:0 16px 16px}.runner-advanced-body label{font-size:.75rem}.runner-advanced-body label:has(input[type=checkbox]){display:flex;flex-direction:row;align-items:center;font-weight:650}.runner-advanced-body input[type=checkbox]{width:auto}.runner-form-actions{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding-top:2px}.runner-form-actions .field-help{margin-left:3px}.runner-form-actions .runner-secondary{background:transparent}
  .runner-templates{display:grid;gap:16px;padding:18px 0 2px}.runner-templates-heading{display:flex;justify-content:space-between;gap:20px;align-items:end}.runner-templates-heading h3{font:600 1.35rem/1.12 Georgia,serif;color:var(--heading);margin:7px 0}.runner-templates-heading p{max-width:680px;margin:0;color:var(--muted);font-size:.8rem}.runner-template-note{color:var(--muted);font-size:.72rem;white-space:nowrap}.runner-template-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.runner-template-card{display:grid;gap:11px;align-content:start;padding:17px;border:1px solid var(--border);border-radius:15px;background:color-mix(in srgb,var(--surface) 78%,var(--subtle) 22%)}.runner-template-top{display:flex;justify-content:space-between;gap:8px;align-items:center}.runner-template-mark{width:29px;height:29px;display:grid;place-items:center;border-radius:9px;background:var(--subtle);color:var(--accent);font-weight:800;font-size:.8rem}.runner-template-card h4{margin:0;color:var(--heading);font-size:.9rem}.runner-template-card p{min-height:54px;margin:0;color:var(--muted);font-size:.75rem;line-height:1.45}.runner-template-card code{min-height:39px;padding:8px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--muted);font:500 .66rem/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.runner-template-card .runner-secondary{justify-self:start;font-size:.72rem!important}.runner-list-section{display:grid;gap:16px}.runner-list-heading{display:flex;justify-content:space-between;gap:18px;align-items:end}.runner-list-heading h3{margin-bottom:0}.runner-list-heading h3 span{font:500 .78rem/1 ui-sans-serif,system-ui,sans-serif;color:var(--muted);vertical-align:middle;margin-left:4px}.runner-list-controls{display:flex;gap:8px;align-items:center}.runner-list-controls select{border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--heading);padding:9px 12px;font:600 .78rem inherit}.runner-search{display:flex;align-items:center;gap:7px;min-width:220px;padding:0 11px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--muted)}.runner-search input{border:0!important;outline:0;background:transparent;padding:9px 0!important;min-width:0}.runner-search input:focus{outline:0}.runner-list{display:grid;gap:12px}.runner-card{border:1px solid var(--border);border-radius:17px;background:var(--surface);overflow:hidden;transition:border-color .18s,box-shadow .18s}.runner-card:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));box-shadow:0 10px 22px color-mix(in srgb,var(--heading) 6%,transparent)}.runner-card-heading{display:flex;justify-content:space-between;gap:15px;align-items:center;padding:19px 20px 15px}.runner-identity{display:flex;align-items:center;gap:12px;min-width:0}.runner-kind-mark{width:38px;height:38px;display:grid;place-items:center;flex:none;border-radius:11px;background:color-mix(in srgb,var(--accent) 17%,var(--surface));color:var(--accent);font-size:1.2rem}.runner-kind-mark.draw_things{background:color-mix(in srgb,#7e65c6 17%,var(--surface));color:#7355b7}.runner-kind-mark.cross_post{background:color-mix(in srgb,#2e82a7 15%,var(--surface));color:#2e7493}.runner-identity h4{margin:0;color:var(--heading);font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.runner-identity p{margin:4px 0 0;color:var(--muted);font-size:.73rem}.runner-identity p span{margin:0 3px;color:var(--border)}.runner-pill{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;border-radius:999px;padding:5px 9px;background:var(--subtle);color:var(--muted);font-size:.7rem;font-weight:800}.runner-pill>span{width:6px;height:6px;border-radius:50%;background:currentColor}.runner-pill.positive{background:color-mix(in srgb,#3d9a68 14%,var(--surface));color:#2c8154}.runner-pill.warning{background:color-mix(in srgb,var(--warning-bg) 70%,var(--surface));color:var(--warning)}.runner-pill.danger{background:color-mix(in srgb,var(--error-bg) 70%,var(--surface));color:var(--error)}.runner-pill.accent{background:color-mix(in srgb,var(--accent) 13%,var(--surface));color:var(--accent)}.runner-pill.neutral{background:var(--subtle);color:var(--muted)}.runner-card-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:8px 20px 19px}.runner-card-grid>div{min-width:0}.runner-card-grid span{display:block;color:var(--muted);font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;font-weight:800}.runner-card-grid strong{display:block;margin-top:7px;color:var(--heading);font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.runner-card-grid strong.positive{color:#2c8154}.runner-card-grid strong.warning{color:var(--warning)}.runner-card-grid strong.danger{color:var(--error)}.runner-card-grid strong.neutral{color:var(--muted)}.runner-card-grid em{font-style:normal;color:var(--border)}.runner-card-grid small{display:block;margin-top:4px;color:var(--muted);font-size:.7rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.runner-card-footer{display:flex;justify-content:space-between;gap:15px;align-items:center;padding:12px 20px;border-top:1px solid var(--border);background:color-mix(in srgb,var(--subtle) 36%,var(--surface))}.runner-card-footer-note{color:var(--muted);font-size:.72rem}.runner-card-actions{display:flex;gap:5px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.runner-card-actions button{font-size:.72rem!important}.runner-action-primary{padding:9px 12px!important}.runner-history{border-top:1px solid var(--border);background:color-mix(in srgb,var(--subtle) 30%,var(--surface))}.runner-history summary{display:flex;justify-content:space-between;gap:12px;padding:12px 20px;cursor:pointer;color:var(--heading);font-size:.78rem;font-weight:800}.runner-history summary small{color:var(--muted);font-weight:500}.runner-history-list{display:grid;padding:0 20px 14px}.runner-history-row{display:grid;grid-template-columns:minmax(120px,1.2fr) auto minmax(75px,.6fr) minmax(150px,2fr) auto;gap:12px;align-items:center;padding:11px 0;border-top:1px solid var(--border);font-size:.74rem}.runner-history-row>div{min-width:0}.runner-history-row strong,.runner-history-row small{display:block}.runner-history-row small{margin-top:3px;color:var(--muted);font-size:.68rem}.runner-log-detail{min-width:0}.runner-log-detail summary{display:block;padding:0;color:var(--link);font-size:.72rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.runner-log-detail pre{max-height:180px;margin:8px 0 0;font-size:.68rem}.runner-empty{padding:48px 22px;border:1px dashed var(--border);border-radius:17px;text-align:center;background:color-mix(in srgb,var(--surface) 75%,var(--subtle) 25%)}.runner-empty-mark{width:46px;height:46px;display:grid;place-items:center;margin:0 auto 12px;border-radius:15px;background:var(--subtle);color:var(--accent);font-size:1.7rem}.runner-empty h3{margin:0;color:var(--heading);font:600 1.2rem Georgia,serif}.runner-empty p{max-width:420px;margin:8px auto 18px;color:var(--muted);font-size:.84rem}.runner-how-it-works{display:grid;grid-template-columns:minmax(220px,.8fr) 1.8fr;gap:34px;align-items:start;padding:25px 2px 8px}.runner-how-it-works h3{margin-top:8px}.runner-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}.runner-steps>div{padding-left:16px;border-left:2px solid var(--border)}.runner-steps span{display:block;color:var(--accent);font:700 .7rem/1 ui-monospace,monospace;letter-spacing:.1em}.runner-steps strong{display:block;margin-top:9px;color:var(--heading);font-size:.9rem}.runner-steps p{margin:4px 0 0;color:var(--muted);font-size:.75rem}
  @media(max-width:1000px){.runner-hero{align-items:flex-start;flex-direction:column}.runner-hero-actions{justify-content:flex-start}.runner-metrics{grid-template-columns:repeat(2,1fr)}.runner-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.runner-form{grid-template-columns:1fr}.runner-form-side{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}.runner-advanced{height:max-content}.runner-form-actions{grid-column:auto}.runner-how-it-works{grid-template-columns:1fr}.runner-steps{max-width:700px}}
  @media(max-width:700px){.runner-page{margin-top:12px}.runner-hero{padding:23px 19px;border-radius:17px}.runner-hero h2{font-size:2rem}.runner-hero-actions{width:100%;justify-content:space-between}.runner-metrics{grid-template-columns:repeat(2,1fr);gap:8px}.runner-metric{min-height:100px;padding:14px}.runner-metric strong{font-size:1.45rem}.runner-callout{padding:14px}.runner-editor-shell{padding:18px 14px;border-radius:15px}.runner-editor-heading h3{font-size:1.3rem}.runner-form-grid,.runner-draw-grid,.runner-side-grid{grid-template-columns:1fr}.runner-draw-grid .span-two{grid-column:auto}.runner-form-actions{align-items:flex-start;flex-wrap:wrap}.runner-form-actions .field-help{width:100%}.runner-templates-heading{align-items:flex-start;flex-direction:column;gap:8px}.runner-template-grid{grid-template-columns:1fr}.runner-template-card p{min-height:0}.runner-list-heading{align-items:stretch;flex-direction:column;gap:12px}.runner-list-controls{width:100%}.runner-search{flex:1;min-width:0}.runner-list-controls select{max-width:125px}.runner-card-heading{align-items:flex-start;padding:16px}.runner-card-grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:8px 16px 16px}.runner-card-footer{align-items:flex-start;flex-direction:column;padding:12px 16px}.runner-card-actions{justify-content:flex-start}.runner-history summary{padding:12px 16px}.runner-history-list{padding:0 16px 10px}.runner-history-row{grid-template-columns:1fr auto;gap:8px}.runner-history-row>div:nth-child(3),.runner-history-row .runner-log-detail{grid-column:1/-1}.runner-history-row .runner-text-action{grid-column:2;grid-row:1}.runner-steps{grid-template-columns:1fr;gap:15px}.runner-how-it-works{padding-top:14px}}
  .runner-cross-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.runner-cross-grid .span-two{grid-column:span 2}.runner-check-row{display:flex;gap:14px;flex-wrap:wrap}.runner-check-row label{display:flex;align-items:center;gap:6px;color:var(--heading);font-size:.75rem;font-weight:650}.runner-check-row input{width:auto!important}
  @media(max-width:700px){.runner-cross-grid{grid-template-columns:1fr}.runner-cross-grid .span-two{grid-column:auto}}
  .storage-metrics{margin:20px 0}.storage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:22px}.storage-grid h4{margin:0 0 9px;color:var(--heading);font-size:.86rem}.storage-grid .table-wrap{margin:0}.storage-grid table{width:100%}
  @media(max-width:800px){.storage-grid{grid-template-columns:1fr}}
  .runner-live-progress{display:grid;gap:8px;margin:0 20px 16px;padding:12px 14px;border:1px solid color-mix(in srgb,var(--accent) 28%,var(--border));border-radius:11px;background:color-mix(in srgb,var(--accent) 5%,var(--surface))}.runner-live-progress-heading{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.runner-live-progress-heading strong{color:var(--heading);font-size:.78rem;text-transform:capitalize}.runner-live-progress-heading small{display:block;margin-top:3px;color:var(--muted);font-size:.7rem}.runner-live-progress-heading>span{color:var(--accent);font:700 .78rem ui-monospace,monospace}.runner-progress-track{height:7px;overflow:hidden;border-radius:999px;background:color-mix(in srgb,var(--border) 55%,var(--surface))}.runner-progress-track>span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--accent),#55a97b);transition:width .35s ease}.runner-live-progress p{margin:0;color:var(--muted);font-size:.69rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media(max-width:700px){.runner-live-progress{margin-left:16px;margin-right:16px}}
  .runner-card{border-radius:14px}.runner-card-heading{padding:13px 16px 9px}.runner-kind-mark{width:32px;height:32px;border-radius:9px;font-size:1rem}.runner-identity{gap:9px}.runner-identity p{margin-top:2px}.runner-pill{padding:4px 8px;font-size:.66rem}.runner-card-grid{grid-template-columns:minmax(175px,1.2fr) minmax(260px,2fr) minmax(160px,1fr) minmax(155px,1fr) minmax(190px,1.15fr);gap:10px;padding:6px 16px 12px}.runner-card-grid>div{min-height:43px}.runner-card-grid span{font-size:.62rem;letter-spacing:.07em}.runner-card-grid strong{margin-top:5px;font-size:.76rem}.runner-card-grid small{margin-top:3px;font-size:.66rem}.runner-card-recipe strong{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.73rem}.runner-card-recipe small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.runner-card-prompt{min-width:0}.runner-prompt-details{min-width:0}.runner-prompt-details summary{display:block;margin-top:5px;color:var(--heading);font-size:.76rem;font-weight:650;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.runner-prompt-details summary::marker{color:var(--accent)}.runner-prompt-details p{margin:8px 0 0;padding:8px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:.71rem;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere}.runner-card-footer{padding:8px 16px;gap:10px}.runner-card-footer-note{font-size:.67rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.runner-card-actions{gap:3px}.runner-card-actions button{padding:7px 9px!important;font-size:.67rem!important}.runner-live-progress{margin-left:16px;margin-right:16px;margin-bottom:10px;padding:9px 11px;gap:6px}.runner-live-progress-heading small{font-size:.66rem}.runner-live-progress p{font-size:.65rem}
  .runner-templates{gap:11px;padding-top:10px}.runner-template-card{gap:8px;padding:13px}.runner-template-card p{min-height:0;display:-webkit-box;line-clamp:2;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.runner-template-card code{min-height:31px;padding:6px;font-size:.62rem}
  @media(max-width:1100px){.runner-card-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.runner-card-prompt{grid-column:span 2}}
  @media(max-width:700px){.runner-card-heading{padding:12px 14px 8px}.runner-card-grid{grid-template-columns:1fr;padding:5px 14px 10px;gap:8px}.runner-card-prompt{grid-column:auto}.runner-card-grid>div{min-height:0}.runner-card-footer{padding:8px 14px}.runner-card-footer-note{white-space:normal}.runner-card-actions button{padding:7px 8px!important}}
</style>
