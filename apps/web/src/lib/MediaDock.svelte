<script>
  import { onMount } from 'svelte';

  let active = null;
  let expanded = false;
  let dockVideo;

  onMount(() => {
    const onPlay = (event) => {
      active = event.detail;
      expanded = false;
    };
    const onPause = (event) => {
      if (active?.element === event.detail?.element) active = { ...active, playing: false };
    };
    const onEnded = (event) => {
      if (active?.element === event.detail?.element) active = { ...active, playing: false };
    };
    window.addEventListener('swartzit-media-play', onPlay);
    window.addEventListener('swartzit-media-pause', onPause);
    window.addEventListener('swartzit-media-ended', onEnded);
    return () => {
      window.removeEventListener('swartzit-media-play', onPlay);
      window.removeEventListener('swartzit-media-pause', onPause);
      window.removeEventListener('swartzit-media-ended', onEnded);
    };
  });

  $: if (dockVideo && active?.media?.src && dockVideo.src !== active.media.src) {
    dockVideo.load();
  }

  function togglePlayback() {
    if (!active) return;
    if (dockVideo?.paused) {
      dockVideo.play().catch(() => {});
      active = { ...active, playing: true };
    } else {
      dockVideo?.pause();
      active.element?.pause();
      active = { ...active, playing: false };
    }
  }

  function closeDock() {
    dockVideo?.pause();
    active?.element?.pause();
    active = null;
    expanded = false;
  }

  function returnToTimeline() {
    const element = active?.element;
    closeDock();
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function fullscreen() {
    if (dockVideo?.requestFullscreen) await dockVideo.requestFullscreen();
  }
</script>

{#if active}
  <aside class:expanded class="media-dock" aria-label="Now playing">
    <div class="dock-player">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={dockVideo} src={active.media.src} poster={active.media.poster || undefined} playsinline controls preload="metadata" onplay={() => active = { ...active, playing: true }} onpause={() => active = { ...active, playing: false }} onended={() => active = { ...active, playing: false }}></video>
    </div>
    <div class="dock-info">
      <strong>{active.media.alt || 'Video in progress'}</strong>
      <small>{active.source?.source_author || 'Swartzit media'}</small>
    </div>
    <div class="dock-actions">
      <button type="button" onclick={togglePlayback} aria-label={active.playing ? 'Pause media' : 'Play media'}>{active.playing ? '❚❚' : '▶'}</button>
      <button type="button" onclick={() => expanded = !expanded} aria-label={expanded ? 'Shrink player' : 'Expand player'}>{expanded ? '↙' : '↗'}</button>
      <button type="button" onclick={fullscreen} aria-label="Open full screen">⛶</button>
      <button type="button" onclick={returnToTimeline} aria-label="Return to timeline">⌃</button>
      <button type="button" onclick={closeDock} aria-label="Close media player">×</button>
    </div>
  </aside>
{/if}

<style>
  .media-dock{position:fixed;z-index:20;right:18px;bottom:18px;width:min(430px,calc(100vw - 36px));display:grid;grid-template-columns:76px 1fr auto;gap:10px;align-items:center;padding:10px;border:1px solid var(--border,#9aaba3);border-radius:12px;background:color-mix(in srgb,var(--surface,#fff) 94%,transparent);box-shadow:0 10px 35px #0004;backdrop-filter:blur(14px)}
  .media-dock.expanded{width:min(520px,calc(100vw - 28px));grid-template-columns:1fr auto;align-items:end;padding:12px}.media-dock.expanded .dock-player{grid-column:1/-1}.dock-player{overflow:hidden;border-radius:8px;background:#111;aspect-ratio:16/9}.dock-player video{display:block;width:100%;height:100%;object-fit:cover}.dock-info{min-width:0}.dock-info strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.82rem}.dock-info small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted,#66766c);margin-top:2px}.dock-actions{display:flex;align-items:center;gap:3px}.dock-actions button{width:28px;height:28px;padding:0;border-radius:50%;display:grid;place-items:center;background:transparent;color:var(--text,#1d2a27);font-size:.85rem}.dock-actions button:hover{background:var(--subtle,#e4e9df)}
  @media(max-width:520px){.media-dock{right:10px;bottom:10px;width:calc(100vw - 20px);grid-template-columns:64px 1fr auto}.dock-actions{gap:0}.dock-actions button{width:26px;height:26px}.media-dock.expanded{width:calc(100vw - 20px)}}
</style>
