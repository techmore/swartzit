<script>
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import CommunityPicker from '#lib/CommunityPicker.svelte';
  import QuickCrossPost from '#lib/QuickCrossPost.svelte';
  import Icon from '#lib/Icon.svelte';
  import { preferredCommunity } from '#lib/community-picker-logic.mjs';
  import { copyPostLink, loadCopyLinkPreference } from '#lib/post-preferences.mjs';

  export let communities = [];
  export let selectedCommunity = 'general';
  export let open = false;
  export let mode = 'post';

  let token = '';
  let community = 'general';
  let communityInitialized = false;
  let title = '';
  let body = '';
  let contentRating = 'general';
  let busy = false;
  let error = '';
  let notice = '';
  let copyLinkAfterPost = true;
  let preferencesLoaded = false;
  let createdPostUrl = '';
  let panel;
  let opener = null;

  $: if (!communityInitialized && communities.length) {
    community = preferredCommunity(communities, selectedCommunity);
    communityInitialized = true;
  }

  async function loadCommunities() {
    if (communities.length) return;
    try {
      const response = await fetch('/api/communities');
      if (response.ok) {
        const result = await response.json();
        communities = Array.isArray(result) ? result : result.communities || [];
      }
    } catch { /* General remains the default when community discovery is unavailable. */ }
  }

  async function show(requestedMode = 'post') {
    token = localStorage.getItem('swartzit_session') || '';
    if (!token) { location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search)); return; }
    opener = document.activeElement;
    const fromUrl = page.url.pathname === '/' ? page.url.searchParams.get('community') : '';
    selectedCommunity = fromUrl || 'general';
    communityInitialized = false;
    mode = requestedMode;
    error = ''; notice = ''; createdPostUrl = '';
    open = true;
    await loadCommunities();
    if (!preferencesLoaded) { copyLinkAfterPost = await loadCopyLinkPreference(fetch, token); preferencesLoaded = true; }
    await tick();
    (panel?.querySelector('input[maxlength="300"]') ?? panel?.querySelector('input, textarea'))?.focus();
  }

  function close() {
    open = false;
    opener?.focus?.();
  }

  function keydown(event) {
    if (!open) return;
    if (event.key === 'Escape') { close(); return; }
    if (event.key !== 'Tab' || !panel) return;
    const focusable = [...panel.querySelectorAll('button, input, textarea, select, a[href], summary, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  onMount(() => {
    const onCompose = event => show(event.detail?.mode === 'x' ? 'x' : 'post');
    window.addEventListener('swartzit:compose', onCompose);
    return () => window.removeEventListener('swartzit:compose', onCompose);
  });

  function selectMode(value) {
    mode = value;
    error = '';
    notice = '';
  }

  async function createPost(event) {
    event.preventDefault();
    busy = true;
    error = '';
    notice = '';
    createdPostUrl = '';
    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ community: community || 'general', title, body, content_rating: contentRating })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not publish this post.');
      if (result.status === 'pending') {
        title = '';
        body = '';
        contentRating = 'general';
        notice = result.message || 'Your post is waiting for moderator review.';
      } else {
        const postUrl = new URL(`/post/${encodeURIComponent(result.public_id)}`, window.location.origin).href;
        if (copyLinkAfterPost) {
          const copied = await copyPostLink(result.public_id, navigator, document, window.location.origin);
          if (!copied) {
            title = '';
            body = '';
            contentRating = 'general';
            createdPostUrl = postUrl;
            notice = 'Your post is published, but the browser blocked clipboard access. Open it to copy the link.';
            return;
          }
        }
        window.location.assign(`/post/${encodeURIComponent(result.public_id)}`);
      }
    } catch (cause) {
      error = cause.message || 'Could not reach Swartzit.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window on:keydown={keydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" on:click|self={close}>
    <div class="compose-panel" id="compose-panel" role="dialog" aria-modal="true" aria-labelledby="compose-title" bind:this={panel}>
      <div class="head">
        <h2 id="compose-title">New post</h2>
        <button class="icon-btn" type="button" aria-label="Close" on:click={close}><Icon name="x" size={20} /></button>
      </div>
      <div class="tabs" role="tablist" aria-label="Post type">
        <button type="button" role="tab" aria-selected={mode === 'post'} class:active={mode === 'post'} on:click={() => selectMode('post')}><Icon name="pen" size={16} />Write</button>
        <button type="button" role="tab" aria-selected={mode === 'x'} class:active={mode === 'x'} on:click={() => selectMode('x')}><Icon name="link" size={16} />Share a link</button>
      </div>
      {#if mode === 'x'}
        <QuickCrossPost {communities} selectedCommunity="general" xOnly hideCommunity />
      {:else}
        <form class="post-form" on:submit={createPost}>
          <CommunityPicker {communities} bind:value={community} id="composer-community" />
          <label>Title<input bind:value={title} required maxlength="300" placeholder="What's this about?" /></label>
          <label>Body<textarea bind:value={body} maxlength="50000" rows="6" placeholder="Share your thoughts…" aria-describedby="composer-body-help"></textarea><small id="composer-body-help">Paste a YouTube link and it will be embedded automatically.</small></label>
          <label>Content rating<select bind:value={contentRating} aria-describedby="composer-rating-help"><option value="general">General</option><option value="r">R — mature themes</option><option value="x">X — explicit content</option></select><small id="composer-rating-help">Choose the highest rating that applies.</small></label>
          {#if error}<p class="form-error" role="alert">{error}</p>{/if}
          {#if notice}<p class="form-message" role="status">{notice}</p>{/if}
          {#if createdPostUrl}<a class="created-post-link" href={createdPostUrl}>Open the published post →</a>{/if}
          <div class="footer"><button class="secondary" type="button" on:click={close}>Cancel</button><button class="publish-button" type="submit" disabled={busy || !preferencesLoaded}>{busy ? 'Publishing…' : 'Publish'}</button></div>
        </form>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 16px; background: rgb(15 15 8 / .55); backdrop-filter: blur(3px); overflow-y: auto; }
  .compose-panel { width: min(580px, 100%); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 22px; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-lg); }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  h2 { margin: 0; font: 600 1.4rem var(--font-serif); }
  .tabs { display: flex; gap: 4px; padding: 4px; margin-bottom: 18px; border-radius: 999px; background: var(--surface2); }
  .tabs button { flex: 1; background: transparent; color: var(--muted); border-radius: 999px; }
  .tabs button.active { background: var(--surface); color: var(--heading); box-shadow: var(--shadow-sm); }
  .post-form { display: grid; gap: 14px; }
  .post-form > label { display: grid; gap: 6px; }
  .post-form :global(.community-picker) { margin: 0; }
  .footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
  .created-post-link { color: var(--link); font-weight: 700; font-size: .9rem; }
  :global(.compose-panel .quick-crosspost) { margin: 0; padding: 0; border: 0; background: transparent; box-shadow: none; }
  :global(.compose-panel .crosspost-heading) { display: none; }
  :global(.compose-panel .quick-crosspost form) { grid-template-columns: 1fr; gap: 12px; }
  :global(.compose-panel .quick-crosspost form button) { width: 100%; }
  @media (max-width: 700px) {
    .scrim { place-items: end center; padding: 0; }
    .compose-panel { width: 100%; max-height: 92dvh; border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: 18px 16px calc(18px + env(safe-area-inset-bottom)); }
  }
</style>
