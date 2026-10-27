<script>
  import { onMount } from 'svelte';
  export let form;
  import { safeNextPath } from '#lib/auth-session.mjs';
  let password = '', visible = false, generated = false, next = '/';
  onMount(() => { next = safeNextPath(location.search); });
  function generate() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    password = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => alphabet[b & 63]).join('');
    visible = true; generated = true;
  }
</script>
<svelte:head><title>Create account — Swartzit</title></svelte:head>
<main id="main-content" class="auth">
  <p class="eyebrow">Participate under a pseudonym</p><h1>Create your account</h1>
  <p class="lede">Choose a handle for your conversations. No real name or external identity provider is required.</p>
  <form method="POST" action="/signup" autocomplete="on">
    {#if next !== '/'}<input type="hidden" name="next" value={next} />{/if}
    <div class="field"><label for="signup-username">Handle</label>
    <input id="signup-username" name="username" value={form?.handle ?? ''} autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_]+" aria-describedby="handle-help" aria-invalid={form?.error ? 'true' : undefined} />
    <small id="handle-help">3–32 letters, numbers, or underscores. Handles are saved in lowercase and shown as u/your_handle.</small></div>
    <div class="field"><label for="signup-password">Password</label>
    <input id="signup-password" name="password" type={visible ? 'text' : 'password'} bind:value={password} autocomplete="new-password" required minlength="12" maxlength="256" aria-describedby="password-help" />
    <small id="password-help">Use at least 12 characters. Your password manager may suggest and save a password.</small>
    <div class="password-tools"><button type="button" onclick={generate}>Suggest a strong password</button><button type="button" onclick={() => visible = !visible}>{visible ? 'Hide' : 'Show'} password</button></div></div>
    {#if generated}<p class="form-message" role="status">Generated on your device. Save this password in your password manager before continuing.</p>{/if}
    {#if form?.error}<p class="form-error" role="alert">{form.error}</p>{/if}
    <button type="submit" class="btn-block">Create account</button>
  </form>
  <p class="switch">Already have an account? <a href="/login">Sign in</a>.</p>
</main>
