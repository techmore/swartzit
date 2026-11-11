<script>
  import Icon from '#lib/Icon.svelte';
  import { queue, playTracks, enqueueTracks, tracksFromPost, isCurrent } from '#lib/audio-queue.mjs';
  let { post, label = '' } = $props();

  const tracks = $derived(tracksFromPost(post));
  const state = $derived($queue);
  const playingIndex = $derived(tracks.findIndex(track => isCurrent(state, track.src)));
  const heading = $derived(label || (tracks.length > 1 ? `${tracks.length} recordings` : 'Listen'));
</script>

{#if tracks.length}
  <div class="audio-attachment" class:active={playingIndex >= 0}>
    <button type="button" class="listen" onclick={() => playTracks(tracks, 0)} aria-label={`Play ${tracks.length > 1 ? 'all ' + tracks.length + ' recordings' : tracks[0].title}`}>
      <Icon name={playingIndex >= 0 ? 'headphones' : 'play'} size={20} filled={playingIndex < 0} />
    </button>
    <div class="about">
      <strong>{playingIndex >= 0 ? `Now playing · ${tracks[playingIndex].title}` : heading}</strong>
      {#if tracks.length > 1}
        <ul class="tracks">
          {#each tracks as track, index (track.src)}
            <li><button type="button" class:current={index === playingIndex} aria-current={index === playingIndex ? 'true' : undefined} onclick={() => playTracks(tracks, index)}>{track.title}</button></li>
          {/each}
        </ul>
      {:else}
        <small>{tracks[0].subtitle || 'Audio'}</small>
      {/if}
    </div>
    <button type="button" class="queue-btn ghost" onclick={() => enqueueTracks(tracks)} title="Add to listening queue" aria-label="Add to listening queue">＋</button>
  </div>
{/if}

<style>
  .audio-attachment{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;margin:8px 0 4px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface2)}
  .audio-attachment.active{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));background:var(--accent-soft)}
  .listen{display:grid;place-items:center;width:44px;height:44px;min-height:44px;padding:0;border-radius:50%;background:var(--button-bg);color:var(--button-text)}
  .about{min-width:0}
  .about strong{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:.9rem;color:var(--heading)}
  .about small{display:block;margin-top:2px;color:var(--muted);font-size:.76rem}
  .tracks{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 0;padding:0;list-style:none}
  .tracks button{min-height:26px;padding:2px 9px;border:1px solid var(--border-strong);border-radius:999px;background:var(--surface);color:var(--text);font-size:.74rem;font-weight:600}
  .tracks button:hover{background:var(--hover)}
  .tracks button.current{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
  .queue-btn{width:34px;height:34px;min-height:34px;padding:0;border-radius:50%;font-size:1.1rem}
</style>
