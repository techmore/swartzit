<script>
  const version = __SWARTZIT_VERSION__;
  const displayVersion = version.split('-')[0];
</script>

<a class="brand" href="/" aria-label={`Swartzit home, version ${version}`} title={`Swartzit version ${version}`}>
  <img src="/swartzit-icon.png" alt="" width="28" height="28" />
  <span class="brand-name">swartzit</span>
  <span class="brand-version">v{displayVersion}</span>
</a>

<style>
  .brand { display: inline-flex; align-items: center; gap: 9px; flex: none; color: var(--heading); }
  .brand img { width: 28px; height: 28px; object-fit: contain; }
  .brand-name { font: 700 1.3rem/1 var(--font-serif); letter-spacing: -.03em; }
  .brand-version { align-self: flex-end; margin: 0 0 3px -4px; font: 600 .6rem/1 var(--font-mono); color: var(--text-light); }
  @media (max-width: 900px) { .brand-version { display: none; } }
</style>
