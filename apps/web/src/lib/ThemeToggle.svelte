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
    // Tint the phone's status bar and browser chrome to match the page.
    const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
    if (page) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', page);
  }
  function toggle() {
    apply(!dark);
    try { localStorage.setItem(key, dark ? 'dark' : 'light'); } catch { /* Still works for this page when storage is unavailable. */ }
    // The header button and the menu row are separate instances.
    window.dispatchEvent(new CustomEvent('swartzit-theme-change', { detail: { dark } }));
  }
  onMount(() => {
    const sync = () => {
      let stored;
      try { stored = localStorage.getItem(key); } catch { /* Keep the light default. */ }
      apply(stored === 'dark');
    };
    const storage = event => { if (event.key === key || event.key === null) sync(); };
    const change = event => { dark = event.detail?.dark === true; };
    sync();
    window.addEventListener('storage', storage);
    window.addEventListener('swartzit-theme-change', change);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener('swartzit-theme-change', change); };
  });
  $: label = dark ? 'Switch to light mode' : 'Switch to dark mode';
</script>
{#if variant === 'row'}
  <button type="button" class="menu-item" role="menuitemcheckbox" aria-checked={dark} on:click={toggle}><Icon name={dark ? 'sun' : 'moon'} size={18} />{dark ? 'Light mode' : 'Dark mode'}</button>
{:else}
  <button type="button" class="icon-btn" aria-label={label} title={label} aria-pressed={dark} on:click={toggle}><Icon name={dark ? 'sun' : 'moon'} size={19} /></button>
{/if}
