<script>
  import { page } from '$app/state';
  import Icon from '#lib/Icon.svelte';
  import { currentUser } from '#lib/session-store.js';
  import { loginHref } from '#lib/auth-session.mjs';
  const pathname = $derived(page.url.pathname);
  const user = $derived($currentUser || null);
  const feed = $derived(page.url.searchParams.get('feed'));
  const accountHref = $derived(user ? `/u/${encodeURIComponent(user.handle)}` : '/login');
  const accountActive = $derived(user ? pathname === `/u/${user.handle}` : ['/login', '/signup'].includes(pathname));
  const homeActive = $derived(pathname === '/' && feed !== 'following');
  const savedHref = $derived(user ? '/bookmarks' : loginHref('/bookmarks'));
  function compose() {
    if (!user) { location.assign(loginHref(pathname + page.url.search)); return; }
    window.dispatchEvent(new CustomEvent('swartzit:compose', { detail: { mode: 'post' } }));
  }
</script>
<nav class="bottom-nav" aria-label="Mobile navigation">
  <a href="/" class:active={homeActive} aria-current={homeActive ? 'page' : undefined}><Icon name="home" size={22} /><small>Home</small></a>
  <a href="/communities" class:active={pathname.startsWith('/communities')} aria-current={pathname.startsWith('/communities') ? 'page' : undefined}><Icon name="grid" size={22} /><small>Communities</small></a>
  <button type="button" class="compose" aria-label={user ? 'Create a post' : 'Sign in to post'} onclick={compose}><Icon name="plus" size={26} /></button>
  <a href={savedHref} class:active={pathname.startsWith('/bookmarks')} aria-current={pathname.startsWith('/bookmarks') ? 'page' : undefined}><Icon name="bookmark" size={22} /><small>Bookmarks</small></a>
  <a href={accountHref} class:active={accountActive} aria-current={accountActive ? 'page' : undefined}><Icon name="user" size={22} /><small>{user ? 'Profile' : 'Sign in'}</small></a>
</nav>
<style>
  .bottom-nav { display: none; }
  @media (max-width: 700px) {
    .bottom-nav {
      position: fixed; z-index: 40; inset: auto 0 0 0;
      display: grid; grid-template-columns: repeat(5, 1fr); align-items: center;
      padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
      border-top: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: saturate(1.4) blur(16px);
    }
    a { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 48px; border-radius: 12px; color: var(--muted); }
    a small { font-size: .66rem; font-weight: 600; }
    a.active { color: var(--accent); }
    .compose { justify-self: center; width: 52px; height: 52px; min-height: 52px; padding: 0; border-radius: 50%; box-shadow: var(--shadow); transform: translateY(-8px); }
  }
</style>
