<script>
  import { onMount } from 'svelte';
  import Icon from '#lib/Icon.svelte';
  import { queue, step, jumpTo, clearQueue, savedPosition, savePosition, formatTime } from '#lib/audio-queue.mjs';

  const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];
  const MINI_KEY = 'swartzit_audio_mini';
  let audio = $state();
  let playing = $state(false);
  let buffering = $state(false);
  let current = $state(0);
  let duration = $state(0);
  let speed = $state(1);
  let showQueue = $state(false);
  // Phones can shrink the player to one row so it covers less of the page.
  let mini = $state(false);
  let failed = $state(false);
  let lastRequest = -1;
  let lastSaved = 0;

  const state = $derived($queue);
  const track = $derived(state.tracks[state.index] ?? null);
  const multi = $derived(state.tracks.length > 1);
  // "Loading" only while the listener is waiting for sound, never while paused.
  const loading = $derived(buffering && playing && !failed);
  const percent = $derived(Number.isFinite(duration) && duration > 0 ? Math.min(100, (current / duration) * 100) : 0);

  onMount(() => {
    try {
      const saved = Number(localStorage.getItem('swartzit_audio_speed'));
      if (SPEEDS.includes(saved)) speed = saved;
      mini = localStorage.getItem(MINI_KEY) === '1';
    } catch { /* Default speed, full player. */ }
    const onKey = event => { if (event.key === 'Escape' && showQueue) showQueue = false; };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); delete document.documentElement.dataset.player; };
  });

  // Tell the page how much room the player takes, so the end of a chapter or
  // feed can always scroll clear of it (see --player-space in app.css).
  $effect(() => {
    if (track) document.documentElement.dataset.player = mini ? 'mini' : 'open';
    else delete document.documentElement.dataset.player;
  });

  // Load and start whenever the queue asks for a (new) track.
  $effect(() => {
    const requested = state.requested;
    const next = track;
    if (!audio || requested === lastRequest) return;
    lastRequest = requested;
    if (!next) { audio.pause(); audio.removeAttribute('src'); audio.load(); playing = false; buffering = false; return; }
    failed = false;
    if (audio.src !== new URL(next.src, location.href).href) {
      audio.src = next.src;
      audio.load();
    }
    audio.playbackRate = speed;
    audio.play().catch(() => { playing = false; buffering = false; });
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
  function setMini(value) {
    mini = value;
    if (value) showQueue = false;
    try { localStorage.setItem(MINI_KEY, value ? '1' : '0'); } catch { /* Size lasts for this visit. */ }
  }
  function close() {
    savePosition(track?.src, current, duration);
    audio?.pause();
    showQueue = false;
    clearQueue();
  }
</script>

<audio bind:this={audio} preload="metadata"
  onplay={() => playing = true} onpause={() => { playing = false; buffering = false; }}
  onloadstart={() => buffering = true} onwaiting={() => buffering = true}
  oncanplay={() => buffering = false} onplaying={() => buffering = false}
  onloadedmetadata={onLoaded} ontimeupdate={onTime} onended={onEnded}
  onerror={() => { if (track) { failed = true; buffering = false; } }}></audio>

{#if track}
  <section class="audio-player" class:mini aria-label="Listening player">
    {#if showQueue && multi}
      <div class="queue" id="audio-queue">
        <p class="queue-head">Listening queue · {state.tracks.length} recordings</p>
        <ol>
          {#each state.tracks as item, index (item.src)}
            <li><button type="button" class:current={index === state.index} aria-current={index === state.index ? 'true' : undefined} onclick={() => jumpTo(index)}>
              <span class="n">{#if index === state.index}<Icon name="headphones" size={15} />{:else}{index + 1}{/if}</span><span class="t">{item.title}</span>
            </button></li>
          {/each}
        </ol>
      </div>
    {/if}
    <div class="hairline" aria-hidden="true"><i style:width={`${percent}%`}></i></div>
    <div class="bar">
      <div class="transport">
        {#if multi}<button type="button" class="ghost" onclick={() => step(-1)} disabled={state.index === 0} aria-label="Previous recording" title="Previous recording"><Icon name="skip-back" size={18} /></button>{/if}
        <button type="button" class="ghost skip" onclick={() => seek(-15)} aria-label="Back 15 seconds" title="Back 15 seconds">−15</button>
        <button type="button" class="play" class:buffering={loading} onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause-solid' : 'play'} size={20} filled /></button>
        <button type="button" class="ghost skip" onclick={() => seek(30)} aria-label="Forward 30 seconds" title="Forward 30 seconds">+30</button>
        {#if multi}<button type="button" class="ghost" onclick={() => step(1)} disabled={state.index >= state.tracks.length - 1} aria-label="Next recording" title="Next recording"><Icon name="skip-forward" size={18} /></button>{/if}
      </div>
      <div class="titles">
        {#if track.href}<a href={track.href}><strong>{track.title}</strong></a>{:else}<strong>{track.title}</strong>{/if}
        <small class="sub" role="status">{failed ? 'This recording could not be loaded.' : loading ? 'Loading…' : track.subtitle}{multi ? ` · ${state.index + 1} of ${state.tracks.length}` : ''}</small>
        <small class="sub-mini">{failed ? 'Could not be loaded' : loading ? 'Loading…' : `${formatTime(current)} / ${formatTime(duration)}`}{multi ? ` · ${state.index + 1} of ${state.tracks.length}` : ''}</small>
      </div>
      <div class="progress">
        <span>{formatTime(current)}</span>
        <input type="range" min="0" max={Number.isFinite(duration) && duration > 0 ? duration : 0} step="1" value={current} oninput={scrub} aria-label="Position" aria-valuetext={`${formatTime(current)} of ${formatTime(duration)}`} />
        <span>{formatTime(duration)}</span>
      </div>
      <button type="button" class="ghost speed" onclick={cycleSpeed} aria-label={`Playback speed ${speed}×. Change speed`} title="Change playback speed">{speed}×</button>
      {#if multi}<button type="button" class="ghost queue-toggle" class:on={showQueue} onclick={() => showQueue = !showQueue} aria-expanded={showQueue} aria-controls="audio-queue" aria-label="Listening queue" title="Listening queue"><Icon name="list" size={19} /></button>{/if}
      <button type="button" class="ghost collapse" onclick={() => setMini(!mini)} aria-expanded={!mini} aria-label={mini ? 'Show full player' : 'Shrink player'} title={mini ? 'Show full player' : 'Shrink player'}><Icon name={mini ? 'chevron-up' : 'chevron-down'} size={20} /></button>
      <button type="button" class="ghost close" onclick={close} aria-label="Stop and close player" title="Stop and close player"><Icon name="x" size={18} /></button>
    </div>
  </section>
{/if}

<style>
  .audio-player { position: fixed; z-index: 35; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom)); transform: translateX(-50%); width: min(760px, calc(100vw - 28px)); border: 1px solid var(--border-strong); border-radius: var(--radius); background: color-mix(in srgb, var(--surface) 96%, transparent); box-shadow: var(--shadow-lg); backdrop-filter: blur(14px); overflow: hidden; }
  .bar { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto auto; grid-template-areas: "transport titles speed queue close" "transport progress speed queue close"; align-items: center; gap: 2px 6px; padding: 8px 10px 8px 12px; }
  .transport { grid-area: transport; display: flex; align-items: center; gap: 2px; margin-right: 6px; }
  .titles { grid-area: titles; min-width: 0; }
  .progress { grid-area: progress; }
  .speed { grid-area: speed; }
  .queue-toggle { grid-area: queue; }
  .close { grid-area: close; }
  .collapse, .hairline, .sub-mini { display: none; }

  .bar button { min-width: 40px; min-height: 40px; padding: 0; border-radius: 999px; }
  .skip, .speed { font: 700 .78rem/1 var(--font-sans); font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .speed { min-width: 46px; }
  .queue-toggle.on { background: var(--accent-soft); color: var(--accent); }
  .bar .play { width: 44px; height: 44px; margin: 0 2px; background: var(--button-bg); color: var(--button-text); }
  .play.buffering { animation: pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .55; } }

  .titles strong { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font: 650 .95rem/1.25 var(--font-serif); color: var(--heading); }
  .titles a:hover strong { text-decoration: underline; text-underline-offset: 3px; }
  .titles small { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); font-size: .76rem; }
  .titles .sub { display: block; }
  .progress { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; font: 600 .72rem/1 var(--font-sans); font-variant-numeric: tabular-nums; color: var(--muted); }
  .progress input { width: 100%; height: 20px; min-height: 0; padding: 0; margin: 0; accent-color: var(--accent); border: 0; background: transparent; }

  .queue { border-bottom: 1px solid var(--border); }
  .queue-head { margin: 0; padding: 10px 16px 4px; color: var(--muted); font: 700 .7rem/1.2 var(--font-sans); letter-spacing: .1em; text-transform: uppercase; }
  .queue ol { list-style: none; margin: 0; padding: 4px 8px 8px; max-height: min(42vh, 320px); overflow: auto; overscroll-behavior: contain; }
  .queue button { display: flex; align-items: center; justify-content: flex-start; gap: 10px; width: 100%; min-height: 40px; padding: 6px 10px; border-radius: var(--radius-sm); background: transparent; color: var(--text); font-weight: 500; text-align: left; white-space: normal; }
  .queue button:hover { background: var(--hover); filter: none; }
  .queue button.current { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .queue .n { display: grid; place-items: center; flex: none; width: 22px; color: var(--muted); font: 600 .78rem/1 var(--font-sans); font-variant-numeric: tabular-nums; }
  .queue .current .n { color: inherit; }
  .queue .t { min-width: 0; font: inherit; line-height: 1.3; }

  @media (pointer: coarse) {
    .bar button, .queue button { min-width: 44px; min-height: 44px; }
    /* A 44px grab area for the scrubber without making the row taller. */
    .progress input { height: 44px; margin: -10px 0; }
  }

  /* Phones: titles on top, the scrubber across, and the transport on the
     bottom row where a thumb reaches it. Sits just above the bottom nav. */
  @media (max-width: 700px) {
    .audio-player { bottom: calc(74px + env(safe-area-inset-bottom)); width: calc(100vw - 16px); }
    .bar { grid-template-columns: 44px minmax(0, 1fr) 44px 44px; grid-template-areas: "titles titles collapse close" "progress progress progress progress" "speed transport transport queue"; gap: 2px 4px; padding: 8px 10px 10px 14px; }
    .bar button { min-width: 44px; min-height: 44px; }
    .collapse { grid-area: collapse; display: inline-flex; }
    .transport { justify-self: center; margin: 0; gap: 4px; }
    .transport button { flex: 0 1 auto; width: 44px; min-width: 36px; }
    .bar .play { flex: none; width: 52px; height: 52px; margin: 0 4px; }
    .speed { justify-self: start; }
    .queue-toggle { justify-self: end; }
    .titles strong { font-size: 1rem; }

    .mini .bar { grid-template-columns: auto minmax(0, 1fr) 44px; grid-template-areas: "transport titles collapse"; padding: 6px 8px; gap: 0 10px; }
    .mini .transport button:not(.play), .mini .progress, .mini .speed, .mini .queue-toggle, .mini .close, .mini .sub { display: none; }
    .mini .bar .play { width: 44px; height: 44px; margin: 0; }
    .mini .sub-mini { display: block; font-variant-numeric: tabular-nums; }
    .mini .hairline { display: block; height: 3px; background: var(--border); }
    .hairline i { display: block; height: 100%; background: var(--accent); }
  }
</style>
