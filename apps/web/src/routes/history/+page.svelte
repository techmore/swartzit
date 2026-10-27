<script>
  import { onMount } from 'svelte';
  let items = [], ready = false;
  function load() {
    try { items = JSON.parse(localStorage.getItem('swartzit_reading_history') || '[]'); }
    catch { items = []; }
    ready = true;
  }
  onMount(load);
  function clearHistory() {
    localStorage.removeItem('swartzit_reading_history');
    items = [];
  }
</script>

<svelte:head><title>Reading history — Swartzit</title><meta name="robots" content="noindex" /></svelte:head>
<main id="main-content" class="page-narrow">
  <div class="heading"><div><h1 class="page-title">Reading history</h1><p class="muted">Posts you’ve paused on or opened. Stored only in this browser.</p></div>{#if ready && items.length}<button class="secondary" on:click={clearHistory}>Clear history</button>{/if}</div>
  {#if !ready}<p role="status" class="muted">Loading history…</p>
  {:else if !items.length}<div class="empty"><h2>Nothing here yet</h2><p>Posts you stop on in the feed will show up here.</p><a class="btn" href="/">Browse the timeline</a></div>
  {:else}<section aria-label="Recently viewed posts" class="list">
    {#each items as item (item.public_id)}
      <a class="entry" href="/post/{item.public_id}"><small>{item.community ? `c/${item.community}` : 'Discussion'} · {new Date(item.viewed_at).toLocaleString()}</small><strong>{item.title || 'Untitled post'}</strong>{#if item.source_author}<span class="muted">From {item.source_author}</span>{/if}</a>
    {/each}
  </section>{/if}
</main>

<style>
  .heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 20px; }
  .list { display: grid; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
  .entry { display: grid; gap: 3px; padding: 14px 18px; border-top: 1px solid var(--border); }
  .entry:first-child { border-top: 0; }
  .entry:hover { background: var(--hover); }
  .entry strong { color: var(--heading); font-size: 1.02rem; }
  .entry span { font-size: .85rem; }
  .empty { display: grid; justify-items: start; gap: 6px; padding: 32px 24px; border: 1px dashed var(--border-strong); border-radius: var(--radius); }
  .empty h2 { margin: 0; font-size: 1.1rem; } .empty p { margin: 0 0 8px; color: var(--muted); }
  @media (max-width: 600px) { .heading { flex-direction: column; } }
</style>
