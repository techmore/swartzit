<script>
  import CommunityPicker from '$lib/CommunityPicker.svelte';
  import { preferredCommunity } from '$lib/community-picker-logic.mjs';
  export let communities = [];
  export let selectedCommunity = '';
  let url = '', community = '', contentRating = 'general', busy = false, error = '', notice = '', existingPost = '';
  let communityInitialized = false;
  $: if (!communityInitialized && communities.length) {
    community = preferredCommunity(communities, selectedCommunity);
    communityInitialized = true;
  }

  async function submit(event) {
    event.preventDefault();
    busy = true; error = ''; notice = ''; existingPost = '';
    try {
      const token = localStorage.getItem('swartzit_session') || '';
      const response = await fetch('/api/cross-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ url, community, content_rating: contentRating })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not share that post.');
      if (result.already_shared) {
        existingPost = result.public_id;
        notice = `That source is already shared in c/${result.community}.`;
      } else if (result.status === 'pending') {
        url = '';
        notice = result.message || 'The shared post is waiting for moderator review.';
      } else {
        window.location.assign(`/post/${result.public_id}`);
      }
    } catch (cause) {
      error = cause.message || 'Could not reach Swartzit.';
    } finally {
      busy = false;
    }
  }
</script>

<section class="quick-crosspost" aria-labelledby="crosspost-title">
  <div class="crosspost-heading">
    <div><p class="eyebrow">BRING A SOURCE INTO THE CONVERSATION</p><h2 id="crosspost-title">Share a post</h2></div>
    <p>Paste a public X, Reddit, or YouTube video link. YouTube videos stay hosted by YouTube and are embedded here.</p>
  </div>
  <form on:submit={submit}>
    <label class="source-field">Post URL
      <input type="url" bind:value={url} required maxlength="2048" placeholder="https://x.com/… reddit.com/… or youtube.com/watch?v=…" autocomplete="url" />
    </label>
    <CommunityPicker communities={communities} bind:value={community} id="crosspost-community" />
    <label class="rating-field">Content rating
      <select bind:value={contentRating} aria-describedby="crosspost-rating-help">
        <option value="general">General</option>
        <option value="r">R — mature themes</option>
        <option value="x">X — explicit content</option>
      </select>
    </label>
    <button type="submit" disabled={busy || !community}>{busy ? 'Fetching post…' : 'Share link'}</button>
  </form>
  <p class="crosspost-note" id="crosspost-rating-help">Choose the highest rating that applies before sharing. Original author and source link stay attached. Duplicate links open the existing discussion.</p>
  {#if error}<p class="crosspost-feedback error" role="alert">{error}</p>{/if}
  {#if notice}<p class="crosspost-feedback" role="status">{notice}{#if existingPost} <a href={'/post/' + existingPost}>Open it →</a>{/if}</p>{/if}
</section>

<style>
  .quick-crosspost{margin:0 0 24px;padding:16px 18px;border:1px solid var(--border,#d8d5ca);border-radius:10px;background:var(--surface,#fff)}
  .crosspost-heading{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:12px}
  .eyebrow{margin:0 0 4px;font-size:.64rem;letter-spacing:.13em;color:var(--accent,#9b5e38);font-weight:700}
  h2{margin:0;color:var(--heading,#173d34);font:500 1.35rem/1.15 Georgia,serif}
  .crosspost-heading>p{max-width:360px;margin:0;color:var(--muted,#66766c);font-size:.8rem}
  form{display:grid;grid-template-columns:minmax(0,1fr) 175px 150px auto;align-items:end;gap:10px}
  label{display:grid;gap:5px;color:var(--muted,#66766c);font-size:.76rem;font-weight:650}
  input{width:100%;min-width:0;height:40px;border:1px solid var(--border,#c7ccc3);border-radius:6px;padding:8px 10px;background:var(--page,#f6f4ee);font:inherit;font-size:.86rem}
  select{width:100%;height:40px;border:1px solid var(--border,#c7ccc3);border-radius:6px;padding:0 10px;background:var(--page,#f6f4ee);font:inherit;font-size:.82rem}
  form :global(.community-picker){min-width:0}
  form :global(.community-picker label){font-size:.76rem}
  form button{height:40px;padding:0 14px;border-radius:6px;white-space:nowrap;font-size:.84rem}
  form button:disabled{opacity:.65;cursor:wait}
  .crosspost-note,.crosspost-feedback{margin:8px 0 0;color:var(--muted,#77827d);font-size:.73rem}
  .crosspost-feedback a{color:var(--link,#215e47);font-weight:700;text-decoration:underline}
  .crosspost-feedback.error{color:var(--error,#a33932)}
  @media(max-width:700px){.quick-crosspost{margin:0 18px 18px;padding:14px}.crosspost-heading{display:block}.crosspost-heading>p{margin-top:5px}form{grid-template-columns:minmax(0,1fr) auto}.source-field,.rating-field{grid-column:1/-1}form :global(.community-picker){grid-column:1}form button{grid-column:2;grid-row:4}}
</style>
