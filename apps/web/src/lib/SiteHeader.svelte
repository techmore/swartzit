<script>
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { afterNavigate } from '$app/navigation';
  import Icon from '#lib/Icon.svelte';
  import Brand from '#lib/Brand.svelte';
  import ThemeToggle from '#lib/ThemeToggle.svelte';
  import AutoplayToggle from '#lib/AutoplayToggle.svelte';
  import { currentUser, loadCurrentUser } from '#lib/session-store.js';
  import { loginHref } from '#lib/auth-session.mjs';

  const user = $derived($currentUser || null);
  const path = $derived(page.url.pathname);
  const query = $derived(page.url.searchParams.get('q') ?? '');
  const signInHref = $derived(loginHref(path + page.url.search));
  const isHome = $derived(path === '/' && !page.url.searchParams.get('feed'));

  let avatarUrl = $state('');
  let menuOpen = $state(false);
  let searchOpen = $state(false);
  let searchInput = $state();
  let menuRoot = $state();

  $effect(() => { avatarUrl = user?.avatar_url ?? ''; });

  onMount(() => {
    loadCurrentUser();
    const onProfile = event => { avatarUrl = event.detail?.avatar_url ?? ''; };
    const onPointer = event => { if (menuOpen && menuRoot && !menuRoot.contains(event.target)) menuOpen = false; };
    const onKey = event => { if (event.key === 'Escape') { menuOpen = false; searchOpen = false; } };
    window.addEventListener('swartzit:profile-updated', onProfile);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('swartzit:profile-updated', onProfile);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  });
  afterNavigate(() => { menuOpen = false; searchOpen = false; });

  async function toggleSearch() {
    searchOpen = !searchOpen;
    if (searchOpen) { await tick(); searchInput?.focus(); }
  }
  function compose(mode = 'post') {
    window.dispatchEvent(new CustomEvent('swartzit:compose', { detail: { mode } }));
  }
</script>

