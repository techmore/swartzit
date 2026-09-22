<script>
  import { onMount } from 'svelte';
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
<button class="theme-toggle" type="button" aria-label="Dark mode" aria-pressed={dark} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} on:click={toggle}>
  <span aria-hidden="true">{dark ? '☀' : '☾'}</span> {dark ? 'Light mode' : 'Dark mode'}
</button>
<style>
  .theme-toggle{position:fixed;right:16px;bottom:16px;z-index:100;padding:10px 14px;min-height:44px;border-radius:999px;border:1px solid var(--border,#c7ccc3);background:var(--surface,#fff);color:var(--heading,#173d34);box-shadow:0 3px 16px #0002;font:inherit;font-size:.85rem;cursor:pointer;display:flex;gap:8px;align-items:center}
</style>
