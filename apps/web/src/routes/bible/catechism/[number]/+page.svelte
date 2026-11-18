<script>
  import Icon from '#lib/Icon.svelte';
  let { data } = $props();
  const q = $derived(data.question);
</script>

<svelte:head><title>Shorter Catechism Q. {q.number} · Swartzit</title></svelte:head>

<main id="main-content" class="question">
  <a class="crumb" href="/bible/catechism"><Icon name="arrow-left" size={15} />Shorter Catechism</a>
  <p class="kicker">Question {q.number} of {data.total}</p>
  <h1>{q.question}</h1>
  <p class="answer">{q.answer}</p>
  {#if q.proofs?.length}
    <section class="proofs" aria-label="Scripture proofs">
      <h2>Scripture proofs</h2>
      <p>{q.proofs.join('; ')}</p>
    </section>
  {/if}
  <nav class="neighbours" aria-label="Other questions">
    {#if data.previous}<a href={`/bible/catechism/${data.previous}`}>← Q. {data.previous}</a>{:else}<span></span>{/if}
    {#if data.next}<a href={`/bible/catechism/${data.next}`}>Q. {data.next} →</a>{/if}
  </nav>
</main>

<style>
  .question { max-width: 720px; }
  .crumb { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: .8rem; font-weight: 600; }
  .kicker { margin: 16px 0 6px; color: var(--gilt-text, var(--accent)); font: 700 .72rem/1.2 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; }
  h1 { margin: 0 0 16px; font: 600 clamp(1.6rem, 4.5vw, 2.3rem)/1.2 var(--font-serif); }
  .answer { margin: 0; font: 400 1.25rem/1.7 var(--font-scripture, var(--font-serif)); color: var(--text); }
  .proofs { margin-top: 22px; padding: 14px 16px; border-left: 3px solid var(--gilt, var(--accent)); background: var(--surface2); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
  .proofs h2 { margin: 0 0 4px; font-size: .78rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); font-family: var(--font-sans); }
  .proofs p { margin: 0; color: var(--text); }
</style>
