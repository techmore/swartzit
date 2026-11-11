<script>
  import Icon from '#lib/Icon.svelte';
  import { queue, playTracks, isCurrent } from '#lib/audio-queue.mjs';
  let { data } = $props();
  const playing = $derived(data.track && isCurrent($queue, data.track.src));
</script>

<svelte:head><title>{data.label} · The Holy Bible · Swartzit</title></svelte:head>

<main id="main-content" class="chapter">
  <a class="crumb" href={`/bible/${data.book.slug}`}><Icon name="arrow-left" size={15} />{data.book.name}</a>
  <header>
    <p class="kicker">King James Version</p>
    <h1>{data.label}</h1>
    {#if data.track}
      <div class="listen-row">
        <button type="button" onclick={() => playTracks([data.track])}><Icon name={playing ? 'headphones' : 'play'} size={17} filled={!playing} /> {playing ? 'Now playing' : 'Listen'}{data.track.title !== data.label ? ` · ${data.track.title}` : ''}</button>
        {#if data.restOfBook.length > 1}<button type="button" class="secondary" onclick={() => playTracks(data.restOfBook, 0)}>Listen through to the end of {data.book.name}</button>{/if}
        {#each data.videos as video (video.youtube)}<a class="watch-link" href={`/bible/${data.book.slug}#watch`}>Watch {video.reader} read {data.book.name}</a>{/each}
      </div>
    {/if}
  </header>

  {#if data.text}
    <article class="scripture" aria-label={data.label}>
      {#each data.text.verses as verse (verse.verse)}
        <p id={`v${verse.verse}`}><sup>{verse.verse}</sup>{verse.text}</p>
      {/each}
    </article>
  {:else}
    <div class="unavailable">
      <p>The text of {data.label} could not be loaded just now.{data.track ? ' You can still listen above.' : ''}</p>
      <a href={data.externalUrl} target="_blank" rel="noopener noreferrer">Read {data.label} on Bible.com ↗</a>
    </div>
  {/if}

  <nav class="neighbours" aria-label="Neighbouring chapters">
    {#if data.previous}<a href={data.previous.href}>← {data.previous.label}</a>{:else}<span></span>{/if}
    {#if data.next}<a href={data.next.href}>{data.next.label} →</a>{/if}
  </nav>
</main>

<style>
  .chapter { max-width: 720px; }
  .crumb { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: .8rem; font-weight: 600; }
  header { margin: 14px 0 20px; padding-bottom: 18px; border-bottom: 1px solid color-mix(in srgb, var(--gilt, var(--border)) 45%, var(--border)); }
  .kicker { margin: 0 0 4px; color: var(--gilt, var(--accent)); font: 700 .72rem/1.2 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; }
  h1 { margin: 0 0 14px; font: 600 clamp(1.9rem, 5vw, 2.6rem)/1.1 var(--font-serif); }
  .listen-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .watch-link { display: inline-flex; align-items: center; min-height: 40px; padding: 0 6px; color: var(--link); font-weight: 600; font-size: .9rem; }
  .listen-row button { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 0 16px; min-height: 40px; }
  .scripture { padding: 0; border: 0; background: transparent; box-shadow: none; font: 400 1.16rem/1.85 var(--font-scripture, var(--font-serif)); color: var(--text); }
  .scripture p { margin: 0 0 .55em; }
  .scripture sup { margin-right: .35em; color: var(--gilt, var(--accent)); font: 700 .62em/1 var(--font-sans); vertical-align: .55em; }
  .scripture p:target { background: var(--accent-soft); border-radius: 4px; }
  .unavailable { padding: 18px; border: 1px dashed var(--border-strong); border-radius: var(--radius); color: var(--muted); }
  .unavailable a { color: var(--link); font-weight: 600; }
  .neighbours { display: flex; justify-content: space-between; gap: 12px; margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); font: 600 .95rem/1.2 var(--font-serif); }
  .neighbours a { color: var(--link); }
  @media (max-width: 700px) { .scripture { font-size: 1.08rem; line-height: 1.75; } }
</style>
