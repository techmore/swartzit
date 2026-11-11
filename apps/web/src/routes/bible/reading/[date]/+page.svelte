<script>
  import Icon from '#lib/Icon.svelte';
  import { playTracks } from '#lib/audio-queue.mjs';
  let { data } = $props();
  const heading = $derived(new Date(`${data.reading.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }));
</script>

<svelte:head><title>Daily reading · {data.reading.summary} · Swartzit</title></svelte:head>

<main id="main-content" class="reading">
  <a class="crumb" href="/bible"><Icon name="arrow-left" size={15} />The Holy Bible</a>
  <p class="kicker">Daily reading · Day {data.reading.day} of 365</p>
  <h1>{heading}</h1>
  <dl>
    {#each data.reading.sections as section}
      <div><dt>{section.label}</dt><dd>{#each section.passages as passage, i}{#if i}{'; '}{/if}<a href={passage.href}>{passage.label}</a>{/each}</dd></div>
    {/each}
  </dl>
  {#if data.reading.tracks.length}
    <button type="button" class="listen" onclick={() => playTracks(data.reading.tracks, 0)}><Icon name="play" size={17} filled /> Listen to this reading</button>
  {/if}
  <nav class="neighbours" aria-label="Other days">
    <a href={`/bible/reading/${data.previous}`}>← Previous day</a>
    <a href={`/bible/reading/${data.next}`}>Next day →</a>
  </nav>
</main>

<style>
  .reading { max-width: 720px; }
  .crumb { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: .8rem; font-weight: 600; }
  .kicker { margin: 16px 0 4px; color: var(--gilt-text, var(--accent)); font: 700 .72rem/1.2 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; }
  h1 { margin: 0 0 18px; font: 600 clamp(1.7rem, 4.5vw, 2.4rem)/1.1 var(--font-serif); }
  dl { display: grid; gap: 10px; margin: 0 0 20px; }
  dl div { display: grid; grid-template-columns: 140px 1fr; gap: 10px; align-items: baseline; }
  dt { color: var(--text-light); font-size: .78rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  dd { margin: 0; font: 600 1.15rem/1.4 var(--font-serif); }
  dd a { color: var(--link); }
  .listen { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 20px; border-radius: 999px; }
  @media (max-width: 700px) { dl div { grid-template-columns: 1fr; gap: 2px; } }
</style>
