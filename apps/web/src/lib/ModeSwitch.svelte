<script>
  import { page } from '$app/state';
  import Icon from '#lib/Icon.svelte';
  /** `pill` is the header's two-way switch; `row` is a full-width menu row. */
  let { variant = 'pill' } = $props();
  const bible = $derived(page.data?.bible);
  const next = $derived(page.url.pathname + page.url.search);

  // Save the choice, then reload so the server renders the page in the new mode.
  async function choose(event) {
    const form = event.currentTarget;
    const mode = event.submitter?.value;
    if (!mode) return;
    event.preventDefault();
    if (mode === bible.mode) return;
    try {
      const response = await fetch('/mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
      if (!response.ok) throw new Error(String(response.status));
      location.reload();
    } catch {
      // Fall back to the plain form post.
      const field = Object.assign(document.createElement('input'), { type: 'hidden', name: 'mode', value: mode });
      form.append(field);
      form.submit();
    }
  }
</script>

{#if bible?.available}
  <!-- A full-page form post so the server renders the next page in the new mode. -->
  {#if variant === 'row'}
    <form method="POST" action="/mode" data-sveltekit-reload onsubmit={choose}>
      <input type="hidden" name="next" value={next} />
      <button type="submit" class="menu-item" name="mode" value={bible.enabled ? 'standard' : 'bible'} role="menuitem">
        <Icon name={bible.enabled ? 'home' : 'book'} size={18} />{bible.enabled ? 'Switch to Standard mode' : 'Switch to Bible mode'}
      </button>
    </form>
  {:else}
    <form class="mode-switch" method="POST" action="/mode" data-sveltekit-reload aria-label="Mode" onsubmit={choose}>
      <input type="hidden" name="next" value={next} />
      <button type="submit" name="mode" value="standard" aria-pressed={!bible.enabled} title="Everything on Swartzit">Standard</button>
      <button type="submit" name="mode" value="bible" aria-pressed={bible.enabled} title="Scripture, sermons and study"><Icon name="book" size={15} />Bible</button>
    </form>
  {/if}
{/if}

<style>
  .mode-switch { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; background: var(--surface2); border: 1px solid var(--border); }
  .mode-switch button { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 0 12px; border-radius: 999px; background: transparent; color: var(--muted); font-size: .8rem; font-weight: 650; }
  .mode-switch button:hover { color: var(--heading); }
  .mode-switch button[aria-pressed='true'] { background: var(--surface); color: var(--heading); box-shadow: 0 1px 2px rgb(0 0 0 / .12); }
  form:not(.mode-switch) { display: contents; }
</style>
