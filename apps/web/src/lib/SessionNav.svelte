<script>
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import ThemeToggle from '$lib/ThemeToggle.svelte';
  import AutoplayToggle from '$lib/AutoplayToggle.svelte';
  export let compact = false;
  let handle = '', isAdmin = false;
  onMount(async () => {
    const token = localStorage.getItem('swartzit_session');
    if (!token) return;
    try {
      const response = await fetch('/api/me', { headers: { authorization: `Bearer ${token}` } });
      if (response.ok) { const user = await response.json(); handle = user.handle; isAdmin = user.is_admin; }
    } catch { /* Public navigation stays usable when the API is unavailable. */ }
  });
</script>
<nav class:compact class="session-nav" aria-label="Account and navigation">
  <span class="preferences" aria-label="Display preferences"><ThemeToggle compact /><AutoplayToggle compact /></span>
  {#if compact}
    <a href="/about" aria-label="About Swartzit" title="About Swartzit"><Icon name="info" /></a>
    <a href="/communities" aria-label="Browse communities" title="Communities"><Icon name="grid" /></a>
    <a href="/history" aria-label="Reading history" title="History"><Icon name="clock" /></a>
    {#if handle}
      <a href="/bookmarks" aria-label="Favorites" title="Favorites"><Icon name="bookmark" /></a>
      <a href={'/u/' + handle} aria-label={'Profile for u/' + handle} title={'u/' + handle}><Icon name="user" /></a>
      {#if isAdmin}<a href="/admin" aria-label="Admin" title="Admin"><Icon name="admin" /></a>{/if}
      <a href="/logout" aria-label="Sign out" title="Sign out"><Icon name="login" /></a>
    {:else}
      <a href="/login" aria-label="Sign in" title="Sign in"><Icon name="login" /></a>
      <a href="/signup" class="compact-signup" aria-label="Create account" title="Create account">Join</a>
    {/if}
  {:else}
    <a href="/about">About</a><a href="/communities">Communities</a><a href="/history">History</a>
    {#if handle}<a href="/bookmarks">Favorites</a><a href={'/u/' + handle}>u/{handle}</a>{#if isAdmin}<a href="/admin">Admin</a>{/if}<a href="/logout">Sign out</a>
    {:else}<a href="/login">Sign in</a><a href="/signup">Create account</a>{/if}
  {/if}
</nav>
<style>
  .preferences{display:flex;align-items:center;gap:2px;margin-right:2px}
  :global(.preferences button){color:var(--muted,#66766c)}
  .session-nav.compact{display:flex;align-items:center;gap:3px;margin-left:4px}
  .session-nav.compact a{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:9px;color:var(--muted,#66766c);font-size:.8rem}
  .session-nav.compact a:hover,.session-nav.compact a:focus-visible{background:var(--subtle,#e4e9df);color:var(--heading,#173d34)}
  :global(.session-nav.compact svg){width:18px;height:18px}
  .session-nav.compact .compact-signup{width:auto;padding:0 10px;color:var(--heading,#173d34);font-weight:750}
</style>
