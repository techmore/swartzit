<script>
  import { onMount } from 'svelte';
  export let id;
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
      const status = await request(`/api/posts/${id}/bookmark`);
      saved = status.saved; folder = status.folder_id == null ? '' : String(status.folder_id); ready = true;
    } catch (e) {
      if (e.message === 'Authentication required') {
        localStorage.removeItem('swartzit_session');
        token = '';
      } else error = e.message;
    }
  });
  async function loadFolders() {
    try { folders = await request('/api/bookmark-folders'); } catch (e) { error = e.message; }
  }
  async function save(remove = false) {
    busy = true; error = '';
    try {
      await request(`/api/posts/${id}/bookmark`, remove ? 'DELETE' : 'POST', remove ? undefined : {folder_id:folder ? Number(folder) : null});
      saved = !remove;
    } catch (e) { error = e.message; }
    finally { busy = false; }
  }
</script>
{#if token}
  <div class="bookmark-control">
    <button class="vote-button" disabled={busy || !ready} aria-label={saved ? 'Remove bookmark' : 'Bookmark post'} title={saved ? 'Remove bookmark' : 'Bookmark post'} aria-pressed={saved} on:click={() => save(saved)}>{saved ? '★' : '☆'}</button>
    {#if saved}<details on:toggle={e => { if (e.currentTarget.open) loadFolders(); }}>
      <summary>Save to folder</summary>
      <form on:submit|preventDefault={() => save()}>
        <label>Folder <select bind:value={folder}><option value="">Unfiled</option>{#each folders as f}<option value={String(f.id)}>{f.name}</option>{/each}</select></label>
        <button disabled={busy || !ready}>{saved ? 'Move bookmark' : 'Save bookmark'}</button>
        <a href="/bookmarks">Manage folders</a>
      </form>
    </details>{/if}
    {#if error}<span role="alert">{error}</span>{/if}
  </div>
{/if}
<style>
  .bookmark-control{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:12px 0;font-size:.85rem}
  summary{cursor:pointer} form{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:10px 0} select{max-width:220px} [role=alert]{color:var(--error,#973c35)}
</style>
