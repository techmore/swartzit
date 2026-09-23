<script>
  import { onMount } from 'svelte';
  import SessionNav from '$lib/SessionNav.svelte';
  export let data;
  let token = '', slug = '', name = '', description = '', error = '', busy = false, busySlug = '', following = {};
  onMount(async () => {
    token = localStorage.getItem('swartzit_session') ?? '';
    if (!token) return;
    const entries = await Promise.all(data.communities.map(async community => {
      try { const response = await fetch(`/api/communities/${community.slug}/subscription`,{headers:{authorization:'Bearer '+token}}); const result = await response.json(); return [community.slug,response.ok && result.subscribed]; }
      catch { return [community.slug,false]; }
    }));
    following = Object.fromEntries(entries);
  });
  async function toggleFollow(community) {
    if (!token) { window.location.assign('/login'); return; }
    busySlug = community.slug; error = '';
    try {
      const response = await fetch(`/api/communities/${community.slug}/subscription`,{method:following[community.slug]?'DELETE':'POST',headers:{authorization:'Bearer '+token}});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update followed communities.');
      following = {...following,[community.slug]:result.subscribed};
    } catch (e) { error = e.message || 'Could not reach Swartzit.'; }
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
<header><a class="brand" href="/">swartzit</a><SessionNav /></header>
<main class="community-directory">
  <p class="eyebrow">FIND YOUR PEOPLE</p><h1>Browse communities</h1>
  <p>Explore a topic, read a conversation, or start a place of your own.</p>
  <form method="GET" class="community-search"><input name="q" value={data.q} placeholder="Search topics and communities" aria-label="Search communities" maxlength="200" /><button>Search</button></form>
  <p class="muted">{data.total} communities {data.q ? 'matching “' + data.q + '”' : 'to explore'}</p>
  <div class="community-grid">{#each data.communities as community}
    <article><small>c/{community.slug}</small><h2><a href={'/?community=' + community.slug}>{community.name}</a></h2><p>{community.description}</p><a href={'/?community=' + community.slug}>{community.post_count} posts · Browse →</a><button class="follow-button" disabled={busySlug === community.slug} onclick={() => toggleFollow(community)}>{busySlug === community.slug ? 'Saving…' : following[community.slug] ? 'Following' : 'Follow'}</button></article>
  {/each}</div>
  {#if !data.communities.length}<p>No communities found. Try another search or create one below.</p>{/if}
  <nav class="community-pages" aria-label="Community result pages">
    {#if data.page > 1}<a href={'?q=' + encodeURIComponent(data.q) + '&page=' + (data.page - 1)}>← Previous</a>{/if}
    {#if data.page * 24 < data.total}<a href={'?q=' + encodeURIComponent(data.q) + '&page=' + (data.page + 1)}>Next →</a>{/if}
  </nav>
  <section class="compose"><h2>Create a community</h2>
    {#if token}<p>Choose a topic and a clear description to help people find it.</p>
    <form onsubmit={(e) => {e.preventDefault(); create();}}>
      <label for="community-slug">Address · c/your_topic</label><input id="community-slug" name="slug" bind:value={slug} required maxlength="40" pattern="[a-z0-9_]+" autocomplete="off" />
      <label for="community-name">Community name</label><input id="community-name" name="name" bind:value={name} required maxlength="100" />
      <label for="community-description">Description</label><textarea id="community-description" name="description" bind:value={description} maxlength="1000" rows="3"></textarea>
      <button disabled={busy}>{busy ? 'Creating…' : 'Create community'}</button>
      {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    </form>
    {:else}<p><a href="/login">Sign in</a> to create a community. Everyone can browse without an account.</p>{/if}
  </section>
</main>
<style>
  h1{font:500 3rem Georgia,serif;color:var(--heading,#173d34);letter-spacing:-.04em}
  .community-search{display:flex;margin:26px 0;max-width:650px}
  .community-search input{flex:1;min-width:0}
  .community-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  article{margin:0;display:flex;flex-direction:column;overflow-wrap:anywhere}
  article h2{font:600 1.4rem Georgia,serif;color:var(--heading,#173d34)}
  article>a{margin-top:auto;font-size:.8rem;color:var(--link,#215e47)}
  article small{color:var(--accent,#9b5e38)}
  .community-pages{display:flex;gap:24px;margin-top:24px}
  .follow-button{margin-top:12px;border:1px solid var(--border,#9aaba3);border-radius:6px;padding:8px 12px;background:var(--surface,#fff);color:var(--text,#1d2a27);cursor:pointer}
  .compose{margin:40px 0;max-width:650px}
  @media(max-width:900px){.community-grid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:600px){.community-grid{grid-template-columns:1fr}}
</style>
