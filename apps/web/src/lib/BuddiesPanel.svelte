<script>
  import { onMount } from 'svelte';
  import AuthorAvatar from '#lib/AuthorAvatar.svelte';

  let token = '', buddies = [], loading = true, error = '', busyHandle = '';

  async function refresh() {
    loading = true;
    error = '';
    try {
      const response = await fetch('/api/buddies', {
        headers: { authorization: 'Bearer ' + token }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load your buddies.');
      buddies = Array.isArray(result) ? result : [];
    } catch (cause) {
      error = cause.message || 'Could not reach Swartzit.';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    token = localStorage.getItem('swartzit_session') ?? '';
    if (token) refresh();
    else loading = false;
  });

  async function updateBuddy(buddy, action) {
    busyHandle = buddy.handle;
    error = '';
    try {
      const response = action === 'pin'
        ? await fetch(`/api/buddies/${encodeURIComponent(buddy.handle)}/pin`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
            body: JSON.stringify({ pinned: !buddy.pinned })
          })
        : await fetch(`/api/buddies/${encodeURIComponent(buddy.handle)}`, {
            method: 'DELETE',
            headers: { authorization: 'Bearer ' + token }
          });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update this buddy.');
      await refresh();
    } catch (cause) {
      error = cause.message || 'Could not reach Swartzit.';
    } finally {
      busyHandle = '';
    }
  }
</script>

<section class="buddies-panel" aria-labelledby="buddies-panel-title">
  <div class="panel-heading">
    <div><p class="eyebrow">YOUR PEOPLE</p><h2 id="buddies-panel-title">Pinned buddies</h2></div>
    <span class="buddy-count">{buddies.filter(buddy => buddy.pinned).length} pinned</span>
  </div>
  <p class="panel-description">Posts your pinned buddies upvote appear in this feed. Visit someone’s profile to follow them, then pin them here.</p>
  {#if loading}
    <p class="muted" role="status">Loading your buddies…</p>
  {:else if error}
    <p class="error" role="alert">{error}</p><button type="button" onclick={refresh}>Retry</button>
  {:else if buddies.length === 0}
    <p class="empty-buddies">You haven’t followed anyone yet. Open a member profile and choose <strong>Follow buddy</strong> to add them.</p>
  {:else}
    <ul>
      {#each buddies as buddy (buddy.handle)}
        <li>
          <a class="buddy-profile" href={'/u/' + buddy.handle}>
            {#if buddy.avatar_url}<img src={buddy.avatar_url} alt="" />{:else}<AuthorAvatar handle={buddy.handle} size="small" />{/if}
            <span><strong>{buddy.display_name || 'u/' + buddy.handle}</strong><small>@{buddy.handle}</small></span>
          </a>
          <div class="buddy-actions">
            <button class:pinned={buddy.pinned} type="button" disabled={busyHandle === buddy.handle} onclick={() => updateBuddy(buddy, 'pin')}>
              {busyHandle === buddy.handle ? 'Saving…' : buddy.pinned ? 'Unpin' : 'Pin to feed'}
            </button>
            <button class="unfollow" type="button" disabled={busyHandle === buddy.handle} onclick={() => updateBuddy(buddy, 'unfollow')}>Unfollow</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .buddies-panel{margin:18px 0 26px;padding:18px 20px;border:1px solid var(--border,#dedfd7);border-radius:12px;background:var(--surface,#fff)}
  .panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.panel-heading .eyebrow{margin:0 0 4px}.panel-heading h2{margin:0;font:500 1.35rem/1.15 Georgia,serif;color:var(--heading,#173d34)}
  .buddy-count{padding:5px 9px;border-radius:999px;background:var(--subtle,#e4e9df);color:var(--muted,#66766c);font-size:.74rem;font-weight:700;white-space:nowrap}
  .panel-description{margin:10px 0 14px;color:var(--muted,#66766c);font-size:.84rem;line-height:1.45}
  ul{display:grid;gap:8px;margin:0;padding:0;list-style:none}li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--border,#dedfd7)}
  .buddy-profile{display:flex;align-items:center;gap:10px;min-width:0;color:var(--heading,#173d34);text-decoration:none}.buddy-profile>img{width:34px;height:34px;border-radius:50%;object-fit:cover}.buddy-profile>span{display:grid;min-width:0}.buddy-profile strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.84rem}.buddy-profile small{color:var(--muted,#77827d);font-size:.73rem}
  .buddy-actions{display:flex;align-items:center;gap:6px;flex:none}.buddy-actions button{padding:6px 9px;border:1px solid var(--border,#c7ccc3);border-radius:7px;background:transparent;color:var(--heading,#173d34);font:600 .72rem/1.1 inherit;cursor:pointer}.buddy-actions button.pinned{border-color:var(--accent,#9b5e38);background:var(--wash,#f0ece4);color:var(--accent,#9b5e38)}.buddy-actions button.unfollow{color:var(--muted,#66766c)}.buddy-actions button:disabled{opacity:.6;cursor:wait}
  .empty-buddies,.muted,.error{margin:0;color:var(--muted,#66766c);font-size:.84rem;line-height:1.45}.error{color:var(--error,#973c35)}
  @media(max-width:520px){.buddies-panel{padding:15px}li{align-items:flex-start;flex-direction:column}.buddy-actions{padding-left:44px}}
</style>
