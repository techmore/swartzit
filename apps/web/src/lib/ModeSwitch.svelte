<script>
  import { page } from '$app/state';
  import Icon from '#lib/Icon.svelte';
  /** `pill` is the header's two-way switch; `row` is the same switch as a labelled menu row. */
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
    <!-- Both choices stay visible, so the row shows the current mode as well as the way out of it. -->
    <form class="mode-row" method="POST" action="/mode" data-sveltekit-reload onsubmit={choose}>
      <input type="hidden" name="next" value={next} />
      <span class="mode-label" id="mode-row-label">Mode</span>
      <span class="mode-switch" role="group" aria-labelledby="mode-row-label">
        <button type="submit" name="mode" value="standard" role="menuitemradio" aria-checked={!bible.enabled} title="Everything on Swartzit">Standard</button>
        <button type="submit" name="mode" value="bible" role="menuitemradio" aria-checked={bible.enabled} title="Scripture, sermons and study"><Icon name="book" size={15} />Bible</button>
      </span>
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
  .mode-switch button[aria-pressed='true'], .mode-switch button[aria-checked='true'] { background: var(--surface); color: var(--heading); box-shadow: 0 1px 2px rgb(0 0 0 / .12); }
  .mode-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 6px 4px 12px; }
  .mode-label { color: var(--muted); font: 600 .8rem/1 var(--font-sans); }
  .mode-row .mode-switch button { min-height: 36px; padding: 0 14px; font-size: .85rem; }
  @media (pointer: coarse) { .mode-row .mode-switch button { min-height: 40px; } }
</style>
