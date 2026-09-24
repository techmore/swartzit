<script>
  import { onMount } from 'svelte';
  import Brand from '$lib/Brand.svelte';
  let message = 'Signing out…';
  onMount(async () => { const token = localStorage.getItem('swartzit_session'); if (token) await fetch('/api/sessions', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }); localStorage.removeItem('swartzit_session'); message = 'You are signed out.'; });
</script>
<svelte:head><title>Signed out — Swartzit</title></svelte:head>
<header><Brand /><span>Read freely. Participate under a pseudonym. Take your community with you.</span></header>
<main class="auth"><h1>{message}</h1><p class="lede">Public discussions remain available without an account.</p><a href="/">Return to the commons →</a></main>
