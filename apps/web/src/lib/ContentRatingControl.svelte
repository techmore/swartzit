<script>
  /**
   * Admin-only control for correcting a post's content rating after the fact.
   *
   * Content arrives rated by the uploader or the automatic classifier and both
   * get it wrong often enough that a mistaken upload needs undoing without
   * waiting for the person who made it. The rating is the field the feed's
   * `hide_r` and `hide_x` filters read, so a correction here is what actually
   * stops a post being served to readers who asked not to see it.
   *
   * This renders nothing at all for a signed-out reader or a non-admin, so the
   * affordance is not merely hidden behind a click.
   */
  import { onMount } from 'svelte';
  import { createEventDispatcher } from 'svelte';

  export let postId;
  export let rating = 'general';

  const dispatch = createEventDispatcher();
  const RATINGS = [
    { value: 'general', label: 'General' },
    { value: 'r', label: 'R' },
    { value: 'x', label: 'X' }
  ];

  let token = '';
  let isAdmin = false;
  let open = false;
  let choice = rating;
  let reason = '';
  let busy = false;
  let message = '';
  let failure = '';

  onMount(async () => {
    token = localStorage.getItem('swartzit_session') ?? '';
    if (!token) return;
    try {
      const response = await fetch('/api/me', { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      isAdmin = (await response.json()).is_admin === true;
      if (isAdmin) choice = rating;
    } catch {
      isAdmin = false;
    }
  });

  // The page can re-render with a different post; keep the control in step.
  $: if (isAdmin && !busy && rating !== choice) choice = rating;

  async function save() {
    if (busy) return;
    busy = true;
    message = '';
    failure = '';
    try {
      const response = await fetch(`/api/admin/posts/${postId}/content-rating`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ content_rating: choice, reason: reason.trim() || null })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        failure = result.error || 'Could not change the rating.';
        return;
      }
      // Adopt the server's answer rather than assuming ours, so the badge can
      // never claim a rating the database did not store.
      dispatch('update', { content_rating: result.content_rating });
      message = `Saved as ${String(result.content_rating).toUpperCase()}.`;
      reason = '';
      open = false;
    } catch {
      failure = 'Could not reach the server.';
    } finally {
      busy = false;
    }
  }
</script>

{#if isAdmin}
  <div class="rating-admin">
    {#if !open}
      <button
        class="rating-admin-toggle"
        type="button"
        aria-expanded={open}
        on:click={() => { open = true; choice = rating; message = ''; failure = ''; }}
      >
        Rating: {String(rating).toUpperCase()}
      </button>
    {:else}
      <form class="rating-admin-form" on:submit|preventDefault={save}>
        <fieldset>
          <legend>Correct content rating</legend>
          {#each RATINGS as option}
            <label>
              <input type="radio" name="rating" value={option.value} bind:group={choice} />
              <span>{option.label}</span>
            </label>
          {/each}
        </fieldset>
        <label>
          Reason (optional, recorded in the audit log)
          <input type="text" bind:value={reason} maxlength="200" placeholder="Uploaded in the wrong community" />
        </label>
        <div class="rating-admin-actions">
          <button type="submit" disabled={busy || choice === rating}>
            {busy ? 'Saving…' : 'Save rating'}
          </button>
          <button type="button" disabled={busy} on:click={() => { open = false; choice = rating; }}>
            Cancel
          </button>
        </div>
        {#if message}<p class="rating-admin-message">{message}</p>{/if}
        {#if failure}<p class="rating-admin-error" role="alert">{failure}</p>{/if}
      </form>
    {/if}
  </div>
{/if}

<style>
  .rating-admin{margin:0 0 14px}
  .rating-admin-toggle{font:inherit;font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#66766c);background:transparent;border:1px dashed var(--border,#c7ccc3);border-radius:6px;padding:5px 9px;cursor:pointer}
  .rating-admin-toggle:hover{color:var(--accent,#575d3d);border-color:var(--accent,#575d3d)}
  .rating-admin-form{display:grid;gap:10px;padding:12px;border:1px solid var(--border,#c7ccc3);border-radius:8px;background:var(--surface,#fbfbf8);font-size:.82rem}
  fieldset{display:flex;gap:14px;align-items:center;border:0;padding:0;margin:0;flex-wrap:wrap}
  legend{font-weight:700;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#66766c);padding:0}
  fieldset label{display:flex;gap:5px;align-items:center}
  .rating-admin-form>label{display:grid;gap:4px;font-weight:600}
  .rating-admin-form input[type=text]{font:inherit;padding:7px 9px;border:1px solid var(--border,#bbc5bc);border-radius:6px}
  .rating-admin-actions{display:flex;gap:8px}
  .rating-admin-actions button{font:inherit;padding:7px 13px;border-radius:6px;cursor:pointer}
  .rating-admin-actions button[type=submit]{border:1px solid var(--link,#215e47);background:var(--link,#215e47);color:#fff}
  .rating-admin-actions button[type=submit]:disabled{opacity:.55;cursor:not-allowed}
  .rating-admin-message{margin:0;color:var(--link,#215e47)}
  .rating-admin-error{margin:0;color:var(--error,#973c35)}
</style>
