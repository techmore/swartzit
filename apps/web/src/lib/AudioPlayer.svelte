<script>
  import { onMount } from 'svelte';
  import { queue, step, jumpTo, clearQueue, savedPosition, savePosition, formatTime } from '#lib/audio-queue.mjs';

  const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];
  let audio = $state();
  let playing = $state(false);
  let current = $state(0);
  let duration = $state(0);
  let speed = $state(1);
  let showQueue = $state(false);
  let failed = $state(false);
  let lastRequest = -1;
  let lastSaved = 0;

  const state = $derived($queue);
  const track = $derived(state.tracks[state.index] ?? null);

  onMount(() => {
    try { const saved = Number(localStorage.getItem('swartzit_audio_speed')); if (SPEEDS.includes(saved)) speed = saved; } catch { /* Default speed. */ }
  });

  // Load and start whenever the queue asks for a (new) track.
  $effect(() => {
    const requested = state.requested;
    const next = track;
    if (!audio || requested === lastRequest) return;
    lastRequest = requested;
    if (!next) { audio.pause(); audio.removeAttribute('src'); audio.load(); playing = false; return; }
    failed = false;
    if (audio.src !== new URL(next.src, location.href).href) {
      audio.src = next.src;
      audio.load();
    }
    audio.playbackRate = speed;
    audio.play().catch(() => { playing = false; });
    updateSession(next);
  });

  $effect(() => { if (audio) audio.playbackRate = speed; });

  function updateSession(next) {
    if (!('mediaSession' in navigator) || !next) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: next.title,
      artist: next.subtitle || 'Swartzit',
      album: state.tracks.length > 1 ? `${state.index + 1} of ${state.tracks.length}` : '',
      artwork: next.artwork ? [{ src: next.artwork }] : [{ src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]
    });
    const handlers = {
      play: () => audio?.play(),
      pause: () => audio?.pause(),
      previoustrack: () => step(-1),
      nexttrack: () => step(1),
      seekbackward: () => seek(-15),
      seekforward: () => seek(30)
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
    }
  }

  function onLoaded() {
    duration = audio.duration;
    const resume = savedPosition(track?.src);
    if (resume && resume < duration - 30) audio.currentTime = resume;
  }
  function onTime() {
    current = audio.currentTime;
    if (Math.abs(current - lastSaved) >= 10) { lastSaved = current; savePosition(track?.src, current, duration); }
  }
  function onEnded() {
    savePosition(track?.src, duration, duration);
    playing = false;
    step(1);
  }
  function toggle() {
    if (!audio || !track) return;
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  function seek(delta) {
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + delta), audio.duration);
  }
  function scrub(event) {
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = Number(event.currentTarget.value);
  }
  function cycleSpeed() {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    try { localStorage.setItem('swartzit_audio_speed', String(speed)); } catch { /* Speed lasts for this visit. */ }
  }
  function close() {
    savePosition(track?.src, current, duration);
    audio?.pause();
    showQueue = false;
    clearQueue();
  }
</script>

<audio bind:this={audio} preload="metadata" onplay={() => playing = true} onpause={() => playing = false} onloadedmetadata={onLoaded} ontimeupdate={onTime} onended={onEnded} onerror={() => { if (track) failed = true; }}></audio>

