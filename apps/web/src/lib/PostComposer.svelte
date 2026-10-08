<script>
  import { onMount } from 'svelte';
  import CommunityPicker from '#lib/CommunityPicker.svelte';
  import QuickCrossPost from '#lib/QuickCrossPost.svelte';
  import { preferredCommunity } from '#lib/community-picker-logic.mjs';
  import { copyPostLink, loadCopyLinkPreference } from '#lib/post-preferences.mjs';

  export let communities = [];
  export let selectedCommunity = 'general';
  export let open = false;
  export let mode = 'post';
  export let showVisitorLauncher = true;

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

  $: if (!communityInitialized && communities.length) {
    community = preferredCommunity(communities, selectedCommunity);
    communityInitialized = true;
  }

  onMount(async () => {
    token = localStorage.getItem('swartzit_session') || '';
    copyLinkAfterPost = await loadCopyLinkPreference(fetch, token);
    preferencesLoaded = true;
    if (!communities.length) {
      try {
        const response = await fetch('/api/communities');
        if (response.ok) {
          const result = await response.json();
          communities = Array.isArray(result) ? result : result.communities || [];
        }
      } catch { /* General remains the default when community discovery is unavailable. */ }
    }
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

{#if token || showVisitorLauncher}
<div class="composer-launcher" class:visitor={!token} aria-label="Create a post">
  {#if token}
    <button type="button" class="launcher-x" onclick={() => { open = true; selectMode('x'); }} aria-label="Cross-post from X" aria-controls="compose-panel" aria-expanded={open && mode === 'x'}>𝕏 Post</button>
    <button type="button" class="launcher-post" onclick={() => { open = true; selectMode('post'); }} aria-label="Create a post" aria-controls="compose-panel" aria-expanded={open && mode === 'post'}>＋ Post</button>
  {:else}
    <a class="launcher-post" href="/login">Sign in to post</a>
  {/if}
</div>
{/if}

{#if open && token}
  <section class="compose-panel" id="compose-panel" aria-labelledby="compose-title">
    <div class="compose-panel-heading">
      <div><p class="eyebrow">ADD TO THE COMMONS</p><h2 id="compose-title">{mode === 'x' ? 'Cross-post a link' : 'Create a post'}</h2></div>
      <button class="panel-close" type="button" aria-label="Close composer" title="Close composer" onclick={() => open = false}>×</button>
    </div>
    {#if mode === 'x'}
      <QuickCrossPost {communities} selectedCommunity="general" xOnly hideCommunity />
    {:else}
      <form class="post-form" onsubmit={createPost}>
        <CommunityPicker {communities} bind:value={community} id="composer-community" />
        <label>Title<input bind:value={title} required maxlength="300" /></label>
        <label>Body<textarea bind:value={body} maxlength="50000" rows="5" aria-describedby="composer-body-help"></textarea><small id="composer-body-help">Paste a YouTube video URL here and it will be embedded automatically.</small></label>
        <label>Content rating<select bind:value={contentRating} aria-describedby="composer-rating-help"><option value="general">General</option><option value="r">R — mature themes</option><option value="x">X — explicit content</option></select><small id="composer-rating-help">Choose the highest rating that applies.</small></label>
        <button class="publish-button" type="submit" disabled={busy || !preferencesLoaded}>{busy ? 'Publishing…' : 'Publish'}</button>
        {#if error}<p class="form-error" role="alert">{error}</p>{/if}
        {#if notice}<p class="form-message" role="status">{notice}</p>{/if}
        {#if createdPostUrl}<a class="created-post-link" href={createdPostUrl}>Open the published post →</a>{/if}
      </form>
    {/if}
  </section>
{/if}

<style>
  .composer-launcher{position:fixed;right:24px;bottom:132px;z-index:40;display:grid;gap:8px}
  .composer-launcher.visitor{position:static;display:flex;justify-content:flex-end;margin:20px 0}
  .composer-launcher.visitor a{box-shadow:none}
  @media(max-width:700px){.composer-launcher.visitor{margin:20px 18px}}
  .composer-launcher button,.composer-launcher a{min-width:106px;height:42px;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--accent,#575d3d);border-radius:999px;padding:0 14px;background:var(--surface,#fff);color:var(--heading,#173d34);box-shadow:0 7px 20px #0002;font:750 .8rem ui-sans-serif,system-ui,sans-serif;text-decoration:none;cursor:pointer}
  .composer-launcher .launcher-x{background:var(--heading,#173d34);border-color:var(--heading,#173d34);color:#fff}
  .composer-launcher button:hover,.composer-launcher button:focus-visible{transform:translateY(-2px);box-shadow:0 10px 24px #0003}
  .compose-panel{position:fixed;right:24px;bottom:230px;z-index:41;width:min(430px,calc(100vw - 32px));max-height:calc(100dvh - 250px);overflow-y:auto;overscroll-behavior:contain;padding:19px;border:1px solid var(--border,#c7ccc3);border-radius:14px;background:var(--surface,#fff);box-shadow:0 16px 45px #0003}
  .compose-panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px}
  .eyebrow{margin:0 0 4px;font-size:.64rem;letter-spacing:.13em;color:var(--accent,#9b5e38);font-weight:700}
  h2{margin:0;color:var(--heading,#173d34);font:500 1.4rem/1.1 Georgia,serif}
  .panel-close{width:32px;height:32px;border:0;border-radius:50%;background:var(--subtle,#e4e9df);color:var(--heading,#173d34);font-size:1.35rem;cursor:pointer}
  .post-form{display:grid;gap:10px}
  .post-form>label{display:grid;gap:5px;color:var(--muted,#66766c);font-size:.76rem;font-weight:700}
  .post-form input,.post-form textarea,.post-form select{width:100%;border:1px solid var(--border,#c7ccc3);border-radius:7px;padding:9px 10px;background:var(--page,#f6f4ee);font:inherit}
  .post-form select{height:40px;padding:0 10px}
  .post-form label small{font-size:.68rem;font-weight:500;line-height:1.35}
  .post-form textarea{resize:vertical;min-height:92px}
  .post-form :global(.community-picker){margin:0}
  .publish-button{height:38px;border-radius:7px}
  .form-error,.form-message{margin:0;font-size:.78rem}
  .form-error{color:var(--error,#a33932)}
  .form-message{color:var(--link,#215e47)}
  .created-post-link{color:var(--link,#215e47);font-size:.82rem;font-weight:700}
  :global(.compose-panel .quick-crosspost){margin:0;padding:0;border:0;background:transparent}
  :global(.compose-panel .crosspost-heading){display:none}
  :global(.compose-panel .crosspost-note){margin:8px 0 0}
  :global(.compose-panel .quick-crosspost form){grid-template-columns:1fr;gap:10px}
  :global(.compose-panel .quick-crosspost form.x-only-form){grid-template-columns:minmax(0,1fr) auto;align-items:center}
  :global(.compose-panel .quick-crosspost form.x-only-form .source-field){grid-column:1;grid-row:1}
  :global(.compose-panel .quick-crosspost form.x-only-form .optional-rating){grid-column:1;grid-row:2}
  :global(.compose-panel .quick-crosspost form.x-only-form button){grid-column:2;grid-row:1 / span 2;width:auto}
  :global(.compose-panel .quick-crosspost form button){width:100%}
  @media(max-width:700px){.composer-launcher{right:16px;bottom:126px}.composer-launcher button,.composer-launcher a{min-width:96px;height:40px}.compose-panel{right:12px;bottom:218px;width:min(430px,calc(100vw - 24px));max-height:calc(100dvh - 238px);padding:16px}}
</style>
