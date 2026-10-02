<script>
  import { onMount } from 'svelte';

  let token = '';
  let copyLinkAfterPost = true;
  let loading = true;
  let saving = false;
  let error = '';
  let message = '';

  onMount(load);

  async function load() {
    loading = true;
    error = '';
    token = localStorage.getItem('swartzit_session') ?? '';
    if (!token) {
      loading = false;
      error = 'Sign in to change your post preferences.';
      return;
    }
    try {
      const response = await fetch('/api/me/post-preferences', {
        headers: { authorization: 'Bearer ' + token }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load your post preferences.');
      copyLinkAfterPost = result.copy_link_after_post !== false;
    } catch (cause) {
      error = cause.message || 'Could not reach Swartzit.';
    } finally {
      loading = false;
    }
  }

  async function savePreference() {
    const nextValue = copyLinkAfterPost;
    saving = true;
    error = '';
    message = '';
    try {
      const response = await fetch('/api/me/post-preferences', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ copy_link_after_post: nextValue })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save your post preferences.');
      copyLinkAfterPost = result.copy_link_after_post !== false;
      message = 'Post preferences saved.';
    } catch (cause) {
      copyLinkAfterPost = !nextValue;
      error = cause.message || 'Could not reach Swartzit.';
    } finally {
      saving = false;
    }
  }
</script>

<section class="post-preferences panel" aria-labelledby="post-preferences-title">
  <h2 id="post-preferences-title">Post preferences</h2>
  <p class="intro">Choose what Swartzit does after you publish a post.</p>
  {#if loading}
    <p class="muted" role="status">Loading post preferences…</p>
  {:else if error && !token}
    <p class="error" role="alert">{error}</p>
  {:else}
    <label class="preference">
      <input type="checkbox" bind:checked={copyLinkAfterPost} disabled={saving} onchange={savePreference} />
      <span>Copy the post link after publishing</span>
    </label>
    <p class="hint">The link is copied after a new post publishes. Turn this off to leave your clipboard unchanged.</p>
    {#if message}<p class="message" role="status">{message}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</section>

<style>
  .post-preferences{margin-top:18px;padding:22px 24px}
  h2{margin:0;color:var(--heading,#173d34);font:500 1.45rem/1.15 Georgia,serif}
  .intro,.hint,.muted,.message,.error{font-size:.82rem;line-height:1.45}
  .intro{margin:9px 0 14px;color:var(--muted,#66766c)}
  .preference{display:flex;align-items:center;gap:9px;color:var(--heading,#173d34);font-size:.82rem;font-weight:650}
  .preference input{accent-color:var(--accent,#9b5e38)}
  .hint{margin:6px 0 0 25px;color:var(--muted,#77827d)}
  .muted,.message,.error{margin:10px 0 0}
  .muted{color:var(--muted,#77827d)}.message{color:var(--accent,#575d3d)}.error{color:var(--error,#973c35)}
  @media(max-width:600px){.post-preferences{padding:18px}.hint{margin-left:0}}
</style>
