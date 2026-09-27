<script>
  import { createEventDispatcher } from 'svelte';

  export let enabled = false;
  export let compact = false;
  const dispatch = createEventDispatcher();

  function toggle() {
    dispatch('change', { enabled: !enabled });
  }
</script>

<button
  class="video-loop-toggle"
  class:compact
  class:enabled
  type="button"
  aria-label={enabled ? 'Turn video looping off' : 'Turn video looping on'}
  aria-pressed={enabled}
  title={enabled ? 'Video repeats until paused' : 'Play once; enable looping'}
  on:click={toggle}
>
  <span aria-hidden="true">↻</span>
  <span>{enabled ? 'Looping' : 'Loop'}</span>
</button>

<style>
  .video-loop-toggle{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:32px;padding:5px 10px;border:1px solid var(--border,#c7d0c6);border-radius:999px;background:var(--surface,#fff);color:var(--muted,#53615d);font:600 .75rem/1 inherit;cursor:pointer}
  .video-loop-toggle:hover{border-color:var(--link,#215e47);color:var(--link,#215e47)}
  .video-loop-toggle.enabled{border-color:var(--link,#215e47);background:var(--subtle,#edf3eb);color:var(--link,#215e47)}
  .video-loop-toggle:focus-visible{outline:3px solid var(--accent,#9b5e38);outline-offset:2px}
  .video-loop-toggle.compact{min-height:28px;padding:4px 8px;font-size:.7rem}
</style>
