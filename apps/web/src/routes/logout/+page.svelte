<script>
  import { onMount } from 'svelte';
  import Brand from '#lib/Brand.svelte';
  import { SESSION_STORAGE_KEY, resetCurrentUser } from '#lib/session-store.js';
  let message = 'Signing out…', note = '';
  onMount(async () => {
    let token = '';
    try { token = localStorage.getItem(SESSION_STORAGE_KEY) ?? ''; } catch { token = ''; }
    if (token) {
      try {
        const response = await fetch('/api/sessions', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
        if (!response.ok && response.status !== 400 && response.status !== 401) note = 'The session could not be revoked on the server, but it has been removed from this browser.';
      } catch {
        note = 'Swartzit could not be reached, so the session was only removed from this browser. It expires on its own within 30 days.';
      }
    }
    try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* Nothing to forget when storage is unavailable. */ }
    resetCurrentUser();
    message = 'You are signed out.';
  });
</script>
<svelte:head><title>Signed out — Swartzit</title><meta name="robots" content="noindex" /></svelte:head>
<header><Brand /><span>Read freely. Participate under a pseudonym. Take your community with you.</span></header>
<main class="auth"><h1 aria-live="polite">{message}</h1><p class="lede">Public discussions remain available without an account.</p>{#if note}<p class="form-message" role="status">{note}</p>{/if}<a href="/">Return to the commons →</a></main>
