<script>
  import { onMount } from 'svelte';
  import SessionNav from '$lib/SessionNav.svelte';
  import ImportPanel from '$lib/ImportPanel.svelte';
  const tabs = ['Overview', 'Users', 'Content', 'Reports', 'Server', 'Analytics', 'Logs', 'Imports'];
  let tab = 'Overview', overview = null, rows = [], trend = [], loading = true, error = '', notice = '';
  let search = '', level = '', kind = 'posts', cursors = [], before = null, paused = false, refreshed = null, busy = false;
  let generation = 0;
  const number = value => new Intl.NumberFormat().format(value ?? 0);
  const date = value => value ? new Date(value).toLocaleString() : '—';
  const size = value => (value / 1024 / 1024).toFixed(1) + ' MB';
  async function api(path, method = 'GET') {
    const token = localStorage.getItem('swartzit_session');
    if (!token) throw new Error('Sign in with an administrator account to continue.');
    const response = await fetch('/api/admin/' + path, { method, headers: { authorization: 'Bearer ' + token } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Request failed');
    return response.status === 204 ? null : response.json();
  }
  async function refresh() {
    const version = ++generation;
    try {
      const params = new URLSearchParams({ q: search, level, kind });
      if (before) params.set('before', before);
      const endpoint = { Users: 'users', Content: 'content', Reports: 'reports', Logs: 'logs' }[tab];
      const [stats, items, daily] = await Promise.all([
        api('overview'), endpoint ? api(endpoint + '?' + params) : Promise.resolve([]),
        tab === 'Analytics' ? api('analytics') : Promise.resolve([])
      ]);
      if (version !== generation) return;
      overview = stats; rows = items; trend = daily; error = ''; refreshed = new Date();
    } catch (e) { if (version === generation) { error = e.message; overview = null; rows = []; trend = []; } }
    finally { if (version === generation) loading = false; }
  }
  function selectTab(next) {
    tab = next; search = ''; level = ''; before = null; cursors = []; rows = []; notice = ''; loading = true;
    history.replaceState(null, '', '/admin?tab=' + next.toLowerCase());
    refresh();
  }
  function filter() { before = null; cursors = []; loading = true; refresh(); }
  function next() { cursors = [...cursors, before]; before = rows.at(-1).id; refresh(); }
  function previous() { before = cursors.at(-1); cursors = cursors.slice(0, -1); refresh(); }
  async function action(path, question) {
    if (!window.confirm(question)) return;
    busy = true; notice = '';
    try { await api(path, 'POST'); notice = 'Change saved and recorded in the operational log.'; await refresh(); }
    catch (e) { notice = e.message; } finally { busy = false; }
  }
  onMount(() => {
    const requested = new URLSearchParams(location.search).get('tab');
    tab = tabs.find(t => t.toLowerCase() === requested) ?? 'Overview';
    refresh();
    const timer = setInterval(() => { if (!paused && !loading && !busy && !document.hidden) refresh(); }, 10000);
    return () => { clearInterval(timer); generation++; };
  });
</script>

<svelte:head><title>Administration · Swartzit</title></svelte:head>
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
      </section>
      <div class="admin-columns"><section class="panel"><h3>Instance pulse</h3><dl><dt>API requests since restart</dt><dd>{number(overview.runtime.requests)}</dd><dt>Server errors since restart</dt><dd>{number(overview.runtime.server_errors)}</dd><dt>Database size</dt><dd>{size(overview.database_size_bytes)}</dd><dt>API started</dt><dd>{date(overview.started_at)}</dd></dl><button onclick={() => selectTab('Server')}>Inspect server →</button></section>
      <section class="panel"><h3>Administration</h3><p>Browse accounts and revoke sessions, inspect public content, resolve reports, or investigate recent requests.</p><p class="muted">Role changes and password recovery remain host-side commands. Content removal and suspension are not available in this version.</p><button onclick={() => selectTab('Logs')}>Open log explorer →</button></section></div>
    {:else if tab === 'Imports'}
      <ImportPanel />
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
