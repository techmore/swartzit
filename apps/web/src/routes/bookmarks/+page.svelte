<script>
  import { onMount } from 'svelte';
  import SessionNav from '$lib/SessionNav.svelte';
  let token = '', loaded = false, busy = false, error = '', folders = [], items = [], filter = 'all', page = 1, hasMore = false, name = '', rename = '', message = '';
  $: selected = folders.find(f => String(f.id) === filter);
  async function request(path, method = 'GET', body) {
    const r = await fetch(path, {method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)});
    if (!r.ok) throw new Error((await r.json()).error || 'Could not update bookmarks.');
    return r.status === 204 ? null : r.json();
  }
  async function refresh() {
    const query = new URLSearchParams({page:String(page)});
    if (filter === 'unfiled') query.set('unfiled','true');
    else if (filter !== 'all') query.set('folder_id',filter);
    const [f,result] = await Promise.all([request('/api/bookmark-folders'),request('/api/bookmarks?'+query)]);
    folders = f; items = result.items; hasMore = result.has_more;
  }
  async function run(action) {
    busy = true; error = ''; message = '';
    try { await action(); await refresh(); } catch (e) { error = e.message || 'Could not reach Swartzit.'; }
    finally { busy = false; }
  }
  onMount(async () => { token = localStorage.getItem('swartzit_session') || ''; if (token) await run(async()=>{}); loaded = true; });
  function changeFilter() { page = 1; rename = folders.find(f => String(f.id) === filter)?.name || ''; run(async()=>{}); }
  async function create() { await run(async()=>{const f = await request('/api/bookmark-folders','POST',{name}); filter = String(f.id); rename = name.trim(); name = ''; page = 1; message = 'Folder created.';}); }
  async function deleteFolder() { await run(async()=>{await request('/api/bookmark-folders/'+filter,'DELETE'); filter = 'unfiled'; page = 1; message = 'Folder deleted. Its bookmarks are in Unfiled.';}); }
</script>
<svelte:head><title>Bookmarks — Swartzit</title><meta name="robots" content="noindex" /></svelte:head>
<header><a class="brand" href="/">swartzit</a><SessionNav /></header>
<main>
  <h1>Your bookmarks</h1><p>Private to your account. Save discussions and organize them into folders.</p>
  {#if !loaded}<p role="status">Loading bookmarks…</p>
  {:else if !token}<p><a href="/login">Sign in</a> to save posts and manage folders.</p>
  {:else}
    <div class="bookmark-layout">
      <aside>
        <label>Browse <select bind:value={filter} on:change={changeFilter} disabled={busy}><option value="all">All bookmarks</option><option value="unfiled">Unfiled</option>{#each folders as f}<option value={String(f.id)}>{f.name} ({f.count})</option>{/each}</select></label>
        <form on:submit|preventDefault={create}><label>New folder<input bind:value={name} required maxlength="80" placeholder="e.g. Read later" /></label><button disabled={busy}>Create folder</button></form>
        {#if selected}
          <form on:submit|preventDefault={() => run(async()=>{await request('/api/bookmark-folders/'+filter,'POST',{name:rename});message='Folder renamed.';})}><label>Folder name<input bind:value={rename} required maxlength="80" /></label><button disabled={busy}>Rename folder</button></form>
          <p class="muted">Deleting a folder keeps its bookmarks in Unfiled.</p><button disabled={busy} on:click={deleteFolder}>Delete folder</button>
        {/if}
      </aside>
      <section aria-label="Saved posts" aria-busy={busy}>
        <h2>{selected?.name || (filter === 'unfiled' ? 'Unfiled' : 'All bookmarks')}</h2>
        {#if !items.length && !error}<p>No bookmarks here yet. Use “Bookmark” on any discussion to save it.</p>{/if}
        {#each items as item (item.post_id)}
          <article><small>c/{item.community} · Saved {new Date(item.created_at).toLocaleDateString()}</small><h3><a href="/post/{item.post_id}">{item.title}</a></h3>
            <div class="actions"><label>Folder <select value={item.folder_id == null ? '' : String(item.folder_id)} disabled={busy} on:change={e => {const value=e.currentTarget.value;run(async()=>{await request(`/api/posts/${item.post_id}/bookmark`,'POST',{folder_id:value ? Number(value) : null});message='Bookmark moved.';});}}><option value="">Unfiled</option>{#each folders as f}<option value={String(f.id)}>{f.name}</option>{/each}</select></label>
            <button disabled={busy} on:click={() => run(async()=>{await request(`/api/posts/${item.post_id}/bookmark`,'DELETE');message='Bookmark removed.';})}>Remove bookmark</button></div>
          </article>
        {/each}
        <nav aria-label="Bookmark pages">{#if page > 1}<button disabled={busy} on:click={() => {page--;run(async()=>{});}}>Previous</button>{/if}<span>Page {page}</span>{#if hasMore}<button disabled={busy} on:click={() => {page++;run(async()=>{});}}>Next</button>{/if}</nav>
      </section>
    </div>
  {/if}
  {#if error}<p role="alert" class="form-error">{error}</p>{/if}{#if message}<p role="status">{message}</p>{/if}
</main>
<style>
  .bookmark-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:30px;margin-top:24px} aside form{margin:24px 0} label{display:flex;flex-direction:column;gap:8px} input,select{min-width:0;max-width:100%} button{margin:6px 0} article{padding:20px 0;border-bottom:1px solid var(--border,#ccd6cd)}.actions,nav{display:flex;flex-wrap:wrap;align-items:center;gap:16px} nav{margin-top:20px} h3{overflow-wrap:anywhere} @media(max-width:700px){.bookmark-layout{grid-template-columns:1fr}}
</style>
