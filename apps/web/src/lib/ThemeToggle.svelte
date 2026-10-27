<script>
  import { onMount } from 'svelte';
  import Icon from '#lib/Icon.svelte';
  /** `icon` is a compact header button; `row` is a full-width menu row. */
  export let variant = 'icon';
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
    const sync = () => {
      let stored;
      try { stored = localStorage.getItem(key); } catch { /* Keep the light default. */ }
      apply(stored === 'dark');
    };
    const storage = event => { if (event.key === key || event.key === null) sync(); };
    sync();
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('storage', storage); };
  });
  $: label = dark ? 'Switch to light mode' : 'Switch to dark mode';
</script>
{#if variant === 'row'}
  <button type="button" class="menu-item" aria-pressed={dark} on:click={toggle}><Icon name={dark ? 'sun' : 'moon'} size={18} />{dark ? 'Light mode' : 'Dark mode'}</button>
{:else}
  <button type="button" class="icon-btn" aria-label={label} title={label} aria-pressed={dark} on:click={toggle}><Icon name={dark ? 'sun' : 'moon'} size={19} /></button>
{/if}
