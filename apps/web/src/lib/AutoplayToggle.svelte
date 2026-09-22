<script>
  import { onMount } from 'svelte';
  let enabled = true;
  const key = 'swartzit_autoplay';
  function read() {
    try { enabled = localStorage.getItem(key) !== 'off'; } catch { enabled = true; }
  }
  function toggle() {
    enabled = !enabled;
    try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch { /* Keep the in-memory preference. */ }
    window.dispatchEvent(new CustomEvent('swartzit-autoplay-change', { detail: { enabled } }));
  }
  onMount(() => {
    read();
    const storage = event => { if (event.key === key || event.key === null) read(); };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  });
</script>
<button class="autoplay-toggle" type="button" aria-label="Autoplay videos" aria-pressed={enabled} title={enabled ? 'Turn off video autoplay' : 'Turn on muted video autoplay'} on:click={toggle}>
  <span aria-hidden="true">{enabled ? '▶' : 'Ⅱ'}</span> Autoplay {enabled ? 'on' : 'off'}
</button>
<style>
  .autoplay-toggle{position:fixed;right:16px;bottom:70px;z-index:100;padding:9px 13px;min-height:40px;border-radius:999px;border:1px solid var(--border,#c7ccc3);background:var(--surface,#fff);color:var(--heading,#173d34);box-shadow:0 3px 16px #0002;font:inherit;font-size:.8rem;cursor:pointer;display:flex;gap:7px;align-items:center}
  @media(max-width:520px){.autoplay-toggle{right:10px;bottom:62px;font-size:.76rem;padding:8px 11px}}
</style>
