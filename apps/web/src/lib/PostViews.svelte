<script>
  import { onMount } from 'svelte';
  import { createDwellClock } from './dwell.mjs';
  export let id;
  export let initial;
  let counts = initial, element;
  onMount(() => {
    if (!crypto?.getRandomValues || !window.IntersectionObserver) return;
    const visit = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    const clock = createDwellClock(performance.now());
    let inView = false, acknowledged = -1, sending = false, stopped = false;
    const controller = new AbortController();
    async function tick() {
      const eligible = inView && document.visibilityState === 'visible';
      const elapsed = clock.sample(performance.now(), eligible);
      if (sending || stopped || !eligible) return;
      // Send open before milestones, with a margin for server/client timing.
      const milestone = acknowledged < 0 ? 0 : elapsed >= 31000 ? 30 : elapsed >= 11000 ? 10 : 0;
      if (milestone <= acknowledged) return;
      sending = true;
      try {
        const response = await fetch('/api/posts/' + id + '/views', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ visit_id: visit, visible_seconds: milestone }),
          signal: controller.signal
        });
        if (response.ok && !stopped) { counts = await response.json(); acknowledged = milestone; }
      } catch { /* Reading remains available if telemetry fails. */ }
      finally { sending = false; }
    }
    const observer = new IntersectionObserver(entries => {
      // Account for the preceding interval before changing intersection state.
      clock.sample(performance.now(), inView && document.visibilityState === 'visible');
      inView = entries[0].isIntersecting;
      tick();
    });
    observer.observe(element.closest('article'));
    document.addEventListener('visibilitychange', tick);
    const timer = setInterval(tick, 1000);
    return () => { stopped = true; controller.abort(); clearInterval(timer); observer.disconnect(); document.removeEventListener('visibilitychange', tick); };
  });
</script>
<span bind:this={element} class="post-views" title="Opens and visible reading milestones. Repeat visits count; these are not unique people.">
  {counts.view_count} views · {counts.engaged_view_count} engaged (10s) · {counts.deep_view_count} deeper reads (30s)
</span>