<header class="site-header">
  <div class="bar">
    <Brand />

    <nav class="primary" aria-label="Primary">
      <a href="/" class:active={isHome} aria-current={isHome ? 'page' : undefined}>Timeline</a>
      <a href="/communities" class:active={path.startsWith('/communities')} aria-current={path.startsWith('/communities') ? 'page' : undefined}>Communities</a>
      {#if user}<a href="/bookmarks" class:active={path.startsWith('/bookmarks')} aria-current={path.startsWith('/bookmarks') ? 'page' : undefined}>Bookmarks</a>{/if}
    </nav>

    <form class="search desktop-search" method="GET" action="/" role="search">
      <Icon name="search" size={18} />
      <input name="q" value={query} maxlength="200" placeholder="Search discussions" aria-label="Search discussions" />
    </form>

    <div class="actions">
      <button type="button" class="icon-btn mobile-only" aria-label={searchOpen ? 'Close search' : 'Search discussions'} aria-expanded={searchOpen} onclick={toggleSearch}><Icon name={searchOpen ? 'x' : 'search'} size={20} /></button>
      <ThemeToggle />
      {#if user}
        <button type="button" class="btn new-post" onclick={() => compose('post')}><Icon name="plus" size={18} /><span>New post</span></button>
      {:else}
        <a class="btn btn-secondary btn-sm signin" href={signInHref}>Sign in</a>
        <a class="btn btn-sm join" href="/signup">Join</a>
      {/if}

      <div class="menu" bind:this={menuRoot}>
        <button type="button" class="account" class:has-avatar={Boolean(user)} aria-label={user ? `Account menu for u/${user.handle}` : 'Menu'} aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => menuOpen = !menuOpen}>
          {#if user && avatarUrl}<img src={avatarUrl} alt="" />
          {:else if user}<span class="initial">{user.handle.slice(0, 1).toUpperCase()}</span>
          {:else}<Icon name="menu" size={20} />{/if}
        </button>
        {#if menuOpen}
          <div class="menu-panel" role="menu">
            {#if user}
              <a class="menu-item who" role="menuitem" href={'/u/' + encodeURIComponent(user.handle)}><Icon name="user" size={18} /><span><strong>u/{user.handle}</strong><small>View profile</small></span></a>
              <a class="menu-item" role="menuitem" href="/bookmarks"><Icon name="bookmark" size={18} />Bookmarks</a>
              <a class="menu-item" role="menuitem" href="/?feed=buddies"><Icon name="users" size={18} />Buddies</a>
              <a class="menu-item" role="menuitem" href="/history"><Icon name="clock" size={18} />Reading history</a>
              {#if user.is_admin}
                <hr class="menu-divider" />
                <a class="menu-item" role="menuitem" href="/admin"><Icon name="admin" size={18} />Admin</a>
                <a class="menu-item" role="menuitem" href="/admin/rating-review"><Icon name="check" size={18} />Rating review</a>
              {/if}
            {:else}
              <a class="menu-item" role="menuitem" href="/history"><Icon name="clock" size={18} />Reading history</a>
            {/if}
            <hr class="menu-divider" />
            <AutoplayToggle />
            <a class="menu-item" role="menuitem" href="/api/export" download="swartzit-export.json"><Icon name="download" size={18} />Export public data</a>
            <a class="menu-item" role="menuitem" href="/about"><Icon name="info" size={18} />About Swartzit</a>
            <a class="menu-item" role="menuitem" href="https://github.com/techmore/swartzit" target="_blank" rel="noopener noreferrer"><Icon name="external" size={18} />Source on GitHub</a>
            <hr class="menu-divider" />
            {#if user}
              <a class="menu-item" role="menuitem" href="/logout"><Icon name="logout" size={18} />Sign out</a>
            {:else}
              <a class="menu-item" role="menuitem" href={signInHref}><Icon name="login" size={18} />Sign in</a>
              <a class="menu-item" role="menuitem" href="/signup"><Icon name="user" size={18} />Create account</a>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if searchOpen}
    <form class="search mobile-search" method="GET" action="/" role="search">
      <Icon name="search" size={18} />
      <input bind:this={searchInput} name="q" value={query} maxlength="200" placeholder="Search discussions" aria-label="Search discussions" />
      <button type="submit" class="btn-sm">Search</button>
    </form>
  {/if}
</header>

<style>
  .site-header { position: sticky; top: 0; z-index: 50; background: color-mix(in srgb, var(--page) 88%, transparent); backdrop-filter: saturate(1.4) blur(14px); border-bottom: 1px solid var(--border); }
  .bar { height: var(--header-h); max-width: var(--content); margin: 0 auto; padding: 0 24px; display: flex; align-items: center; gap: 20px; }
  .primary { display: flex; align-items: center; gap: 2px; }
  .primary a { padding: 8px 12px; border-radius: 999px; font-size: .9rem; font-weight: 600; color: var(--muted); }
  .primary a:hover { background: var(--hover); color: var(--heading); }
  .primary a.active { color: var(--heading); background: var(--subtle); }
  .search { position: relative; display: flex; align-items: center; }
  .search :global(svg) { position: absolute; left: 12px; color: var(--text-light); pointer-events: none; }
  .search input { padding-left: 38px; border-radius: 999px; background: var(--surface2); border-color: transparent; }
  .search input:focus-visible { background: var(--surface); }
  .desktop-search { flex: 1; max-width: 360px; margin-left: auto; }
  .actions { display: flex; align-items: center; gap: 6px; flex: none; }
  .new-post { margin-left: 4px; }
  .account { display: grid; place-items: center; width: 38px; min-height: 38px; padding: 0; border-radius: 50%; background: transparent; color: var(--muted); overflow: hidden; border: 1px solid var(--border-strong); }
  .account.has-avatar { border-color: transparent; }
  .account:hover:not(:disabled) { filter: none; background: var(--hover); }
  .account img { width: 100%; height: 100%; object-fit: cover; }
  .initial { width: 38px; height: 38px; display: grid; place-items: center; background: var(--accent); color: var(--accent-fg); font-weight: 700; font-size: .9rem; }
  .menu-panel { min-width: 250px; }
  .who span { display: grid; line-height: 1.25; }
  .who small { font-size: .75rem; }
  .mobile-only, .mobile-search { display: none; }

  @media (max-width: 900px) {
    .primary { display: none; }
    .desktop-search { display: none; }
    .mobile-only { display: inline-flex; }
    .actions { margin-left: auto; }
    .new-post span { display: none; }
    .new-post { width: 38px; padding: 0; }
    .mobile-search { display: flex; gap: 8px; max-width: var(--content); margin: 0 auto; padding: 0 24px 10px; }
    .mobile-search input { flex: 1; }
    .mobile-search button { flex: none; }
  }
  @media (max-width: 700px) {
    .bar { padding: 0 12px; gap: 8px; }
    .new-post { display: none; }
    .signin { display: none; }
    .mobile-search { padding: 0 12px 10px; }
  }
</style>
