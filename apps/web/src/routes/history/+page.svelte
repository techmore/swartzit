<script>
  import { onMount } from 'svelte';
  import SessionNav from '$lib/SessionNav.svelte';
  import Brand from '$lib/Brand.svelte';
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
<header><Brand /><SessionNav /></header>
<main>
  <div class="heading"><div><h1>Reading history</h1><p>Posts you’ve paused on in your feed or opened. Stored in this browser.</p></div>{#if ready && items.length}<button on:click={clearHistory}>Clear history</button>{/if}</div>
  {#if !ready}<p role="status">Loading history…</p>
  {:else if !items.length}<p>Your history is empty. Posts you stop on in the feed will show up here.</p>
  {:else}<section aria-label="Recently viewed posts">
    {#each items as item (item.public_id)}
      <article><small>{item.community ? `c/${item.community}` : 'Discussion'} · Viewed {new Date(item.viewed_at).toLocaleString()}</small><h2><a href="/post/{item.public_id}">{item.title || 'Untitled post'}</a></h2>{#if item.source_author}<p>From {item.source_author}</p>{/if}</article>
    {/each}
  </section>{/if}
</main>

<style>
  .heading{display:flex;justify-content:space-between;align-items:center;gap:20px}.heading p{color:var(--muted,#66766c)}button{border:1px solid var(--border,#9aaba3);border-radius:6px;padding:9px 13px;background:var(--surface,#fff);color:var(--text,#1d2a27);cursor:pointer}article{padding:18px 0;border-bottom:1px solid var(--border,#dedfd7)}small{color:var(--muted,#66766c)}h2{font:600 1.25rem Georgia,serif;margin:8px 0}article p{margin:0;color:var(--muted,#66766c)}@media(max-width:600px){.heading{align-items:flex-start;flex-direction:column}}
</style>
