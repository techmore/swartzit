<script>
  import { page } from '$app/state';
  import Icon from '#lib/Icon.svelte';

  const missing = $derived(page.status === 404);
  const bible = $derived(page.data?.bible?.enabled === true);
  const heading = $derived(missing ? 'This page isn’t here' : page.status >= 500 ? 'Swartzit couldn’t load this page' : 'Something went wrong');
  const detail = $derived(missing
    ? 'The link may be old, or the post may have been removed.'
    : page.status >= 500 ? 'This is usually brief. Try again in a moment.' : page.error?.message || 'Please try again.');
</script>

<svelte:head><title>{missing ? 'Page not found' : 'Something went wrong'} · Swartzit</title><meta name="robots" content="noindex" /></svelte:head>

<main id="main-content" class="error-page">
  <p class="eyebrow">Error {page.status}</p>
  <h1 class="page-title">{heading}</h1>
  <p class="lede">{detail}</p>
  <div class="ways">
    {#if !missing}<button type="button" onclick={() => location.reload()}>Try again</button>{/if}
    <a class="btn" class:btn-secondary={!missing} href="/"><Icon name="home" size={17} />Go to the timeline</a>
    {#if bible}<a class="btn btn-secondary" href="/bible"><Icon name="book" size={17} />Open the Bible</a>
    {:else}<a class="btn btn-secondary" href="/communities"><Icon name="grid" size={17} />Browse communities</a>{/if}
  </div>
  <form class="search" method="GET" action="/" role="search">
    <label for="error-search">Or search the discussions</label>
    <div><input id="error-search" name="q" maxlength="200" placeholder="Search discussions" /><button type="submit" class="secondary">Search</button></div>
  </form>
</main>

<style>
  .error-page { max-width: 640px; padding-top: 56px; }
  .ways { display: flex; flex-wrap: wrap; gap: 10px; margin: 24px 0 32px; }
  .search { display: grid; gap: 8px; padding-top: 24px; border-top: 1px solid var(--border); }
  .search div { display: flex; gap: 8px; }
  .search input { flex: 1; min-width: 0; }
  @media (max-width: 700px) { .error-page { padding-top: 32px; } .ways :global(.btn), .ways button { flex: 1 1 100%; } }
</style>
