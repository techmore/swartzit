<script>
  import { onMount } from 'svelte';
  import SessionNav from '$lib/SessionNav.svelte';
  import Brand from '$lib/Brand.svelte';
  import { parseXBookmarkImport, mergeXBookmarkImports } from '$lib/x-bookmarks.mjs';
  import { runXBookmarkImport, createBookmarkRequest } from '$lib/bookmark-import.mjs';
  let token = '', loaded = false, busy = false, error = '', folders = [], items = [], filter = 'all', page = 1, hasMore = false, name = '', rename = '', message = '';
  let newParentId = '', moveParentId = '', importFolderId = '', importRating = 'general';
  let importProgress = null, importSummary = '', importFailures = [], importPlan = null, previewLoading = false, ownerHandle = '';
  let previewVersion = 0;
  $: selected = folders.find(f => String(f.id) === filter);
  $: folderOptions = folders.map(folder => ({ ...folder, label: folderPath(folder.id) }));
  $: selectedPath = selected ? folderAncestors(selected.id) : [];
  $: subfolders = folders.filter(folder => selected ? folder.parent_id === selected.id : folder.parent_id == null);
  $: allowedParents = folders.filter(folder => !selected || (folder.id !== selected.id && !isDescendant(folder.id, selected.id)));
  async function request(path, method = 'GET', body) {
    const r = await fetch(path, {method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    const result = r.status === 204 ? null : await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(result?.error || 'Could not update bookmarks.');
    return result;
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
  onMount(async () => { token = localStorage.getItem('swartzit_session') || ''; if (token) await run(async()=>{ const session = await request('/api/me'); ownerHandle = session.handle; }); loaded = true; });
  function folderAncestors(id) {
    const result = [], visited = new Set();
    let folder = folders.find(item => item.id === id);
    while (folder && !visited.has(folder.id)) {
      result.unshift(folder);
      visited.add(folder.id);
      folder = folder.parent_id == null ? null : folders.find(item => item.id === folder.parent_id);
    }
    return result;
  }
  function folderPath(id) { return folderAncestors(id).map(folder => folder.name).join(' / '); }
  function isDescendant(candidateId, ancestorId) {
    let folder = folders.find(item => item.id === candidateId);
    while (folder?.parent_id != null) {
      if (folder.parent_id === ancestorId) return true;
      folder = folders.find(item => item.id === folder.parent_id);
    }
    return false;
  }
  function openFolder(id) { filter = String(id); changeFilter(); }
  function changeFilter() {
    page = 1;
    const folder = folders.find(item => String(item.id) === filter);
    rename = folder?.name || '';
    moveParentId = folder?.parent_id == null ? '' : String(folder.parent_id);
    newParentId = folder ? String(folder.id) : '';
    importFolderId = folder ? String(folder.id) : '';
    run(async()=>{});
  }
  async function create() {
    await run(async()=>{
      const folder = await request('/api/bookmark-folders','POST',{name,parent_id:newParentId ? Number(newParentId) : null});
      filter = String(folder.id); rename = name.trim(); moveParentId = newParentId; newParentId = String(folder.id); importFolderId = String(folder.id); name = ''; page = 1; message = 'Folder created.';
    });
  }
  async function deleteFolder() {
    await run(async()=>{await request('/api/bookmark-folders/'+filter,'DELETE'); filter = 'unfiled'; newParentId = ''; moveParentId = ''; page = 1; message = 'Folder deleted. Its bookmarks moved to its parent or Unfiled, and its subfolders moved up one level.';});
  }
  async function previewImport(files) {
    const version = ++previewVersion;
    importPlan = null; importSummary = ''; importFailures = []; error = ''; previewLoading = false;
    if (!files.length) return;
    previewLoading = true;
    try {
      if (files.reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024) {
        throw new Error('Choose up to 20 MB of bookmark files per import.');
      }
      const parts = [];
      for (const file of files) parts.push(parseXBookmarkImport(await file.text()));
      const plan = mergeXBookmarkImports(parts);
      if (version === previewVersion) importPlan = plan;
    } catch (cause) {
      if (version === previewVersion) error = cause.message || 'Could not read the bookmarks files.';
    } finally {
      if (version === previewVersion) previewLoading = false;
    }
  }
  function downloadFailures() {
    const data = { format: 'swartzit-x-bookmarks-v1', bookmarks: importFailures.map(item => ({ tweetId: item.id, folder_path: item.folderPath })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'x-bookmarks-retry.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importXBookmarks(event) {
    event.preventDefault(); error = ''; message = ''; importSummary = ''; importFailures = [];
    if (!importPlan || !ownerHandle) { error = 'Load your account and choose valid bookmark files first.'; return; }
    const plan = importPlan, folderId = importFolderId ? Number(importFolderId) : null, rating = importRating;
    busy = true;
    try {
      const result = await runXBookmarkImport({
        plan, expectedHandle: ownerHandle, folderId, rating,
        request: createBookmarkRequest({ token }),
        onProgress: (progress, failures) => { importProgress = progress; importFailures = failures; }
      });
      importSummary = `Saved ${result.saved.toLocaleString()} of ${result.total.toLocaleString()} X bookmarks to u/${ownerHandle}${result.failed ? `; ${result.failed.toLocaleString()} need attention` : ''}${result.pending ? `; ${result.pending.toLocaleString()} are waiting for moderation` : ''}.`;
      filter = folderId == null ? 'all' : String(folderId);
      page = 1;
      await refresh();
    } catch (cause) { error = cause.message || 'Could not finish the X bookmark import.'; }
    finally { busy = false; }
  }

</script>
<svelte:head><title>Bookmarks — Swartzit</title><meta name="robots" content="noindex" /></svelte:head>
<header><Brand /><SessionNav /></header>
<main>
  <h1>Your bookmarks</h1><p>Private to your account. Save discussions and organize them into folders.</p>
  {#if !loaded}<p role="status">Loading bookmarks…</p>
  {:else if !token}<p><a href="/login">Sign in</a> to save posts and manage folders.</p>
  {:else}
    <section class="x-bookmark-import" aria-labelledby="x-bookmark-import-title">
      <h2 id="x-bookmark-import-title">Import X bookmarks</h2>
      {#if ownerHandle}<p class="import-account">Private bookmarks will be saved to <strong>u/{ownerHandle}</strong>.</p>{/if}
      <p>Download and extract your <a href="https://help.x.com/en/managing-your-account/how-to-download-your-x-archive" target="_blank" rel="noopener noreferrer">X archive</a>, then choose its bookmarks <code>.js</code> or <code>.json</code> file. Posts not already on Swartzit will be cross-posted to c/x_imports, then saved in your selected private folder. Any folder paths in the import are recreated inside that folder; files without folder data stay in the selected folder. Existing Swartzit posts are bookmarked without creating duplicates.</p>
      <form on:submit|preventDefault={importXBookmarks}>
        <label>Bookmarks file(s)<input type="file" multiple accept=".js,.json,application/json,text/javascript" on:change={(event) => previewImport(Array.from(event.currentTarget.files || []))} disabled={busy} /></label>
        <label>Save imported posts to<select bind:value={importFolderId} disabled={busy}><option value="">Unfiled</option>{#each folderOptions as folder}<option value={String(folder.id)}>{folder.label}</option>{/each}</select></label>
        <label>Default content rating<select bind:value={importRating} disabled={busy}><option value="general">General</option><option value="r">R — mature themes</option><option value="x">X — explicit content</option></select></label>
        <button type="submit" disabled={busy || previewLoading || !importPlan || !ownerHandle}>{busy && importProgress ? (importProgress.preparing ? 'Preparing folder hierarchy…' : `Importing ${importProgress.completed.toLocaleString()} of ${importProgress.total.toLocaleString()}…`) : 'Import X bookmarks'}</button>
      </form>
      {#if previewLoading}<p role="status">Reading bookmark files…</p>{:else if importPlan}<p class="import-preview" role="status">Ready: {importPlan.bookmarks.length.toLocaleString()} unique bookmarks · {importPlan.folderPaths.length.toLocaleString()} folder paths to create or reuse.</p>{/if}
      <details class="folder-import-help"><summary>Import a folder hierarchy</summary><p>For a JSON export with named folders, use this format. You can nest folders up to 12 levels. Flat X archive files do not supply a hierarchy; they remain in the selected destination folder.</p><pre>{JSON.stringify({ format: 'swartzit-x-bookmarks-v1', folders: [{ name: 'Research', folders: [{ name: 'Linux', bookmarks: [{ tweetId: '123' }] }] }] }, null, 2)}</pre></details>
      <p class="import-note">The import is safe to repeat. Unavailable or private X posts are reported and skipped. Imported X posts are public in c/x_imports; choose the highest content rating that applies to this batch.</p>
      {#if importProgress}<progress value={importProgress.completed} max={importProgress.total} aria-label="X bookmark import progress"></progress><p class="import-progress">{importProgress.completed.toLocaleString()} / {importProgress.total.toLocaleString()} processed · {importProgress.saved.toLocaleString()} saved · {importProgress.failed.toLocaleString()} failed</p>{/if}
      {#if importSummary}<p role="status">{importSummary}</p>{/if}
      {#if importFailures.length}<details class="import-failures"><summary>{importFailures.length} failed post{importFailures.length === 1 ? '' : 's'}</summary><button type="button" disabled={busy} on:click={downloadFailures}>Download retry file</button><p>The retry file preserves every failed bookmark and its folder path. Select the same destination folder when importing it.</p><ul>{#each importFailures.slice(0, 25) as failure}<li><a href={`https://x.com/i/status/${failure.id}`} target="_blank" rel="noopener noreferrer">X post {failure.id}</a>: {failure.reason}</li>{/each}</ul></details>{/if}
    </section>
    <div class="bookmark-layout">
      <aside>
        <label>Browse <select bind:value={filter} on:change={changeFilter} disabled={busy}><option value="all">All bookmarks</option><option value="unfiled">Unfiled</option>{#each folderOptions as folder}<option value={String(folder.id)}>{folder.label} ({folder.count})</option>{/each}</select></label>
        <form on:submit|preventDefault={create}>
          <label>New folder<input bind:value={name} required maxlength="80" placeholder="e.g. Read later" /></label>
          <label>Inside folder<select bind:value={newParentId} disabled={busy}><option value="">Top level</option>{#each folderOptions as folder}<option value={String(folder.id)}>{folder.label}</option>{/each}</select></label>
          <button disabled={busy}>Create folder</button>
        </form>
        {#if selected}
          <form on:submit|preventDefault={() => run(async()=>{await request('/api/bookmark-folders/'+filter,'POST',{name:rename,parent_id:moveParentId ? Number(moveParentId) : null});message='Folder updated.';})}>
            <label>Folder name<input bind:value={rename} required maxlength="80" /></label>
            <label>Parent folder<select bind:value={moveParentId} disabled={busy}><option value="">Top level</option>{#each allowedParents as folder}<option value={String(folder.id)}>{folderPath(folder.id)}</option>{/each}</select></label>
            <button disabled={busy}>Save folder</button>
          </form>
          <p class="muted">Deleting moves its bookmarks to the parent or Unfiled, and moves subfolders up one level.</p><button disabled={busy} on:click={deleteFolder}>Delete folder</button>
        {/if}
      </aside>
      <section aria-label="Saved posts" aria-busy={busy}>
        <h2>{selected?.name || (filter === 'unfiled' ? 'Unfiled' : 'All bookmarks')}</h2>
        {#if selectedPath.length > 1}<nav class="breadcrumbs" aria-label="Folder breadcrumbs"><button type="button" on:click={() => { filter = 'all'; changeFilter(); }}>All bookmarks</button>{#each selectedPath as folder, index}<span aria-hidden="true">/</span>{#if index < selectedPath.length - 1}<button type="button" on:click={() => openFolder(folder.id)}>{folder.name}</button>{:else}<strong>{folder.name}</strong>{/if}{/each}</nav>{/if}
        {#if subfolders.length}<div class="subfolders" aria-label="Subfolders"><h3>Folders</h3>{#each subfolders as folder}<button type="button" disabled={busy} on:click={() => openFolder(folder.id)}><strong>{folder.name}</strong><span>{folder.count} saved</span></button>{/each}</div>{/if}
        {#if !items.length && !error}<p>No bookmarks here yet. Use “Bookmark” on any discussion to save it.</p>{/if}
        {#each items as item (item.post_id)}
          <article><small>c/{item.community} · Saved {new Date(item.created_at).toLocaleDateString()}</small><h3>{#if item.moderation_status === 'pending'}{item.title}{:else}<a href="/post/{item.public_id}">{item.title}</a>{/if}</h3>{#if item.moderation_status === 'pending'}<p class="pending-note">Waiting for moderation — visible only to you until approved.</p>{/if}
            <div class="actions"><label>Folder <select value={item.folder_id == null ? '' : String(item.folder_id)} disabled={busy} on:change={e => {const value=e.currentTarget.value;run(async()=>{await request(`/api/posts/${item.post_id}/bookmark`,'POST',{folder_id:value ? Number(value) : null});message='Bookmark moved.';});}}><option value="">Unfiled</option>{#each folderOptions as folder}<option value={String(folder.id)}>{folder.label}</option>{/each}</select></label>
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
  .folder-import-help{margin:12px 0;font-size:.82rem}.folder-import-help pre{max-height:240px;overflow:auto;padding:12px;background:var(--background,#f4f4ef)}.import-account,.import-preview,.pending-note{font-size:.82rem}.pending-note{color:var(--muted,#66766c)}
  .x-bookmark-import{margin-top:24px;padding:18px;border:1px solid var(--border,#ccd6cd);border-radius:10px;background:var(--surface,#fff)}.x-bookmark-import h2{margin:0 0 8px}.x-bookmark-import>p{max-width:850px;color:var(--muted,#66766c);font-size:.86rem}.x-bookmark-import form{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(180px,1fr) minmax(180px,1fr) auto;align-items:end;gap:12px;margin:16px 0}.x-bookmark-import label,aside label{display:flex;flex-direction:column;gap:8px}.x-bookmark-import input[type=file]{max-width:100%;padding:8px;border:1px solid var(--border,#c7ccc3);border-radius:6px}.x-bookmark-import form button{margin:0;min-height:40px}.import-note,.import-progress{font-size:.78rem!important}.x-bookmark-import progress{width:min(100%,720px);height:12px}.import-failures{font-size:.82rem;color:var(--muted,#66766c)}.import-failures li{margin:5px 0}.bookmark-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:30px;margin-top:24px}aside form{display:grid;gap:10px;margin:24px 0}aside label{gap:7px}input,select{min-width:0;max-width:100%}button{margin:6px 0}article{padding:20px 0;border-bottom:1px solid var(--border,#ccd6cd)}.actions,nav{display:flex;flex-wrap:wrap;align-items:center;gap:16px}nav{margin-top:20px}h3{overflow-wrap:anywhere}.breadcrumbs{margin:12px 0;color:var(--muted,#66766c);font-size:.84rem}.breadcrumbs button{background:none;padding:0;color:var(--link,#215e47)}.subfolders{display:grid;gap:8px;margin:16px 0}.subfolders h3{margin:0}.subfolders button{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0;padding:10px;border:1px solid var(--border,#ccd6cd);border-radius:7px;background:var(--surface,#fff);text-align:left}.subfolders button span{font-size:.76rem;color:var(--muted,#66766c)}@media(max-width:800px){.x-bookmark-import form{grid-template-columns:1fr 1fr}.x-bookmark-import form label:first-child{grid-column:1/-1}.x-bookmark-import form button{grid-column:1/-1}.bookmark-layout{grid-template-columns:1fr}}
</style>
