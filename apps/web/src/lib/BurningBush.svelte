<script>
  // "Nec tamen consumebatur" — the bush that burned and was not consumed
  // (Exodus 3:2), the historic emblem of Presbyterian churches.
  let { size = 28 } = $props();
</script>

<svg class="burning-bush" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <path class="flame-outer" d="M16 2.5c1.2 3.6 5.6 6.1 5.6 11.2 0 3.4-2.4 6-5.6 6s-5.6-2.6-5.6-6c0-2.6 1.4-4.2 2.6-5.6.3 1.7 1.1 2.7 2.1 3.2-.4-3.2-.1-6 .9-8.8z" />
  <path class="flame-inner" d="M16 9.6c.8 2 2.7 3.3 2.7 5.6 0 1.7-1.2 2.9-2.7 2.9s-2.7-1.2-2.7-2.9c0-1.6 1-2.6 1.8-3.4.1.8.4 1.3.9 1.6-.2-1.3-.2-2.5 0-3.8z" />
  <path class="bush" d="M16 29.5v-8.6M16 23.8c-2.4-.4-4.9-1.6-6.6-4.1M16 23.8c2.4-.4 4.9-1.6 6.6-4.1M16 26.6c-3.4-.3-7.1-1.6-9.6-4.8M16 26.6c3.4-.3 7.1-1.6 9.6-4.8" />
</svg>

<style>
  .burning-bush { flex: none; display: block; }
  .flame-outer { fill: var(--crimson, #8c2332); }
  .flame-inner { fill: var(--gilt, #a8812f); }
  .bush { fill: none; stroke: var(--heading, #13213a); stroke-width: 1.8; stroke-linecap: round; }
</style>
