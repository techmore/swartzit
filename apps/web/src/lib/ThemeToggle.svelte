<script>
  import { onMount } from 'svelte';
  export let compact = false;
  let dark = false;
  const key = 'swartzit_theme';
  function apply(value) {
    dark = value;
    document.documentElement.dataset.theme = value ? 'dark' : 'light';
  }
  function toggle() {
    apply(!dark);
    try { localStorage.setItem(key, dark ? 'dark' : 'light'); } catch { /* Still works for this page when storage is unavailable. */ }
  }
  onMount(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      let stored;
      try { stored = localStorage.getItem(key); } catch { /* Use the system preference. */ }
      apply(stored === 'dark' || (stored !== 'light' && system.matches));
    };
    const storage = event => { if (event.key === key || event.key === null) sync(); };
    sync();
    system.addEventListener('change', sync);
    window.addEventListener('storage', storage);
    return () => { system.removeEventListener('change', sync); window.removeEventListener('storage', storage); };
  });
</script>
<button class:compact class="theme-toggle" type="button" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={dark} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} on:click={toggle}>
  <span aria-hidden="true">{dark ? '☀' : '☾'}</span><span class="toggle-label">{dark ? 'Light mode' : 'Dark mode'}</span>
</button>
<style>
  .theme-toggle{position:fixed;right:16px;bottom:16px;z-index:100;padding:10px 14px;min-height:44px;border-radius:999px;border:1px solid var(--border,#c7ccc3);background:var(--surface,#fff);color:var(--heading,#173d34);box-shadow:0 3px 16px #0002;font:inherit;font-size:.85rem;cursor:pointer;display:flex;gap:8px;align-items:center}
  .theme-toggle.compact{position:static;z-index:auto;width:34px;height:34px;min-height:34px;padding:0;border-radius:9px;box-shadow:none;justify-content:center;font-size:.95rem}
  .theme-toggle.compact:hover,.theme-toggle.compact:focus-visible{background:var(--subtle,#e4e9df)}
  .theme-toggle.compact .toggle-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:520px){.theme-toggle{right:10px;bottom:10px;width:40px;height:40px;min-height:40px;padding:0;justify-content:center;font-size:.9rem}.theme-toggle .toggle-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}}
</style>
