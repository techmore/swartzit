<script>
  import { onMount } from 'svelte';
  export let compact = false;
  let enabled = false;
  const key = 'swartzit_autoplay';
  function read() {
    try { enabled = localStorage.getItem(key) === 'on'; } catch { enabled = false; }
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
<button class:compact class="autoplay-toggle" type="button" aria-label="Autoplay videos" aria-pressed={enabled} title={enabled ? 'Turn off video autoplay' : 'Turn on muted video autoplay'} on:click={toggle}>
  <span aria-hidden="true">{enabled ? '▶' : 'Ⅱ'}</span><span class="toggle-label">Autoplay {enabled ? 'on' : 'off'}</span>
</button>
<style>
  .autoplay-toggle{position:fixed;right:16px;bottom:70px;z-index:100;padding:9px 13px;min-height:40px;border-radius:999px;border:1px solid var(--border,#c7ccc3);background:var(--surface,#fff);color:var(--heading,#173d34);box-shadow:0 3px 16px #0002;font:inherit;font-size:.8rem;cursor:pointer;display:flex;gap:7px;align-items:center}
  .autoplay-toggle.compact{position:static;z-index:auto;width:34px;height:34px;min-height:34px;padding:0;border-radius:9px;box-shadow:none;justify-content:center;font-size:.75rem}
  .autoplay-toggle.compact:hover,.autoplay-toggle.compact:focus-visible{background:var(--subtle,#e4e9df)}
  .autoplay-toggle.compact .toggle-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:520px){.autoplay-toggle{right:10px;bottom:62px;width:40px;height:40px;min-height:40px;padding:0;justify-content:center;font-size:.8rem}.autoplay-toggle .toggle-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}}
</style>
