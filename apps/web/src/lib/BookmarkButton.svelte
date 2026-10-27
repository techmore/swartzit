<script>
  import { onMount } from 'svelte';
  import Icon from '#lib/Icon.svelte';
  import { getBookmarkFolders, getBookmarkStatus, setBookmarkStatus } from '#lib/bookmark-state.js';
  export let id;
  let folderMenu;
  let token = '', saved = false, folder = '', folders = [], busy = false, ready = false, error = '';
  async function request(path, method = 'GET', body) {
    const r = await fetch(path, {method, headers:{authorization:`Bearer ${token}`, 'content-type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body)});
    if (!r.ok) throw new Error((await r.json()).error || 'Could not update bookmark.');
    return r.status === 204 ? null : r.json();
  }
  onMount(async () => {
    token = localStorage.getItem('swartzit_session') || '';
    if (!token) return;
    try {
      const status = await getBookmarkStatus(token, id);
      saved = status.saved; folder = status.folder_id == null ? '' : String(status.folder_id); ready = true;
    } catch (e) {
      if (e.message === 'Authentication required') {
        localStorage.removeItem('swartzit_session');
        token = '';
      } else error = e.message;
    }
  });
  async function loadFolders() {
    try { folders = await getBookmarkFolders(token); } catch (e) { error = e.message; }
  }
  async function save(remove = false) {
    busy = true; error = '';
    try {
      await request(`/api/posts/${id}/bookmark`, remove ? 'DELETE' : 'POST', remove ? undefined : {folder_id:folder ? Number(folder) : null});
      saved = !remove;
      setBookmarkStatus(token, id, {saved, folder_id: saved && folder ? Number(folder) : null});
    } catch (e) { error = e.message; }
    finally { busy = false; }
  }
</script>
{#if token}
  <div class="bookmark-control">
    <button class="bookmark-toggle pill" class:saved disabled={busy || !ready} aria-label={saved ? 'Remove bookmark' : 'Bookmark post'} title={saved ? 'Remove bookmark' : 'Bookmark post'} aria-pressed={saved} on:click={() => save(saved)}><Icon name="bookmark" size={16} filled={saved} /><span class="label">{saved ? 'Saved' : 'Save'}</span></button>
    {#if saved}<details class="folder-menu menu" bind:this={folderMenu} on:toggle={e => { if (e.currentTarget.open) loadFolders(); }}>
      <summary class="pill" aria-label="Choose bookmark folder" title="Move to a folder"><Icon name="chevron-down" size={16} /></summary>
      <form class="menu-panel" on:submit|preventDefault={async () => { await save(); if (folderMenu) folderMenu.open = false; }}>
        <label>Folder <select bind:value={folder}><option value="">Unfiled</option>{#each folders as f}<option value={String(f.id)}>{f.name}</option>{/each}</select></label>
        <button disabled={busy || !ready}>Move bookmark</button>
        <a href="/bookmarks">Manage folders</a>
      </form>
    </details>{/if}
    {#if error}<span class="err" role="alert">{error}</span>{/if}
  </div>
{/if}
<style>
  .bookmark-control { display: inline-flex; align-items: center; gap: 4px; }
  .pill { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--muted); font-size: .8rem; font-weight: 600; cursor: pointer; }
  .pill:hover:not(:disabled) { background: var(--hover); color: var(--heading); filter: none; }
  .bookmark-toggle.saved { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .folder-menu > summary { padding: 0 10px; }
  .folder-menu .menu-panel { right: auto; left: 0; display: grid; gap: 10px; width: 250px; padding: 14px; }
  .folder-menu .menu-panel label { display: grid; gap: 6px; }
  .folder-menu .menu-panel a { font-size: .8rem; color: var(--link); text-decoration: underline; text-underline-offset: 3px; }
  .err { color: var(--error); font-size: .8rem; }
  @media (max-width: 460px) { .label { display: none; } .pill { padding: 0 12px; } }
</style>
