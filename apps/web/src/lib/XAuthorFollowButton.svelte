<script>
  import { onMount } from 'svelte';
  import { normalizeXAuthorHandle } from '$lib/x-author-follow.mjs';
  import { loadXAuthorFollowState, setXAuthorFollow, xAuthorFollowState } from '$lib/x-author-follow-state.js';

  export let handle = '';
  let token = '';
  let ready = false;
  let busy = false;
  let error = '';
  let loginHref = '/login';
  $: normalizedHandle = normalizeXAuthorHandle(handle);
  $: following = Boolean($xAuthorFollowState[normalizedHandle]);

  onMount(async () => {
    token = localStorage.getItem('swartzit_session') ?? '';
    loginHref = `/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
    if (token) {
      try {
        await loadXAuthorFollowState(token);
      } catch (caught) {
        error = caught.message || 'Could not load followed people.';
      }
    }
    ready = true;
  });

  async function toggle() {
    if (!token) {
      location.assign(loginHref);
      return;
    }
    busy = true;
    error = '';
    try {
      await setXAuthorFollow(token, normalizedHandle, !following);
    } catch (caught) {
      error = caught.message || 'Could not update followed people.';
      if (error === 'Authentication required') {
        localStorage.removeItem('swartzit_session');
        token = '';
      }
    } finally {
      busy = false;
    }
  }
</script>

{#if normalizedHandle}
  {#if token}
    <button
      class="author-follow-button"
      class:following
      type="button"
      disabled={busy || !ready}
      aria-pressed={following}
      aria-label={following ? `Unfollow @${normalizedHandle}` : `Follow @${normalizedHandle}`}
      title={following ? `Unfollow @${normalizedHandle}` : `Follow @${normalizedHandle}`}
      onclick={toggle}
    >{busy ? 'Saving…' : following ? 'Following' : 'Follow'}</button>
  {:else}
    <a class="author-follow-button" href={loginHref} aria-label={`Sign in to follow @${normalizedHandle}`}>Follow</a>
  {/if}
  {#if error}<span class="follow-error" role="alert">{error}</span>{/if}
{/if}

<style>
  .author-follow-button{display:inline-flex;align-items:center;justify-content:center;min-height:29px;padding:4px 10px;border:1px solid var(--border,#c7ccc3);border-radius:999px;background:var(--surface,#fff);color:var(--heading,#173d34);font:700 .72rem ui-sans-serif,system-ui,sans-serif;text-decoration:none;white-space:nowrap;cursor:pointer}
  .author-follow-button:hover,.author-follow-button:focus-visible{border-color:var(--accent,#9b5e38);color:var(--accent,#9b5e38)}
  .author-follow-button.following{background:var(--subtle,#e4e9df)}
  .author-follow-button:disabled{opacity:.6;cursor:wait}
  .follow-error{max-width:220px;color:var(--error,#973c35);font-size:.68rem}
</style>
