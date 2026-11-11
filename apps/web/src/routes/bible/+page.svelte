<script>
  import { BOOKS } from '#lib/bible/books.mjs';
  import { playTracks } from '#lib/audio-queue.mjs';
  import Icon from '#lib/Icon.svelte';
  let { data } = $props();
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const testaments = [['Old Testament', BOOKS.filter(b => b.testament === 'old')], ['New Testament', BOOKS.filter(b => b.testament === 'new')]];
</script>

<svelte:head><title>The Holy Bible · Swartzit</title></svelte:head>

<main id="main-content" class="bible-home">
  <header class="hero">
    <p class="kicker">The Holy Bible · King James Version</p>
    <h1>Read, and hear, the Word of God</h1>
    <p class="lede">“So then faith cometh by hearing, and hearing by the word of God.” <cite>Romans 10:17</cite></p>
  </header>

  <section class="today" aria-labelledby="today-heading">
    <div class="today-head">
      <div>
        <p class="kicker">Daily reading · Day {data.today.day} of 365</p>
        <h2 id="today-heading">{today}</h2>
      </div>
      {#if data.today.tracks.length}
        <button type="button" class="listen-all" onclick={() => playTracks(data.today.tracks, 0)}><Icon name="play" size={18} filled /> Listen to today’s reading</button>
      {/if}
    </div>
    <dl>
      {#each data.today.sections as section}
        <div><dt>{section.label}</dt><dd>{#each section.passages as passage, i}{#if i}{'; '}{/if}<a href={passage.href}>{passage.label}</a>{/each}</dd></div>
      {/each}
    </dl>
    <p class="note">The Old Testament once through in a year, with a psalm and a New Testament chapter every day.</p>
  </section>

  <nav class="study" aria-label="Sermons and study">
    <a href="/?community=sermons"><strong>Sermons</strong><small>Preaching from Reformed and Presbyterian pulpits</small></a>
    <a href="/?community=deeper_dives"><strong>Deeper dives</strong><small>Teaching, lectures, and theology</small></a>
    <a href="/bible/catechism"><strong>Shorter Catechism</strong><small>The Westminster Assembly’s 107 questions</small></a>
  </nav>

  {#each testaments as [label, books]}
    <section class="testament" aria-labelledby={`t-${label}`}>
      <h2 id={`t-${label}`}>{label}</h2>
      <ul>
        {#each books as book (book.slug)}
          <li><a href={`/bible/${book.slug}`}><span>{book.name}</span><small>{book.chapters} {book.chapters === 1 ? 'chapter' : 'chapters'}</small></a></li>
        {/each}
      </ul>
    </section>
  {/each}

  <p class="credits">Scripture text: King James Version (public domain) via bible-api.com. Audio: {data.audioSource}, streamed from the Internet Archive.</p>
</main>

<style>
  .bible-home { max-width: 860px; }
  .hero { padding: 8px 0 22px; border-bottom: 1px solid color-mix(in srgb, var(--gilt, var(--border)) 45%, var(--border)); margin-bottom: 22px; }
  .kicker { margin: 0 0 6px; color: var(--gilt, var(--accent)); font: 700 .72rem/1.2 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; }
  .hero h1 { margin: 0 0 10px; font: 600 clamp(1.8rem, 4vw, 2.6rem)/1.1 var(--font-serif); }
  .lede { margin: 0; color: var(--muted); font: italic 1.05rem/1.5 var(--font-serif); }
  .lede cite { font-style: normal; font-size: .85rem; color: var(--text-light); margin-left: 6px; white-space: nowrap; }
  .today { padding: 18px 20px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-sm); margin-bottom: 30px; }
  .today-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .today h2 { margin: 0; font-size: 1.4rem; }
  .listen-all { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 0 18px; min-height: 42px; }
  dl { display: grid; gap: 8px; margin: 0; }
  dl div { display: grid; grid-template-columns: 130px 1fr; gap: 10px; align-items: baseline; }
  dt { color: var(--text-light); font-size: .78rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  dd { margin: 0; font: 600 1.05rem/1.4 var(--font-serif); }
  dd a { color: var(--link); }
  dd a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .note { margin: 12px 0 0; color: var(--muted); font-size: .82rem; }
  .study { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: -12px 0 30px; }
  .study a { display: grid; gap: 3px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .study a:hover { border-color: var(--border-strong); background: var(--hover); }
  .study strong { font: 600 1.02rem/1.25 var(--font-serif); color: var(--heading); }
  .study small { color: var(--muted); font-size: .76rem; }
  @media (max-width: 700px) { .study { grid-template-columns: 1fr; } }
  .testament { margin-bottom: 28px; }
  .testament h2 { margin: 0 0 12px; font-size: 1.25rem; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .testament ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
  .testament a { display: grid; gap: 2px; padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
  .testament a:hover { border-color: var(--border-strong); background: var(--hover); }
  .testament span { font: 600 .98rem/1.25 var(--font-serif); color: var(--heading); }
  .testament small { display: inline-flex; align-items: center; gap: 4px; color: var(--text-light); font-size: .72rem; }
  .credits { color: var(--text-light); font-size: .76rem; margin-top: 24px; }
  @media (max-width: 700px) {
    dl div { grid-template-columns: 1fr; gap: 2px; }
    .listen-all { width: 100%; justify-content: center; }
  }
</style>
