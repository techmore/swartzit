<script>
  import Icon from '#lib/Icon.svelte';
  let { data } = $props();
  let wanted = $state('');
  // 107 questions is a long scroll on a phone; jump straight to one.
  function jump(event) {
    event.preventDefault();
    const number = Math.round(Number(wanted));
    if (number >= 1 && number <= data.questions.length) location.hash = `q${number}`;
  }
</script>

<svelte:head><title>Westminster Shorter Catechism · Swartzit</title></svelte:head>

<main id="main-content" class="catechism">
  <a class="crumb" href="/bible"><Icon name="arrow-left" size={15} />The Holy Bible</a>
  <p class="kicker">Westminster Assembly · 1647</p>
  <h1>The Shorter Catechism</h1>
  <form class="jump" onsubmit={jump}>
    <label for="jump-question">Go to question</label>
    <input id="jump-question" type="number" inputmode="numeric" min="1" max={data.questions.length} placeholder={`1–${data.questions.length}`} bind:value={wanted} />
    <button type="submit" class="secondary">Go</button>
  </form>
  <ol>
    {#each data.questions as q (q.number)}
      <li id={`q${q.number}`}>
        <a href={`/bible/catechism/${q.number}`}><span>Q. {q.number}.</span> {q.question}</a>
        <p>{q.answer}</p>
      </li>
    {/each}
  </ol>
</main>

<style>
  .catechism { max-width: 760px; }
  .crumb { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: .8rem; font-weight: 600; }
  .kicker { margin: 16px 0 4px; color: var(--gilt-text, var(--accent)); font: 700 .72rem/1.2 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; }
  .jump { display: flex; align-items: center; gap: 8px; margin: 0 0 22px; }
  .jump label { color: var(--muted); font-weight: 600; }
  .jump input { width: 6.5rem; }
  li:target a { color: var(--accent); }
  h1 { margin: 0 0 16px; font: 600 clamp(1.8rem, 4.5vw, 2.5rem)/1.1 var(--font-serif); }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
  li { padding-bottom: 14px; border-bottom: 1px solid var(--border); }
  li a { font: 600 1.08rem/1.4 var(--font-serif); color: var(--heading); }
  li a:hover { color: var(--accent); }
  li span { color: var(--gilt-text, var(--accent)); }
  li p { margin: 6px 0 0; font: 400 1.02rem/1.6 var(--font-scripture, var(--font-serif)); color: var(--text); }
</style>
