<script>
  import { page } from '$app/state';
  import BurningBush from '#lib/BurningBush.svelte';
  const version = __SWARTZIT_VERSION__;
  const displayVersion = version.split('-')[0];
  const reformed = $derived(page.data?.bible?.enabled === true);
</script>

<a class="brand" class:reformed href="/" aria-label={`Swartzit home, version ${version}`} title={`Swartzit version ${version}`}>
  {#if reformed}<BurningBush size={30} />{:else}<img src="/swartzit-icon.png" alt="" width="28" height="28" />{/if}
  <span class="brand-name">swartzit</span>
  {#if reformed}<span class="brand-motto">Soli Deo Gloria</span>{:else}<span class="brand-version">v{displayVersion}</span>{/if}
</a>

<style>
  .brand { position: relative; display: inline-flex; align-items: center; gap: 9px; flex: none; color: var(--heading); }
  /* The mark is 30px tall; extend the tap area to 44px without moving it. */
  .brand::after { content: ""; position: absolute; inset: -8px 0; }
  .brand img { width: 28px; height: 28px; object-fit: contain; }
  .brand-name { font: 700 1.3rem/1 var(--font-serif); letter-spacing: -.03em; }
  .brand-version { align-self: flex-end; margin: 0 0 3px -4px; font: 600 .6rem/1 var(--font-mono); color: var(--text-light); }
  .brand-motto { align-self: flex-end; margin: 0 0 3px -3px; font: italic 500 .7rem/1 var(--font-serif); letter-spacing: .02em; color: var(--gilt-text, var(--text-light)); }
  @media (max-width: 900px) { .brand-version, .brand-motto { display: none; } }
</style>
