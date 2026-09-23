<script>
  import { onMount } from 'svelte';
  import SessionNav from '$lib/SessionNav.svelte';
  import ImportPanel from '$lib/ImportPanel.svelte';
  const tabs = ['Overview', 'Users', 'Content', 'Reports', 'Moderation', 'Security', 'Settings', 'Server', 'Analytics', 'Logs', 'Imports', 'Crawler Jobs', 'Content Runners'];
  let tab = 'Overview', overview = null, rows = [], trend = [], jobs = [], runs = [], runners = [], runnerRuns = [], moderationHistory = [], uptime = null, settings = null, loading = true, error = '', notice = '';
  let jobName = '', jobProvider = 'reddit', jobSource = '', jobCommunity = '', jobInterval = 900, jobMax = 10, jobMode = 'review';
  let runnerName = '', runnerKind = 'command', runnerCommand = '', runnerPrompt = '', runnerAuthor = '', runnerCommunity = '', runnerInterval = 1800, runnerDays = [1, 2, 3, 4, 5, 6, 7], runnerPriority = 100, runnerTimeout = 900, runnerAttempts = 3, runnerBackoff = 60, runnerThreshold = 3, runnerRetention = 30, runnerEnvironmentKeys = '', runnerCaptureOutput = true, runnerMaxLogBytes = 20000, editingRunner = null;
  let drawExecutable = 'draw-things-cli', drawModelsDir = '', drawModel = '', drawWidth = 1024, drawHeight = 1024, drawSteps = 4, drawCfg = 3.5, drawSeed = '', drawLoras = '[]', drawOutputPath = '', drawPostsPerRun = 1, drawTitlePrefix = 'Draw Things generation';
  let search = '', level = '', kind = 'posts', cursors = [], before = null, paused = false, refreshed = null, busy = false, security = null, blockIp = '', blockReason = '', blockExpiry = '';
  let generation = 0, authState = 'checking', authError = '';
  const number = value => new Intl.NumberFormat().format(value ?? 0);
  const date = value => value ? new Date(value).toLocaleString() : '—';
  const size = value => (value / 1024 / 1024).toFixed(1) + ' MB';
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
      const [stats, items, daily, scheduled, history, runnerData, runnerLogData, securityData, uptimeData, settingsData, moderationHistoryData] = await Promise.all([
        api('overview'), endpoint ? api(endpoint + '?' + params) : Promise.resolve([]),
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
      overview = stats; rows = items; trend = daily; jobs = scheduled; runs = history; runners = runnerData; runnerRuns = runnerLogData; moderationHistory = tab === 'Moderation' ? moderationHistoryData : []; security = tab === 'Security' ? securityData : null; uptime = tab === 'Settings' ? uptimeData : null; settings = tab === 'Settings' || tab === 'Content Runners' ? settingsData : null; error = ''; refreshed = new Date();
    } catch (e) { if (version === generation) { error = e.message; overview = null; rows = []; trend = []; jobs = []; runs = []; runners = []; runnerRuns = []; moderationHistory = []; uptime = null; settings = null; } }
    finally { if (version === generation) loading = false; }
  }
  function selectTab(next) {
    tab = next; search = ''; level = ''; kind = next === 'Moderation' ? '' : 'posts'; before = null; cursors = []; rows = []; notice = ''; loading = true;
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
  async function toggleModeration(enabled) { busy = true; notice = ''; try { await api('settings', 'POST', { moderation_enabled: enabled }); notice = enabled ? 'Publication moderation enabled.' : 'Publication moderation disabled. New posts, comments, and profile changes publish immediately.'; await refresh(); } catch (e) { notice = e.message; } finally { busy = false; } }
  function parseCommand(value) { const command = value.trim().startsWith('[') ? JSON.parse(value) : value.trim().split(/\s+/); if (!Array.isArray(command) || !command.length || command.some(item => typeof item !== 'string')) throw new Error('Command must be a JSON argv array, for example ["draw-things-cli","generate"]'); return command; }
  function parseLoras(value) { const loras = JSON.parse(value || '[]'); if (!Array.isArray(loras)) throw new Error('LoRAs must be a JSON array, for example [{"file":"style.ckpt","version":"flux1","weight":0.8}]'); return loras; }
  function drawCommand() { return { executable: drawExecutable.trim(), models_dir: drawModelsDir.trim() || undefined, model: drawModel.trim(), width: Number(drawWidth), height: Number(drawHeight), steps: Number(drawSteps), cfg: Number(drawCfg), seed: drawSeed === '' ? null : Number(drawSeed), loras: parseLoras(drawLoras), output_path: drawOutputPath.trim() || undefined, posts_per_run: Number(drawPostsPerRun), title_prefix: drawTitlePrefix.trim() || undefined }; }
  function runnerPayload(source) { return { name: source.name, kind: source.kind, command: source.kind === 'draw_things' ? drawCommand() : parseCommand(source.command), prompt: source.prompt, author: source.author, community: source.community, interval_seconds: Number(source.interval), days_of_week: runnerDays, priority: Number(source.priority), timeout_seconds: Number(source.timeout), max_attempts: Number(source.attempts), retry_backoff_seconds: Number(source.backoff), failure_threshold: Number(source.threshold), retention_days: Number(source.retention), environment_keys: source.environmentKeys.split(',').map(value => value.trim()).filter(Boolean), capture_output: source.captureOutput, max_log_bytes: Number(source.maxLogBytes) }; }
  function resetRunnerForm() { runnerName = ''; runnerKind = 'command'; runnerCommand = ''; runnerPrompt = ''; runnerAuthor = ''; runnerCommunity = ''; runnerInterval = 1800; runnerDays = [1, 2, 3, 4, 5, 6, 7]; runnerPriority = 100; runnerTimeout = 900; runnerAttempts = 3; runnerBackoff = 60; runnerThreshold = 3; runnerRetention = 30; runnerEnvironmentKeys = ''; runnerCaptureOutput = true; runnerMaxLogBytes = 20000; drawExecutable = 'draw-things-cli'; drawModelsDir = ''; drawModel = ''; drawWidth = 1024; drawHeight = 1024; drawSteps = 4; drawCfg = 3.5; drawSeed = ''; drawLoras = '[]'; drawOutputPath = ''; drawPostsPerRun = 1; drawTitlePrefix = 'Draw Things generation'; editingRunner = null; }
  async function saveRunner(event) { event.preventDefault(); busy = true; notice = ''; try { const source = { name: runnerName, kind: runnerKind, command: runnerCommand, prompt: runnerPrompt, author: runnerAuthor, community: runnerCommunity, interval: runnerInterval, priority: runnerPriority, timeout: runnerTimeout, attempts: runnerAttempts, backoff: runnerBackoff, threshold: runnerThreshold, retention: runnerRetention, environmentKeys: runnerEnvironmentKeys, captureOutput: runnerCaptureOutput, maxLogBytes: runnerMaxLogBytes }; await api(editingRunner ? 'content-runners/' + editingRunner.id : 'content-runners', 'POST', runnerPayload(source)); notice = editingRunner ? 'Runner configuration updated.' : 'Runner saved as a draft. Test it before enabling the schedule.'; resetRunnerForm(); await refresh(); } catch (e) { notice = e.message; } finally { busy = false; } }
  function editRunner(runner) { editingRunner = runner; runnerName = runner.name; runnerKind = runner.kind; runnerCommand = runner.kind === 'draw_things' ? '' : JSON.stringify(runner.command); runnerPrompt = runner.prompt; runnerAuthor = runner.author; runnerCommunity = runner.community; runnerInterval = runner.interval_seconds; runnerDays = Array.isArray(runner.days_of_week) && runner.days_of_week.length ? runner.days_of_week : [1, 2, 3, 4, 5, 6, 7]; runnerPriority = runner.priority; runnerTimeout = runner.timeout_seconds; runnerAttempts = runner.max_attempts; runnerBackoff = runner.retry_backoff_seconds; runnerThreshold = runner.failure_threshold; runnerRetention = runner.retention_days; runnerEnvironmentKeys = (runner.environment_keys || []).join(', '); runnerCaptureOutput = runner.capture_output !== false; runnerMaxLogBytes = runner.max_log_bytes || 20000; if (runner.kind === 'draw_things') { const config = runner.command || {}; drawExecutable = config.executable || 'draw-things-cli'; drawModelsDir = config.models_dir || ''; drawModel = config.model || ''; drawWidth = config.width || 1024; drawHeight = config.height || 1024; drawSteps = config.steps || 4; drawCfg = config.cfg ?? 3.5; drawSeed = config.seed == null ? '' : config.seed; drawLoras = JSON.stringify(config.loras || [], null, 2); drawOutputPath = config.output_path || ''; drawPostsPerRun = config.posts_per_run || 1; drawTitlePrefix = config.title_prefix || 'Draw Things generation'; } }
  function toggleRunnerDay(day, event) { runnerDays = event.currentTarget.checked ? [...new Set([...runnerDays, day])].sort((a, b) => a - b) : runnerDays.filter(value => value !== day); }
  async function testRunner(id) { busy = true; notice = ''; try { await api('content-runners/' + id + '/test', 'POST'); notice = 'Dry run queued. It will generate and log output without publishing; refresh the runner history in a moment.'; await refresh(); } catch (e) { notice = e.message; } finally { busy = false; } }
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
    const timer = setInterval(() => { if (authState === 'authenticated' && !paused && !loading && !busy && !document.hidden) refresh(); }, 10000);
    return () => { clearInterval(timer); generation++; };
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
      <section class="panel runner-editor">
        <h3>{editingRunner ? 'Edit runner' : 'Scheduled publishing runners'}</h3>
        <p class="muted">Runners execute on the worker host in priority order, one at a time. Draw Things runs can generate several images per execution, upload them to Swartzit, and attach the exact prompt and settings to each post. Every real post still enters moderation.</p>
        <form class="admin-toolbar" onsubmit={saveRunner}>
          <input placeholder="Runner name" bind:value={runnerName} required maxlength="80" />
          <select aria-label="Runner type" bind:value={runnerKind}><option value="draw_things">Draw Things image generator</option><option value="command">Command / generator</option><option value="cross_post">Cross-post adapter</option></select>
          <input placeholder="Author handle" bind:value={runnerAuthor} required />
          <input placeholder="Community slug" bind:value={runnerCommunity} required />
          <textarea class="wide-field" placeholder="Prompt sent to Draw Things or RUNNER_PROMPT" bind:value={runnerPrompt} required maxlength="20000"></textarea>
          {#if runnerKind === 'draw_things'}
            <fieldset class="wide-field runner-settings"><legend>Draw Things settings</legend>
              <div class="runner-grid"><label>Executable<input bind:value={drawExecutable} placeholder="draw-things-cli" /></label><label>Models directory<input bind:value={drawModelsDir} placeholder="~/Library/.../Models" /></label><label>Model<input bind:value={drawModel} placeholder="flux_1_schnell_q5p.ckpt" required /></label><label>Output path / template<input bind:value={drawOutputPath} placeholder="~/DrawThings/lighthouse-[index].png" /></label><label>Width<input type="number" min="64" max="4096" bind:value={drawWidth} /></label><label>Height<input type="number" min="64" max="4096" bind:value={drawHeight} /></label><label>Steps<input type="number" min="1" max="200" bind:value={drawSteps} /></label><label>CFG<input type="number" min="0" max="50" step="0.1" bind:value={drawCfg} /></label><label>Starting seed<input type="number" min="0" bind:value={drawSeed} placeholder="automatic" /></label><label>Posts per run<input type="number" min="1" max="8" bind:value={drawPostsPerRun} /></label><label>Title prefix<input bind:value={drawTitlePrefix} placeholder="Draw Things generation" /></label></div>
              <label class="wide-field">LoRAs (JSON)<textarea bind:value={drawLoras} rows="3" placeholder="JSON array: file, version, weight"></textarea></label>
              <p class="muted">For multiple posts, the seed increments per image and the output filename gets a numbered suffix unless it contains <code>&#123;index&#125;</code>. Use Test after saving to generate files without publishing.</p>
            </fieldset>
          {:else}
            <textarea class="wide-field" placeholder='Command argv JSON, e.g. ["node","scripts/my-runner.mjs"]' bind:value={runnerCommand} required></textarea>
            <p class="muted wide-field">The final stdout line must be one post object or <code>&#123;"posts":[...]&#125;</code>. Local media may use <code>&#123;"path":"/path/to/image.png"&#125;</code>; it is uploaded before publication.</p>
          {/if}
          <fieldset class="wide-field runner-settings"><legend>Schedule</legend><label>Every <input type="number" min="300" max="604800" bind:value={runnerInterval} /> seconds</label><div class="day-picker" aria-label="Days of week">{#each [['1','Mon'],['2','Tue'],['3','Wed'],['4','Thu'],['5','Fri'],['6','Sat'],['7','Sun']] as [value,label]}<label><input type="checkbox" checked={runnerDays.includes(Number(value))} onchange={(event) => toggleRunnerDay(Number(value), event)} /> {label}</label>{/each}</div></fieldset>
          <label>Priority <input type="number" min="0" max="10000" bind:value={runnerPriority} /></label><label>Timeout <input type="number" min="30" max="86400" bind:value={runnerTimeout} /> sec</label><label>Attempts <input type="number" min="1" max="10" bind:value={runnerAttempts} /></label><label>Backoff <input type="number" min="10" max="86400" bind:value={runnerBackoff} /> sec</label><label>Failure pause <input type="number" min="1" max="100" bind:value={runnerThreshold} /> runs</label><label>Keep logs <input type="number" min="1" max="3650" bind:value={runnerRetention} /> days</label><input placeholder="Worker env keys, comma separated" bind:value={runnerEnvironmentKeys} /><label><input type="checkbox" bind:checked={runnerCaptureOutput} /> Capture stdout/stderr</label><label>Max log bytes <input type="number" min="1024" max="20000" bind:value={runnerMaxLogBytes} /></label><button disabled={busy || settings?.modules?.content_runners?.enabled === false}>{editingRunner ? 'Save changes' : 'Save draft'}</button>{#if editingRunner}<button type="button" onclick={resetRunnerForm}>Cancel edit</button>{/if}
        </form>
      </section>
      <section class="panel table-wrap"><table><thead><tr><th>Runner</th><th>Destination</th><th>Schedule / policy</th><th>Status</th><th>Actions</th></tr></thead><tbody>{#each runners as runner}<tr><td><strong>{runner.name}</strong><small>{runner.kind} · priority {runner.priority} · config v{runner.config_version}</small></td><td>u/{runner.author}<small>c/{runner.community}</small></td><td>Every {Math.round(runner.interval_seconds / 60)} min<small>{Array.isArray(runner.days_of_week) && runner.days_of_week.length < 7 ? runner.days_of_week.map(day => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][day - 1]).join(', ') : 'Every day'} · {runner.kind === 'draw_things' ? (runner.command?.posts_per_run || 1) + ' post(s) per run' : 'receipt-defined posts'}</small><small>{runner.max_attempts} attempts · {runner.timeout_seconds}s timeout · keep {runner.retention_days}d</small></td><td><span class="badge">{runner.state}</span><small>{runner.last_status || 'never run'} · {runner.run_count} runs</small>{#if runner.test_requested}<small>dry run queued</small>{/if}{#if runner.last_error}<small>{runner.last_error}</small>{/if}{#if runner.paused_reason}<small>{runner.paused_reason}</small>{/if}</td><td><button disabled={busy} onclick={() => editRunner(runner)}>Edit</button><button disabled={busy} onclick={() => testRunner(runner.id)}>Test · no publish</button><button disabled={busy} onclick={() => action('content-runners/' + runner.id + '/run-now', 'Queue this runner now?')}>Run now</button><button disabled={busy || runner.state === 'archived'} onclick={() => action('content-runners/' + runner.id + '/toggle', (runner.enabled ? 'Pause' : 'Enable') + ' this runner?')}>{runner.enabled ? 'Pause' : 'Enable'}</button><button disabled={busy || runner.state === 'archived'} onclick={() => action('content-runners/' + runner.id + '/archive', 'Archive this runner? It will remain in history but cannot run again.')}>Archive</button></td></tr>{#if logsFor(runner.id).length}<tr><td colspan="5"><details><summary>Recent structured logs</summary><div class="table-wrap"><table><thead><tr><th>Run</th><th>Status</th><th>Attempt</th><th>Duration</th><th>Output / error</th><th>Action</th></tr></thead><tbody>{#each logsFor(runner.id) as log}<tr><td>#{log.id}<small>{date(log.started_at)}</small></td><td><span class="badge">{log.status}</span>{#if log.dry_run}<small>dry run</small>{/if}{#if log.timed_out}<small>timed out</small>{/if}</td><td>{log.attempt} / {runner.max_attempts}</td><td>{log.duration_ms != null ? log.duration_ms + ' ms' : '—'}</td><td><details><summary>{log.error || (log.stdout ? 'stdout' : 'No output')}</summary><pre>{log.stderr || log.stdout || JSON.stringify(log.detail, null, 2)}</pre></details></td><td><button disabled={busy} onclick={() => action('content-runner-runs/' + log.id + '/replay', 'Replay this runner execution?')}>Replay</button></td></tr>{/each}</tbody></table></div></details></td></tr>{/if}{/each}</tbody></table></section>
    {:else if tab === 'Moderation'}
      <section class="panel">
        <h3>Human review queue</h3>
        <p class="muted">{settings?.modules?.moderation?.enabled === false ? 'Publication moderation is disabled. This queue is retained for historical records and any older items that were already submitted.' : 'All direct user posts, comments, and profile changes wait here before publication. Flags are deterministic advisory signals; threat flags are urgent but never auto-ban anyone.'}</p>
        <form class="admin-toolbar" onsubmit={(e) => { e.preventDefault(); filter(); }}>
          <input aria-label="Search moderation queue" placeholder="Search handles or content…" bind:value={search} maxlength="200" />
          <select aria-label="Moderation type" bind:value={kind} onchange={filter}><option value="">All types</option><option value="post">Posts</option><option value="comment">Comments</option><option value="profile">Profiles</option></select>
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
              <td>{#if item.title}<strong>{item.title}</strong>{/if}<p class="content-body">{item.body || 'Profile fields submitted for review.'}</p></td>
              <td>{#if item.flags?.length}{#each item.flags as flag}<span class="badge">{flag.category} · {flag.severity}</span>{/each}{:else}<span class="muted">No rule flags</span>{/if}<small>Rules {item.rule_version}</small></td>
              <td class="moderation-actions"><button disabled={busy} onclick={() => moderationAction(item.id, 'approve')}>Approve</button><button disabled={busy} onclick={() => moderationAction(item.id, 'dismiss')}>Dismiss + publish</button><button disabled={busy} onclick={() => moderationAction(item.id, 'reject')}>Reject</button><button disabled={busy} onclick={() => moderationAction(item.id, 'suspend')}>Suspend 24h</button><button disabled={busy} onclick={() => moderationAction(item.id, 'escalate')}>Escalate</button></td>
            </tr>
          {/each}
        </tbody></table>{/if}
      </section>
      {#if moderationHistory.length}<section class="panel table-wrap"><h3>Recent moderation decisions</h3><p class="muted">Actions are retained separately from the content so reviewers can audit who decided what.</p><table><thead><tr><th>Time</th><th>Action</th><th>Item</th><th>Actor</th><th>Subject</th></tr></thead><tbody>{#each moderationHistory.slice(0, 25) as item}<tr><td>{date(item.created_at)}</td><td><span class="badge">{item.action}</span><small>{item.from_status} → {item.to_status}</small></td><td>{item.kind} #{item.moderation_item_id}</td><td>u/{item.actor}</td><td>u/{item.subject}</td></tr>{/each}</tbody></table></section>{/if}
    {:else if tab === 'Security'}
      <section class="panel"><h3>Request security</h3><p class="muted">Activity is keyed by a one-way IP hash. Raw addresses are not retained. Proxy-aware tracking is <strong>{security?.proxy_trust_enabled ? 'enabled' : 'disabled'}</strong>; set <code>TRUST_PROXY=true</code> only when Caddy or another trusted reverse proxy is in front of this API.</p>
        <form class="inline-form" onsubmit={blockAddress}><label>Address to block<input bind:value={blockIp} placeholder="203.0.113.42" inputmode="numeric" required /></label><label>Reason<input bind:value={blockReason} maxlength="500" placeholder="abuse or automated flooding" /></label><label>Expires (optional)<input type="datetime-local" bind:value={blockExpiry} /></label><button disabled={busy}>Block address</button></form></section>
        <section class="panel table-wrap"><h3>Active blocks</h3>{#if security?.blocks?.length}<table><thead><tr><th>Hash</th><th>Reason</th><th>Expires</th><th>Action</th></tr></thead><tbody>{#each security.blocks as item}<tr><td><code>{item.ip_hash.slice(0,16)}…</code></td><td>{item.reason || '—'}</td><td>{date(item.expires_at)}</td><td><button disabled={busy} onclick={() => action('security/' + item.id, 'Remove this address block?', 'DELETE')}>Unblock</button></td></tr>{/each}</tbody></table>{:else}<p class="muted">No active blocks.</p>{/if}</section>
      <section class="panel table-wrap"><h3>Recent activity · 24 hours</h3>{#if security?.activity?.length}<table><thead><tr><th>Hash</th><th>Requests</th><th>Errors</th><th>Last seen</th></tr></thead><tbody>{#each security.activity as item}<tr><td><code>{item.ip_hash.slice(0,16)}…</code></td><td>{number(item.requests)}</td><td>{number(item.errors)}</td><td>{date(item.last_seen)}</td></tr>{/each}</tbody></table>{:else}<p class="muted">No proxy-derived activity yet.</p>{/if}</section>
    {:else if tab === 'Settings'}
      <div class="admin-columns">
        <section class="panel">
          <h3>Publication moderation</h3>
          <p><label><input type="checkbox" checked={settings?.modules?.moderation?.enabled !== false} onchange={(event) => toggleModeration(event.currentTarget.checked)} disabled={busy} /> Hold new posts, comments, and profile changes for review</label></p>
          {#if settings?.modules?.moderation?.enabled === false}<p class="muted">Publication moderation is disabled. The classifier and review gate are bypassed; reports, account suspension, security controls, and historical audit records remain available.</p>{:else}<p class="muted">New direct submissions and scheduled imports wait for human review before becoming public.</p>{/if}
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
      </div>
    {:else if tab === 'Server'}
      <section class="metrics"><div><span>Database</span><strong>Connected</strong><small>Overview query succeeded</small></div><div><span>Storage</span><strong>{size(overview.database_size_bytes)}</strong><small>PostgreSQL database</small></div><div><span>Connection pool</span><strong>{overview.runtime.db_connections} / 5</strong><small>{overview.runtime.db_idle} idle connections</small></div><div><span>In-flight requests</span><strong>{overview.runtime.in_flight}</strong><small>Includes admin polling</small></div></section>
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
  .runner-editor form{align-items:stretch}
  .runner-editor .wide-field{grid-column:1/-1}
  .runner-settings{border:1px solid var(--border,#c7d0c6);border-radius:10px;padding:12px;background:var(--subtle,#f0f3ec)}
  .runner-settings legend{padding:0 6px;font-weight:700}
  .runner-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .runner-grid label{display:flex;flex-direction:column;gap:5px}
  .runner-grid input{width:100%}
  .day-picker{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .day-picker label{display:flex;align-items:center;gap:4px;font-size:.86rem}
  .day-picker input{width:auto}
  @media(max-width:760px){.runner-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:520px){.runner-grid{grid-template-columns:1fr}}
</style>
