<script>
  import { onMount } from 'svelte';
  import Icon from '#lib/Icon.svelte';
  import ThemeToggle from '#lib/ThemeToggle.svelte';
  import AutoplayToggle from '#lib/AutoplayToggle.svelte';
  import { loadCurrentUser } from '#lib/session-store.js';
  import { loginHref } from '#lib/auth-session.mjs';
  export let compact = true;
  let handle = '', avatarUrl = '', isAdmin = false, signInHref = '/login';
  const profileUpdated = event => { avatarUrl = event.detail?.avatar_url ?? ''; };
  onMount(() => {
    signInHref = loginHref(location.pathname + location.search);
    window.addEventListener('swartzit:profile-updated', profileUpdated);
    return () => window.removeEventListener('swartzit:profile-updated', profileUpdated);
  });
  onMount(async () => {
    // Shared with the mobile bottom bar, so the account is fetched once per page.
    const user = await loadCurrentUser();
    if (user) { handle = user.handle; avatarUrl = user.avatar_url ?? ''; isAdmin = Boolean(user.is_admin); }
  });
</script>
<nav class:compact class="session-nav" aria-label="Account and navigation">
  {#if compact}
    <details class="compact-menu">
      <summary aria-label="More navigation" title="More navigation"><Icon name="menu" /></summary>
      <div class="compact-menu-panel">
        <div class="menu-preferences" aria-label="Display preferences"><span>Display</span><ThemeToggle compact /><AutoplayToggle compact /></div>
        {#if !handle}<a href="/signup"><Icon name="user" />Create account</a>{/if}
        <a href="/about"><Icon name="info" />About</a>
        <a href="/communities"><Icon name="grid" />Communities</a>
        <a href="/history"><Icon name="clock" />History</a>
        {#if handle}<a href="/?feed=buddies"><Icon name="user" />Buddies</a><a href="/bookmarks"><Icon name="bookmark" />Favorites</a>{/if}
        <a href="/api/export" download="swartzit-export.json"><Icon name="download" />Export data</a>
        {#if isAdmin}<a href="/admin"><Icon name="admin" />Admin</a>{/if}
      </div>
    </details>
    {#if handle}
      <a class="profile-link" href={'/u/' + handle} aria-label={'Profile for u/' + handle} title={'u/' + handle}>{#if avatarUrl}<img src={avatarUrl} alt="" />{:else}<Icon name="user" />{/if}</a>
      <a href="/logout" aria-label="Sign out" title="Sign out"><Icon name="login" /></a>
    {:else}
      <a href={signInHref} aria-label="Sign in" title="Sign in"><Icon name="login" /></a>
      <a href="/signup" class="compact-signup" aria-label="Create account" title="Create account">Join</a>
    {/if}
  {:else}
    <span class="preferences" aria-label="Display preferences"><ThemeToggle compact /><AutoplayToggle compact /></span>
    <a href="/about">About</a><a href="/communities">Communities</a><a href="/history">History</a>
    {#if handle}<a href="/?feed=buddies">Buddies</a><a href="/bookmarks">Favorites</a><a class="profile-link" href={'/u/' + handle}>{#if avatarUrl}<img src={avatarUrl} alt="" />{/if}u/{handle}</a>{#if isAdmin}<a href="/admin">Admin</a>{/if}<a href="/logout">Sign out</a>
    {:else}<a href={signInHref}>Sign in</a><a href="/signup">Create account</a>{/if}
  {/if}
</nav>
<style>
  .menu-preferences{display:flex;align-items:center;gap:6px;padding:5px 8px 10px;margin-bottom:4px;border-bottom:1px solid var(--border)}
  .menu-preferences>span{margin-right:auto;color:var(--muted);font-size:.8rem}
  @media(max-width:700px){.session-nav.compact .compact-signup{display:none}}
  .preferences{display:flex;align-items:center;gap:2px;margin-right:2px}
  .profile-link{display:inline-flex!important;align-items:center;gap:7px}.profile-link img{width:25px;height:25px;border-radius:50%;object-fit:cover}
  :global(.preferences button){color:var(--muted,#66766c)}
  .session-nav.compact{display:flex;align-items:center;gap:3px;margin-left:auto}
  .compact-menu{position:relative}
  .compact-menu>summary{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:9px;color:var(--muted,#66766c);cursor:pointer;list-style:none}
  .compact-menu>summary::-webkit-details-marker{display:none}
  .compact-menu>summary:hover,.compact-menu[open]>summary,.compact-menu>summary:focus-visible{background:var(--subtle,#e4e9df);color:var(--heading,#173d34)}
  .compact-menu-panel{position:absolute;right:0;top:calc(100% + 9px);z-index:25;display:grid;min-width:180px;padding:7px;border:1px solid var(--border,#c7ccc3);border-radius:11px;background:var(--surface,#fff);box-shadow:0 16px 35px #0003}
  .compact-menu-panel a{display:flex!important;align-items:center;justify-content:flex-start!important;width:auto!important;height:auto!important;gap:9px;padding:9px 10px;color:var(--muted,#66766c)!important;font-size:.8rem;text-align:left}
  .compact-menu-panel a:hover,.compact-menu-panel a:focus-visible{background:var(--subtle,#e4e9df);color:var(--heading,#173d34)!important}
  :global(.compact-menu-panel svg){width:16px;height:16px}
  .session-nav.compact a{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:9px;color:var(--muted,#66766c);font-size:.8rem}
  .session-nav.compact a:hover,.session-nav.compact a:focus-visible{background:var(--subtle,#e4e9df);color:var(--heading,#173d34)}
  :global(.session-nav.compact svg){width:18px;height:18px}
  .session-nav.compact .compact-signup{width:auto;padding:0 10px;color:var(--heading,#173d34);font-weight:750}
</style>
