<script>
  import { onMount } from 'svelte';
  let handle = '';
  onMount(async () => {
    const token = localStorage.getItem('swartzit_session');
    if (!token) return;
    try {
      const response = await fetch('/api/me', { headers: { authorization: `Bearer ${token}` } });
      if (response.ok) handle = (await response.json()).handle;
    } catch { /* Public navigation stays usable when the API is unavailable. */ }
  });
</script>
<nav class="session-nav" aria-label="Account">
  {#if handle}<span>u/{handle}</span><a href="/logout">Sign out</a>
  {:else}<a href="/login">Sign in</a><a href="/signup">Create account</a>{/if}
</nav>
