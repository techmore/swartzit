<script>
  import { onMount } from 'svelte';
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
<nav class="session-nav" aria-label="Account">
  <a href="/communities">Communities</a>
  {#if handle}<span>u/{handle}</span>{#if isAdmin}<a href="/admin">Admin</a>{/if}<a href="/logout">Sign out</a>
  {:else}<a href="/login">Sign in</a><a href="/signup">Create account</a>{/if}
</nav>
