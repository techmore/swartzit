<script>
  import { onMount } from 'svelte';

  let token = '', visibility = 'followers', nonRatedOnly = true;
  let followers = [], loading = true, loaded = false, saving = false, busyHandle = '', error = '', message = '';
  let savedVisibility = 'followers', savedNonRatedOnly = true;

  async function load() {
    loading = true;
    error = '';
    token = localStorage.getItem('swartzit_session') ?? '';
    if (!token) {
      loading = false;
      error = 'Sign in to change your like-sharing settings.';
      return;
    }
    try {
      const response = await fetch('/api/me/like-sharing', {
        headers: { authorization: 'Bearer ' + token }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load your settings.');
      visibility = result.visibility || 'followers';
      nonRatedOnly = Boolean(result.non_rated_only);
      savedVisibility = visibility;
      savedNonRatedOnly = nonRatedOnly;
      followers = Array.isArray(result.followers) ? result.followers : [];
      loaded = true;
    } catch (cause) {
      error = cause.message || 'Could not reach Swartzit.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function saveSettings() {
    saving = true;
    error = '';
    message = '';
    try {
      const response = await fetch('/api/me/like-sharing', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ visibility, non_rated_only: nonRatedOnly })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save your settings.');
      visibility = result.visibility;
      nonRatedOnly = Boolean(result.non_rated_only);
      savedVisibility = visibility;
      savedNonRatedOnly = nonRatedOnly;
      message = 'Like-sharing settings saved.';
    } catch (cause) {
      visibility = savedVisibility;
      nonRatedOnly = savedNonRatedOnly;
      error = cause.message || 'Could not reach Swartzit.';
    } finally {
      saving = false;
    }
  }

  async function toggleFollower(follower, selected) {
    const previousSelected = follower.selected;
    followers = followers.map(item => item.handle === follower.handle ? { ...item, selected } : item);
    busyHandle = follower.handle;
    error = '';
    message = '';
    try {
      const response = await fetch(`/api/me/like-sharing/audience/${encodeURIComponent(follower.handle)}`, {
        method: selected ? 'POST' : 'DELETE',
        headers: { authorization: 'Bearer ' + token }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update your selected audience.');
      followers = followers.map(item => item.handle === follower.handle
        ? { ...item, selected: result.selected }
        : item);
      message = result.selected ? `u/${follower.handle} can see your likes.` : `u/${follower.handle} was removed from your selected audience.`;
    } catch (cause) {
      followers = followers.map(item => item.handle === follower.handle ? { ...item, selected: previousSelected } : item);
      error = cause.message || 'Could not reach Swartzit.';
    } finally {
      busyHandle = '';
    }
  }
</script>

<section class="like-sharing panel" aria-labelledby="like-sharing-title">
  <h2 id="like-sharing-title">Like sharing</h2>
  <p class="intro">These settings control whether your upvotes appear in other people’s Buddies feeds. Someone must follow and pin you to see your likes.</p>

  {#if loading}
    <p class="muted" role="status">Loading sharing settings…</p>
  {:else if !loaded}
    <p class="error" role="alert">{error || 'Could not load your settings.'}</p>
    <button type="button" onclick={load}>Retry</button>
  {:else}
    <label class="setting-label" for="like-visibility">Share my likes with</label>
    <select id="like-visibility" bind:value={visibility} disabled={saving || busyHandle !== ''} onchange={saveSettings}>
      <option value="followers">Everyone who follows and pins me</option>
      <option value="selected">Only selected followers</option>
      <option value="hidden">No one — hide my likes</option>
    </select>

    <label class="rated-setting">
      <input type="checkbox" checked={nonRatedOnly} disabled={saving || busyHandle !== ''} onchange={(event) => { nonRatedOnly = event.currentTarget.checked; saveSettings(); }} />
      <span>Only share likes on General-rated posts</span>
    </label>
    <p class="hint">When enabled, likes on R-rated and X-rated posts stay out of everyone’s Buddies feed, even if you selected that person.</p>

    {#if visibility === 'selected'}
      <div class="audience">
        <h3>Selected followers</h3>
        {#if followers.length === 0}
          <p class="muted">No one follows you yet. Followers will appear here so you can choose who sees your likes.</p>
        {:else}
          <ul>
            {#each followers as follower (follower.handle)}
              <li>
                <label>
                  <input type="checkbox" checked={follower.selected} disabled={saving || busyHandle !== ''} onchange={(event) => toggleFollower(follower, event.currentTarget.checked)} />
                  <span><strong>{follower.display_name || 'u/' + follower.handle}</strong><small>@{follower.handle}</small></span>
                </label>
                {#if busyHandle === follower.handle}<span class="muted">Saving…</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  {/if}

  {#if message}<p class="message" role="status">{message}</p>{/if}
  {#if error && loaded}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .like-sharing{margin-top:18px;padding:22px 24px}
  h2{margin:0;color:var(--heading,#173d34);font:500 1.45rem/1.15 Georgia,serif}
  .intro,.hint,.muted,.message,.error{font-size:.82rem;line-height:1.45}
  .intro{margin:9px 0 18px;color:var(--muted,#66766c)}
  .setting-label{display:block;margin-bottom:6px;color:var(--heading,#173d34);font-size:.8rem;font-weight:700}
  .like-sharing>button{margin-top:5px;padding:7px 11px;border:1px solid var(--border,#c7ccc3);border-radius:7px;background:var(--surface,#fff);color:var(--heading,#173d34);font-size:.78rem;cursor:pointer}
  select{width:100%;max-width:460px;height:40px;padding:0 10px;border:1px solid var(--border,#c7ccc3);border-radius:8px;background:var(--surface,#fff);color:var(--heading,#173d34);font:inherit;font-size:.84rem}
  .rated-setting{display:flex;align-items:center;gap:9px;margin-top:15px;color:var(--heading,#173d34);font-size:.82rem;font-weight:650}
  .rated-setting input,.audience input{accent-color:var(--accent,#9b5e38)}
  .hint{margin:6px 0 0 25px;color:var(--muted,#77827d)}
  .audience{margin-top:18px;padding-top:15px;border-top:1px solid var(--border,#dedfd7)}
  .audience h3{margin:0 0 10px;color:var(--heading,#173d34);font-size:.86rem}
  .audience ul{display:grid;gap:3px;max-height:260px;overflow:auto;margin:0;padding:0;list-style:none}
  .audience li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,#e8e8e1)}
  .audience li label{display:flex;align-items:center;gap:9px;min-width:0;cursor:pointer}
  .audience li label span{display:grid;min-width:0}.audience strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem}.audience small{color:var(--muted,#77827d);font-size:.7rem}
  .muted{margin:8px 0;color:var(--muted,#77827d)}.message{margin:12px 0 0;color:var(--accent,#575d3d)}.error{margin:12px 0 0;color:var(--error,#973c35)}
  @media(max-width:600px){.like-sharing{padding:18px}.hint{margin-left:0}}
</style>
