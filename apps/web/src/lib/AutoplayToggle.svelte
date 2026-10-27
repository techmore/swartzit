<script>
  import { onMount } from 'svelte';
  import Icon from '#lib/Icon.svelte';
  import { AUTOPLAY_KEY, autoplayEnabled } from '#lib/autoplay-video.mjs';
  let enabled = true;
  const key = AUTOPLAY_KEY;
  function read() {
    try { enabled = autoplayEnabled(localStorage); } catch { enabled = true; }
  }
  function toggle() {
    enabled = !enabled;
    try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch { /* Keep the in-memory preference. */ }
    window.dispatchEvent(new CustomEvent('swartzit-autoplay-change', { detail: { enabled } }));
  }
  onMount(() => {
    read();
    const storage = event => { if (event.key === key || event.key === null) read(); };
    const change = event => { enabled = event.detail?.enabled === true; };
    window.addEventListener('storage', storage);
    window.addEventListener('swartzit-autoplay-change', change);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener('swartzit-autoplay-change', change); };
  });
</script>
<button type="button" class="menu-item" role="menuitemcheckbox" aria-checked={enabled} title="Play videos muted as they scroll into view" on:click={toggle}>
  <Icon name={enabled ? 'pause' : 'play'} size={18} />
  <span>Video autoplay</span>
  <span class="state" class:on={enabled}>{enabled ? 'On' : 'Off'}</span>
</button>
<style>
  .state{margin-left:auto;font-size:.75rem;font-weight:700;color:var(--muted);padding:2px 8px;border-radius:999px;background:var(--subtle)}
  .state.on{background:var(--accent-soft);color:var(--accent)}
</style>
