<script>
  import { onMount } from 'svelte';
  import Brand from '#lib/Brand.svelte';
  import { safeNextPath, signIn, storeSessionToken } from '#lib/auth-session.mjs';
  let handle = '', password = '', message = '', error = '', busy = false, next = '/', visible = false;
  onMount(() => {
    next = safeNextPath(location.search);
    if (new URLSearchParams(location.search).has('created')) message = 'Account created. Sign in with your new password.';
  });
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    error = ''; message = ''; busy = true;
    try {
      const result = await signIn({ handle, password });
      if (!result.ok) { error = result.error; return; }
      if (!storeSessionToken(result.token)) {
        error = 'Signed in, but this browser blocks site storage, so the session could not be kept. Allow storage for this site and try again.';
        return;
      }
      window.location.assign(next);
    } finally { busy = false; }
  }
</script>
<svelte:head><title>Sign in — Swartzit</title></svelte:head>
<header><Brand /><span>Read freely. Participate under a pseudonym. Take your community with you.</span><a class="login" href={next === '/' ? '/signup' : `/signup?next=${encodeURIComponent(next)}`}>Create account</a></header>
<main id="main-content" class="auth">
  <p class="eyebrow">WELCOME BACK</p><h1>Sign in</h1>
  <p class="lede">Your public reading never depended on an account. Sign in when you’re ready to participate.</p>
  <form onsubmit={submit} aria-busy={busy} aria-describedby={error ? 'login-error' : undefined}>
    <label>Handle<input id="login-username" name="username" bind:value={handle} autocomplete="username" autocapitalize="none" spellcheck="false" required disabled={busy} /></label>
    <label>Password<input id="login-password" name="password" type={visible ? 'text' : 'password'} bind:value={password} autocomplete="current-password" required disabled={busy} /></label>
    <button type="button" class="link-button" aria-pressed={visible} onclick={() => visible = !visible}>{visible ? 'Hide' : 'Show'} password</button>
    <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form>
  {#if error}<p id="login-error" class="form-error" role="alert">{error}</p>{/if}
  {#if message}<p class="form-message" role="status">{message}</p>{/if}
  <p class="switch">New here? <a href={next === '/' ? '/signup' : `/signup?next=${encodeURIComponent(next)}`}>Create an account</a>.</p>
</main>
