<script>
  import { onMount } from 'svelte';
  onMount(() => { if (new URLSearchParams(location.search).has('created')) message = 'Account created. Sign in with your new password.'; });
  let handle = '', password = '', message = '', error = '';
  async function submit() { error = ''; message = ''; const response = await fetch('/api/sessions', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ handle, password }) }); const data = await response.json(); if (!response.ok) { error = data.error ?? 'Could not sign in'; return; } localStorage.setItem('swartzit_session', data.token); window.location.assign('/'); }
</script>
<svelte:head><title>Sign in — Swartzit</title></svelte:head>
<header><a class="brand" href="/">swartzit</a><span>Read freely. Participate under a pseudonym. Take your community with you.</span><a class="login" href="/signup">Create account</a></header>
<main class="auth"><p class="eyebrow">WELCOME BACK</p><h1>Sign in</h1><p class="lede">Your public reading never depended on an account. Sign in when you’re ready to participate.</p><form on:submit|preventDefault={submit}><label>Handle<input id="login-username" name="username" bind:value={handle} autocomplete="username" autocapitalize="none" spellcheck="false" required /></label><label>Password<input id="login-password" name="password" type="password" bind:value={password} autocomplete="current-password" required /></label><button>Sign in</button></form>{#if error}<p class="form-error">{error}</p>{/if}{#if message}<p class="form-message">{message}</p>{/if}<p class="switch">New here? <a href="/signup">Create an account</a>.</p></main>
