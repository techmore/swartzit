<script>
  import { onMount } from 'svelte';
  /**
   * Admin panel: tick which communities a surface shows.
   * kind 'app' = the Swartzit iPhone app; kind 'bible' = Bible mode on the website.
   */
  let { busy = false, kind = 'app' } = $props();
  const SURFACES = {
    app: {
      field: 'app_visible',
      title: 'iPhone app',
      intro: 'The Swartzit app receives only the communities ticked here, and never R- or X-rated posts. App stores reject apps that can show sexual content, so leave image-heavy or mature communities unticked. The website is not affected.',
      on: 'now appears in the app.',
      off: 'is hidden from the app.',
      where: 'in the app'
    },
    bible: {
      field: 'bible_visible',
      title: 'Bible mode',
      intro: 'Visitors in Bible mode see only the communities ticked here, on the home timeline and in the side list. Everything else stays one tap away, and Standard mode always shows every community.',
      on: 'now appears in Bible mode.',
      off: 'is hidden from Bible mode.',
      where: 'in Bible mode'
    }
  };
  const surface = $derived(SURFACES[kind] ?? SURFACES.app);
  let communities = $state([]);
  let saving = $state('');
  let message = $state('');

  async function load() {
    try {
      const response = await fetch('/api/communities');
      if (response.ok) {
        const field = surface.field;
        communities = (await response.json()).sort((a, b) => Number(b[field]) - Number(a[field]) || b.post_count - a.post_count);
      }
    } catch { message = 'Communities could not be loaded.'; }
  }
  async function toggle(community, visible) {
    saving = community.slug; message = '';
    try {
      const token = localStorage.getItem('swartzit_session');
      const response = await fetch(`/api/admin/communities/${encodeURIComponent(community.slug)}/${kind}`, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ visible })
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Request failed');
      community[surface.field] = visible;
      message = `c/${community.slug} ${visible ? surface.on : surface.off}`;
    } catch (error) { message = error.message; } finally { saving = ''; }
  }
  onMount(load);
  const shown = $derived(communities.filter(c => c[surface.field]).length);
</script>

<section class="panel">
  <h3>{surface.title}</h3>
  <p class="muted">{surface.intro} {shown} of {communities.length} communities are {surface.where}.</p>
  {#if message}<p class="notice" role="status">{message}</p>{/if}
  <ul class="visibility-communities">
    {#each communities as community (community.slug)}
      <li><label><input type="checkbox" checked={community[surface.field]} disabled={busy || saving === community.slug} onchange={(event) => toggle(community, event.currentTarget.checked)} /> c/{community.slug} <small>{community.post_count} posts</small></label></li>
    {/each}
  </ul>
</section>

<style>
  .visibility-communities { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px 16px; max-height: 360px; overflow: auto; }
  .visibility-communities label { display: flex; align-items: center; gap: 8px; min-height: 36px; }
  .visibility-communities small { color: var(--muted); margin-left: auto; }
</style>
