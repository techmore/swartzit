<script>
  import { onMount } from 'svelte';
  /** Admin panel: which communities the Swartzit iPhone app receives. */
  let { busy = false } = $props();
  let communities = $state([]);
  let saving = $state('');
  let message = $state('');

  async function load() {
    try {
      const response = await fetch('/api/communities');
      if (response.ok) communities = (await response.json()).sort((a, b) => Number(b.app_visible) - Number(a.app_visible) || b.post_count - a.post_count);
    } catch { message = 'Communities could not be loaded.'; }
  }
  async function toggle(community, visible) {
    saving = community.slug; message = '';
    try {
      const token = localStorage.getItem('swartzit_session');
      const response = await fetch(`/api/admin/communities/${encodeURIComponent(community.slug)}/app`, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ visible })
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Request failed');
      community.app_visible = visible;
      message = visible ? `c/${community.slug} now appears in the app.` : `c/${community.slug} is hidden from the app.`;
    } catch (error) { message = error.message; } finally { saving = ''; }
  }
  onMount(load);
  const shown = $derived(communities.filter(c => c.app_visible).length);
</script>

<section class="panel">
  <h3>iPhone app</h3>
  <p class="muted">The Swartzit app receives only the communities ticked here, and never R- or X-rated posts. App stores reject apps that can show sexual content, so leave image-heavy or mature communities unticked. The website is not affected. {shown} of {communities.length} communities are in the app.</p>
  {#if message}<p class="notice" role="status">{message}</p>{/if}
  <ul class="app-communities">
    {#each communities as community (community.slug)}
      <li><label><input type="checkbox" checked={community.app_visible} disabled={busy || saving === community.slug} onchange={(event) => toggle(community, event.currentTarget.checked)} /> c/{community.slug} <small>{community.post_count} posts</small></label></li>
    {/each}
  </ul>
</section>

<style>
  .app-communities { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px 16px; max-height: 360px; overflow: auto; }
  .app-communities label { display: flex; align-items: center; gap: 8px; min-height: 36px; }
  .app-communities small { color: var(--muted); margin-left: auto; }
</style>
