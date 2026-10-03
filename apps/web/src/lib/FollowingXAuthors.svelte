<script>
  import { onMount } from 'svelte';
  import { loadXAuthorFollowState, xAuthorFollowState } from '#lib/x-author-follow-state.js';
  import XAuthorFollowButton from '#lib/XAuthorFollowButton.svelte';

  let token = '';
  let ready = false;
  let error = '';
  $: handles = Object.keys($xAuthorFollowState).sort();

  onMount(async () => {
    token = localStorage.getItem('swartzit_session') ?? '';
    if (token) {
      try {
        await loadXAuthorFollowState(token);
      } catch (caught) {
        error = caught.message || 'Could not load followed people.';
      }
    }
    ready = true;
  });
</script>

{#if token}
  <section class="followed-people" aria-labelledby="followed-people-title">
    <div class="followed-people-heading"><h2 id="followed-people-title">People you follow</h2><span>on X</span></div>
    {#if error}<p role="alert">{error}</p>
    {:else if !ready}<p role="status">Loading followed people…</p>
    {:else if handles.length}
      <ul>{#each handles as handle}<li><a href={`https://x.com/${handle}`} target="_blank" rel="noopener noreferrer">@{handle}</a><XAuthorFollowButton handle={`@${handle}`} /></li>{/each}</ul>
    {:else}<p>Follow an author on a shared X post to add them here.</p>{/if}
  </section>
{/if}

<style>
  .followed-people{margin:0 0 22px;padding:14px 16px;border:1px solid var(--border,#c7ccc3);border-radius:10px;background:var(--surface,#fff)}
  .followed-people-heading{display:flex;align-items:baseline;gap:7px;margin-bottom:10px}
  .followed-people h2{margin:0;color:var(--heading,#173d34);font:700 .9rem ui-sans-serif,system-ui,sans-serif}
  .followed-people-heading>span,.followed-people p{color:var(--muted,#66766c);font-size:.75rem}
  .followed-people p{margin:0}
  .followed-people ul{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
  .followed-people li{display:flex;align-items:center;gap:7px;padding:5px 7px 5px 10px;border:1px solid var(--border,#c7ccc3);border-radius:999px;font-size:.8rem}
  .followed-people li>a{color:var(--heading,#173d34);font-weight:700;text-decoration:none}
</style>
