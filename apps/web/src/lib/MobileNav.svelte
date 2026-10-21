<script>
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Icon from '#lib/Icon.svelte';
  import { currentUser, loadCurrentUser } from '#lib/session-store.js';
  const pathname = $derived(page.url.pathname);
  const user = $derived($currentUser || null);
  // Signed-in visitors land on their profile; everyone else on the sign-in page.
  const accountHref = $derived(user ? `/u/${encodeURIComponent(user.handle)}` : '/login');
  const accountLabel = $derived(user ? 'Profile' : 'Sign in');
  const accountActive = $derived(user ? pathname === `/u/${user.handle}` : ['/login', '/signup'].includes(pathname) || pathname.startsWith('/u/'));
  onMount(() => { loadCurrentUser(); });
</script>
<nav class="mobile-bottom-nav" aria-label="Mobile navigation">
  <a href="/" class:active={pathname === '/'} aria-current={pathname === '/' ? 'page' : undefined}><Icon name="home" size={22} /><small>Timeline</small></a>
  <a href="/communities" class:active={pathname === '/communities'} aria-current={pathname === '/communities' ? 'page' : undefined}><Icon name="grid" size={22} /><small>Communities</small></a>
  <a href={accountHref} class:active={accountActive} aria-current={accountActive ? 'page' : undefined}><Icon name="user" size={22} /><small>{accountLabel}</small></a>
</nav>
<style>
  .mobile-bottom-nav{display:none}
  @media(max-width:700px){.mobile-bottom-nav{position:fixed;z-index:30;right:0;bottom:0;left:0;height:calc(62px + env(safe-area-inset-bottom));display:flex;justify-content:space-around;align-items:flex-start;padding:6px 20px env(safe-area-inset-bottom);border-top:1px solid var(--border,#d8d5ca);background:color-mix(in srgb,var(--surface,#fff) 94%,transparent);backdrop-filter:blur(16px)}.mobile-bottom-nav a{display:flex;min-width:88px;min-height:48px;justify-content:center;flex-direction:column;align-items:center;gap:3px;color:var(--muted,#66766c);border-radius:10px}.mobile-bottom-nav a:hover,.mobile-bottom-nav a:focus-visible{color:var(--heading,#173d34)}.mobile-bottom-nav a.active{color:var(--heading);background:var(--subtle)}.mobile-bottom-nav small{font-size:.68rem;font-weight:700;letter-spacing:.02em}}
</style>
