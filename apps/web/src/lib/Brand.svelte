<script>
  const version = __SWARTZIT_VERSION__;
</script>

<div class="brand-lockup">
  <a class="brand" href="/" aria-label={`Swartzit version ${version}`} title={`Swartzit version ${version}`}>
    <span class="brand-name">swartzit</span>
    <span class="brand-version">v{version}</span>
  </a>
  <a
    class="github-link"
    href="https://github.com/techmore/swartzit"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Swartzit on GitHub"
    title="Swartzit on GitHub"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 .9C5.86.9.88 5.88.88 12.02c0 4.9 3.18 9.05 7.6 10.52.56.1.76-.24.76-.54v-2.08c-3.09.67-3.74-1.31-3.74-1.31-.5-1.28-1.23-1.62-1.23-1.62-1-.69.08-.68.08-.68 1.1.08 1.68 1.13 1.68 1.13.98 1.68 2.57 1.2 3.2.92.1-.72.38-1.2.7-1.47-2.47-.28-5.07-1.23-5.07-5.48 0-1.21.43-2.2 1.13-2.97-.11-.28-.49-1.41.11-2.93 0 0 .92-.3 3.02 1.13a10.5 10.5 0 0 1 5.5 0c2.1-1.43 3.02-1.13 3.02-1.13.6 1.52.22 2.65.11 2.93.7.77 1.13 1.76 1.13 2.97 0 4.26-2.6 5.2-5.08 5.48.4.34.76 1.02.76 2.06v3.07c0 .3.2.65.77.54a11.14 11.14 0 0 0 7.58-10.52C23.12 5.88 18.14.9 12 .9Z" />
    </svg>
  </a>
</div>

<style>
  .brand-lockup {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    flex: none;
  }

  .github-link {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--muted);
  }

  .github-link:hover {
    color: var(--heading);
    background: var(--hover);
  }

  .github-link:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .github-link svg {
    width: 20px;
    height: 20px;
  }
</style>
