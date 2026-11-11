<script>
  import Icon from '#lib/Icon.svelte';
  import { queue, playTracks, isCurrent } from '#lib/audio-queue.mjs';
  let { data } = $props();
  const book = $derived(data.book);
  const playingSrc = $derived($queue.tracks[$queue.index]?.src);
  const playingHere = $derived(data.tracks.some(track => track.src === playingSrc));
  const multiChapter = $derived(data.tracks.length < data.book.chapters);
</script>

<svelte:head><title>{book.name} · The Holy Bible · Swartzit</title></svelte:head>

<main id="main-content" class="book">
  <a class="crumb" href="/bible"><Icon name="arrow-left" size={15} />All books</a>
  <header>
    <p class="kicker">{book.testament === 'old' ? 'Old Testament' : 'New Testament'} · King James Version</p>
    <h1>{book.name}</h1>
    <p class="meta">{book.chapters} {book.chapters === 1 ? 'chapter' : 'chapters'}{data.tracks.length ? ` · ${data.tracks.length} ${data.tracks.length === 1 ? 'recording' : 'recordings'}` : ''}</p>
    {#if data.tracks.length}
      <button type="button" class="listen" onclick={() => playTracks(data.tracks, 0)}><Icon name={playingHere ? 'headphones' : 'play'} size={18} filled={!playingHere} /> {playingHere ? `Listening to ${book.name}` : `Listen to ${book.name}`}</button>
    {/if}
  </header>

  <ol class="chapters">
    {#each data.chapters as chapter (chapter.number)}
      {@const track = data.tracks[chapter.trackIndex]}
      {@const current = Boolean(track) && isCurrent($queue, track.src)}
      <li class:current>
        <a href={`/bible/${book.slug}/${chapter.number}`}>{chapter.number}</a>
        {#if track}<button type="button" class="ghost" aria-label={`Listen from ${track.title}`} title={`Listen from ${track.title} to the end of ${book.name}`} onclick={() => playTracks(data.tracks, chapter.trackIndex)}><Icon name={current ? 'headphones' : 'play'} size={13} filled={!current} /></button>{/if}
      </li>
    {/each}
  </ol>
  {#if multiChapter && data.tracks.length}<p class="hint">Some recordings cover several chapters; ▶ starts the recording that contains that chapter.</p>{/if}

  {#each data.videos as video (video.youtube)}
    <section class="watch" id="watch" aria-label={`Watch ${video.reader} read ${book.name}`}>
      <h2>Watch {video.reader} read {book.name}</h2>
      <p class="meta">{video.translation} · {Math.floor(video.minutes / 60)} h {video.minutes % 60} min · {video.publisher}. {video.note}</p>
      <div class="frame"><iframe src={video.embed} title={`${video.title}, read by ${video.reader}`} loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>
    </section>
  {/each}

  <nav class="neighbours" aria-label="Neighbouring books">
    {#if data.previous}<a href={`/bible/${data.previous.slug}`}>← {data.previous.name}</a>{:else}<span></span>{/if}
    {#if data.next}<a href={`/bible/${data.next.slug}`}>{data.next.name} →</a>{/if}
  </nav>
</main>

<style>
  .book { max-width: 760px; }
  .crumb { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: .8rem; font-weight: 600; }
  header { margin: 14px 0 22px; padding-bottom: 20px; border-bottom: 1px solid color-mix(in srgb, var(--gilt, var(--border)) 45%, var(--border)); }
  .kicker { margin: 0 0 4px; color: var(--gilt, var(--accent)); font: 700 .72rem/1.2 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; }
  h1 { margin: 0; font: 600 clamp(2rem, 5vw, 3rem)/1.05 var(--font-serif); }
  .meta { margin: 6px 0 14px; color: var(--muted); }
  .listen { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 20px; border-radius: 999px; }
  .chapters { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; }
  .chapters li { display: flex; align-items: center; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); overflow: hidden; }
  .chapters li.current { border-color: var(--accent); background: var(--accent-soft); }
  .chapters a { flex: 1; padding: 10px 0 10px 12px; font: 600 1.05rem/1 var(--font-serif); color: var(--heading); }
  .chapters a:hover { color: var(--accent); }
  .chapters button { width: 32px; min-height: 38px; padding: 0; border-radius: 0; color: var(--muted); }
  .hint { margin: 12px 0 0; color: var(--text-light); font-size: .78rem; }
  .watch { margin-top: 30px; padding-top: 20px; border-top: 1px solid color-mix(in srgb, var(--gilt, var(--border)) 45%, var(--border)); }
  .watch h2 { margin: 0; font: 600 1.35rem/1.2 var(--font-serif); }
  .watch .meta { margin: 6px 0 12px; font-size: .85rem; }
  .frame { aspect-ratio: 16 / 9; border-radius: var(--radius-sm); overflow: hidden; background: #111; }
  .frame iframe { display: block; width: 100%; height: 100%; border: 0; }
  .neighbours { display: flex; justify-content: space-between; margin-top: 30px; font: 600 .95rem/1 var(--font-serif); }
  .neighbours a { color: var(--link); }
</style>
