<script>
  export let name = 'circle';
  export let size = 20;
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'search'}
    <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.25 4.25" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'x'}
    <path d="m6 6 12 12M18 6 6 18" />
  {:else if name === 'grid'}
    <rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" />
  {:else if name === 'clock'}
    <circle cx="12" cy="12" r="8" /><path d="M12 7v5l3.25 2" />
  {:else if name === 'bookmark'}
    <path d="M6.5 4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21l-5.5-3-5.5 3Z" />
  {:else if name === 'user'}
    <circle cx="12" cy="8" r="3" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  {:else if name === 'admin'}
    <path d="m12 3 7 3v5c0 4.4-2.9 8.1-7 9.5C7.9 19.1 5 15.4 5 11V6Z" /><path d="m9 12 2 2 4-4" />
  {:else if name === 'download'}
    <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 20h14" />
  {:else if name === 'sliders'}
    <path d="M4 7h16M4 17h16M8 4v6M16 14v6" />
  {:else if name === 'info'}
    <circle cx="12" cy="12" r="8" /><path d="M12 10.5v5M12 7.5h.01" />
  {:else if name === 'login'}
    <path d="M13 5h6v14h-6M11 12h9M11 12l3-3M11 12l3 3M5 5h3M5 19h3" />
  {:else}
    <circle cx="12" cy="12" r="8" />
  {/if}
</svg>
