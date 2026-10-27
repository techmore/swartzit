<script>
  import { onMount } from 'svelte';
  import { loginHref } from '#lib/auth-session.mjs';
  export let data;
  let token = '', slug = '', name = '', description = '', error = '', followError = '', busy = false, busySlug = '', following = {}, signInHref = '/login';
  onMount(async () => {
    token = localStorage.getItem('swartzit_session') ?? '';
    signInHref = loginHref(location.pathname + location.search);
    if (!token) return;
    try {
      const response = await fetch('/api/subscriptions', {headers:{authorization:'Bearer '+token}});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load followed communities.');
      following = Object.fromEntries(result.map(slug => [slug, true]));
    } catch (e) { followError = e.message || 'Could not load followed communities.'; }
  });
  async function toggleFollow(community) {
    if (!token) { window.location.assign(signInHref); return; }
    busySlug = community.slug; followError = '';
    try {
      const response = await fetch(`/api/communities/${community.slug}/subscription`,{method:following[community.slug]?'DELETE':'POST',headers:{authorization:'Bearer '+token}});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update followed communities.');
      following = {...following,[community.slug]:result.subscribed};
    } catch (e) { followError = e.message || 'Could not reach Swartzit.'; }
    finally { busySlug = ''; }
  }
  async function create() {
    busy = true; error = '';
    try {
      const response = await fetch('/api/communities', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({slug,name,description}) });
      const result = await response.json();
      if (!response.ok) { error = result.error ?? 'Could not create community'; return; }
      window.location.assign('/?community=' + encodeURIComponent(result.slug));
    } catch { error = 'Could not reach the server. Please try again.'; }
    finally { busy = false; }
  }
</script>
<svelte:head><title>Browse communities · Swartzit</title></svelte:head>
<main id="main-content" class="community-directory">
  <header class="hero">
    <p class="eyebrow">Find your people</p>
    <h1 class="page-title">Browse communities</h1>
    <p class="lede">Explore a topic, read a conversation, or start a place of your own.</p>
    <form method="GET" class="community-search" role="search"><input name="q" value={data.q} placeholder="Search topics and communities" aria-label="Search communities" maxlength="200" /><button>Search</button></form>
    <p class="muted count" role="status">{data.total} {data.total === 1 ? 'community' : 'communities'} {data.q ? 'matching “' + data.q + '”' : 'to explore'}{#if data.q} · <a href="/communities">Clear</a>{/if}</p>
  </header>
  {#if followError}<p class="form-error" role="alert">{followError}</p>{/if}
  <div class="community-grid">{#each data.communities as community}
    <article class="community-card">
      <div class="card-top"><small>c/{community.slug}</small><span class="posts">{community.post_count} {community.post_count === 1 ? 'post' : 'posts'}</span></div>
      <h2><a href={'/?community=' + community.slug}>{community.name}</a></h2>
      <p>{community.description}</p>
      <div class="card-actions">
        <a class="btn btn-secondary btn-sm" href={'/?community=' + community.slug}>Browse</a>
        <button class="follow-button btn-sm" class:secondary={!following[community.slug]} class:following={following[community.slug]} disabled={busySlug === community.slug} aria-pressed={Boolean(following[community.slug])} aria-label={`${following[community.slug] ? 'Unfollow' : 'Follow'} c/${community.slug}`} onclick={() => toggleFollow(community)}>{busySlug === community.slug ? 'Saving…' : following[community.slug] ? 'Following' : 'Follow'}</button>
      </div>
    </article>
  {/each}</div>
  {#if !data.communities.length}<div class="empty"><h2>No communities found</h2><p>Try another search or create one below.</p></div>{/if}
  <nav class="community-pages" aria-label="Community result pages">
    {#if data.page > 1}<a class="btn btn-secondary btn-sm" href={'?q=' + encodeURIComponent(data.q) + '&page=' + (data.page - 1)}>← Previous</a>{/if}
    {#if data.page * 24 < data.total}<a class="btn btn-secondary btn-sm" href={'?q=' + encodeURIComponent(data.q) + '&page=' + (data.page + 1)}>Next →</a>{/if}
  </nav>
  <section class="create card"><h2>Create a community</h2>
    {#if token}<p class="muted">Choose a topic and a clear description to help people find it.</p>
    <form class="stack" onsubmit={(e) => {e.preventDefault(); create();}}>
      <div class="field"><label for="community-slug">Address</label><input id="community-slug" name="slug" bind:value={slug} required maxlength="40" pattern="[a-z0-9_]+" placeholder="c/your_topic" autocomplete="off" /><small>Lowercase letters, numbers and underscores.</small></div>
      <div class="field"><label for="community-name">Community name</label><input id="community-name" name="name" bind:value={name} required maxlength="100" /></div>
      <div class="field"><label for="community-description">Description</label><textarea id="community-description" name="description" bind:value={description} maxlength="1000" rows="3"></textarea></div>
      <div><button disabled={busy}>{busy ? 'Creating…' : 'Create community'}</button></div>
      {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    </form>
    {:else}<p class="muted"><a class="inline" href={signInHref}>Sign in</a> to create a community. Everyone can browse without an account.</p>{/if}
  </section>
</main>
<style>
  .hero { margin-bottom: 28px; }
  .community-search { display: flex; gap: 8px; margin: 22px 0 10px; max-width: 560px; }
  .community-search input { flex: 1; min-width: 0; }
  .count { font-size: .85rem; }
  .count a, .inline { color: var(--link); text-decoration: underline; text-underline-offset: 3px; font-weight: 600; }
  .community-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .community-card { margin: 0; display: flex; flex-direction: column; gap: 6px; overflow-wrap: anywhere; transition: border-color .15s, box-shadow .15s; }
  .community-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow); }
  .card-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .card-top small { color: var(--accent); font-weight: 700; font-size: .78rem; }
  .posts { font-size: .75rem; color: var(--muted); }
  .community-card h2 { margin: 2px 0 0; font-size: 1.2rem; }
  .community-card h2 a:hover { color: var(--accent); }
  .community-card p { margin: 0; color: var(--muted); font-size: .9rem; flex: 1; }
  .card-actions { display: flex; gap: 8px; margin-top: 10px; }
  .follow-button.following { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .empty { padding: 32px; border: 1px dashed var(--border-strong); border-radius: var(--radius); text-align: center; }
  .community-pages { display: flex; gap: 12px; margin-top: 24px; }
  .create { margin-top: 48px; max-width: 560px; padding: 24px; }
  .create h2 { margin: 0 0 4px; font: 600 1.4rem var(--font-serif); }
  @media (max-width: 900px) { .community-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 600px) { .community-grid { grid-template-columns: 1fr; } .community-search { max-width: none; } }
</style>
