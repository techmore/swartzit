<script>
  // A thin bar across the top while the next page loads. Chapters and feeds
  // are fetched on the server, so without it a tap can look ignored on a slow
  // connection. It only appears once a navigation has taken a moment.
  import { navigating } from '$app/state';
</script>

{#if navigating.to}<div class="nav-progress" role="progressbar" aria-label="Loading page"><i></i></div>{/if}

<style>
  .nav-progress { position: fixed; z-index: 200; inset: 0 0 auto 0; height: 3px; pointer-events: none; }
  i { display: block; width: 0; height: 100%; background: var(--gilt, var(--accent)); animation: advance 8s cubic-bezier(.1, .7, .2, 1) .15s forwards; }
  @keyframes advance { to { width: 92%; } }
</style>
