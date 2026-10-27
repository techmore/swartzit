<script>
  export let name = 'circle';
  export let size = 20;
  export let filled = false;
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
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
    <circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  {:else if name === 'users'}
    <circle cx="9" cy="8.5" r="3" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M16 5.7a3 3 0 0 1 0 5.6M17.5 14.2a5.5 5.5 0 0 1 3 5.3" />
  {:else if name === 'admin'}
    <path d="m12 3 7 3v5c0 4.4-2.9 8.1-7 9.5C7.9 19.1 5 15.4 5 11V6Z" /><path d="m9 12 2 2 4-4" />
  {:else if name === 'download'}
    <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 20h14" />
  {:else if name === 'sliders'}
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" />
  {:else if name === 'menu'}
    <path d="M4 7h16M4 12h16M4 17h16" />
  {:else if name === 'info'}
    <circle cx="12" cy="12" r="8" /><path d="M12 10.5v5M12 7.5h.01" />
  {:else if name === 'login'}
    <path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M4 12h11M11 8l4 4-4 4" />
  {:else if name === 'logout'}
    <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M20 12H9m7-4 4 4-4 4" />
  {:else if name === 'home'}
    <path d="M4 11l8-6.5 8 6.5M6 10v9h4v-5h4v5h4v-9" />
  {:else if name === 'comment'}
    <path d="M20 12a7.5 7.5 0 0 1-10.9 6.7L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12Z" />
  {:else if name === 'share'}
    <path d="M12 15V4m0 0L8 8m4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  {:else if name === 'link'}
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  {:else if name === 'moon'}
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
  {:else if name === 'sun'}
    <circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
  {:else if name === 'play'}
    <path d="M8 5.5v13l11-6.5Z" />
  {:else if name === 'pause'}
    <path d="M8 5v14M16 5v14" />
  {:else if name === 'chevron-down'}
    <path d="m6 9 6 6 6-6" />
  {:else if name === 'arrow-left'}
    <path d="M19 12H5m6-6-6 6 6 6" />
  {:else if name === 'external'}
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  {:else if name === 'check'}
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  {:else if name === 'pen'}
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z" />
  {:else}
    <circle cx="12" cy="12" r="8" />
  {/if}
</svg>