{#if track}
  <section class="audio-player" aria-label="Listening">
    {#if showQueue && state.tracks.length > 1}
      <ol class="queue" aria-label="Up next">
        {#each state.tracks as item, index (item.src)}
          <li><button type="button" class:current={index === state.index} aria-current={index === state.index ? 'true' : undefined} onclick={() => jumpTo(index)}><span>{index + 1}</span>{item.title}</button></li>
        {/each}
      </ol>
    {/if}
    <div class="bar">
      <div class="controls">
        <button type="button" class="ghost" onclick={() => step(-1)} disabled={state.index === 0} aria-label="Previous recording">⏮</button>
        <button type="button" class="ghost skip" onclick={() => seek(-15)} aria-label="Back 15 seconds">-15</button>
        <button type="button" class="play" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
        <button type="button" class="ghost skip" onclick={() => seek(30)} aria-label="Forward 30 seconds">+30</button>
        <button type="button" class="ghost" onclick={() => step(1)} disabled={state.index >= state.tracks.length - 1} aria-label="Next recording">⏭</button>
      </div>
      <div class="info">
        <div class="titles">
          {#if track.href}<a href={track.href}><strong>{track.title}</strong></a>{:else}<strong>{track.title}</strong>{/if}
          <small>{failed ? 'This recording could not be loaded.' : track.subtitle}{state.tracks.length > 1 ? ` · ${state.index + 1} of ${state.tracks.length}` : ''}</small>
        </div>
        <div class="progress">
          <span>{formatTime(current)}</span>
          <input type="range" min="0" max={Number.isFinite(duration) && duration > 0 ? duration : 0} step="1" value={current} oninput={scrub} aria-label="Position" />
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div class="extras">
        <button type="button" class="ghost speed" onclick={cycleSpeed} aria-label={`Playback speed ${speed}×`}>{speed}×</button>
        {#if state.tracks.length > 1}<button type="button" class="ghost" onclick={() => showQueue = !showQueue} aria-expanded={showQueue} aria-label="Show queue">☰</button>{/if}
        <button type="button" class="ghost" onclick={close} aria-label="Stop and close player">×</button>
      </div>
    </div>
  </section>
{/if}

<style>
  .audio-player{position:fixed;z-index:35;left:50%;bottom:14px;transform:translateX(-50%);width:min(760px,calc(100vw - 28px));border:1px solid var(--border-strong);border-radius:var(--radius);background:color-mix(in srgb,var(--surface) 96%,transparent);box-shadow:var(--shadow-lg);backdrop-filter:blur(14px)}
  .bar{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:8px 12px}
  .controls,.extras{display:flex;align-items:center;gap:2px}
  .controls button,.extras button{min-height:34px;min-width:34px;padding:0 6px;border-radius:999px;font-size:.85rem}
  .controls .skip{font:700 .68rem/1 var(--font-mono)}
  .play{width:40px;height:40px;min-width:40px;padding:0;border-radius:50%;background:var(--button-bg);color:var(--button-text);font-size:.9rem}
  .speed{font:700 .72rem/1 var(--font-mono)}
  .info{min-width:0;display:grid;gap:2px}
  .titles{min-width:0}
  .titles strong{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:650 .92rem/1.25 var(--font-serif);color:var(--heading)}
  .titles a:hover strong{text-decoration:underline;text-underline-offset:3px}
  .titles small{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--muted);font-size:.74rem}
  .progress{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;font:600 .68rem/1 var(--font-mono);color:var(--text-light)}
  .progress input{width:100%;min-height:0;padding:0;accent-color:var(--accent);border:0;background:transparent}
  .queue{list-style:none;margin:0;padding:8px;max-height:min(46vh,360px);overflow:auto;border-bottom:1px solid var(--border)}
  .queue button{display:flex;gap:10px;width:100%;min-height:34px;padding:6px 10px;border-radius:var(--radius-sm);background:transparent;color:var(--text);font-weight:500;text-align:left}
  .queue button:hover{background:var(--hover)}
  .queue button.current{background:var(--accent-soft);color:var(--accent);font-weight:700}
  .queue span{min-width:2ch;color:var(--text-light);font:600 .75rem/1.6 var(--font-mono)}
  @media (max-width:700px){
    .audio-player{bottom:calc(70px + env(safe-area-inset-bottom));width:calc(100vw - 16px)}
    .bar{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"info extras" "controls controls";gap:4px 8px;padding:8px 10px}
    .info{grid-area:info}.extras{grid-area:extras}.controls{grid-area:controls;justify-content:center;gap:10px}
  }
</style>
