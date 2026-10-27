<script>
  export let data;
  import { onMount } from 'svelte';
  import Icon from '#lib/Icon.svelte';
  import { invalidateAll } from '$app/navigation';
  import FollowingXAuthors from '#lib/FollowingXAuthors.svelte';
  import BuddiesPanel from '#lib/BuddiesPanel.svelte';
  import MediaDock from '#lib/MediaDock.svelte';
  import PostCard from '#lib/PostCard.svelte';
  import { loginHref } from '#lib/auth-session.mjs';
  let mounted = false;
  let railFilter = '';
  function applyContentFilters(params, targetFeed = data.feed) { if (targetFeed === 'rated') { params.set('ratings', data.ratings || 'rx'); return params; } if (['following', 'buddies'].includes(targetFeed) && ['following', 'buddies'].includes(data.feed) && data.ratings) { params.set('ratings', data.ratings); return params; } if (data.feed === 'rated' || data.ratings) return params; params.set('hide_r', String(data.hideR)); if (!data.hideX) params.set('show_x', 'true'); return params; }
  function feedHref(feed, includeFilters = true) { const params = new URLSearchParams({feed,sort:data.sort}); if (data.community) params.set('community',data.community); if (data.q) params.set('q',data.q); return '/' + (includeFilters ? '?' + applyContentFilters(params, feed) : '?' + params); }
  function clearRHref() { const params = new URLSearchParams({feed:data.feed,sort:data.sort,hide_r:'false'}); if (data.community) params.set('community',data.community); if (data.q) params.set('q',data.q); if (!data.hideX) params.set('show_x', 'true'); return '/?' + params; }
  function communityHref(slug = '') { const params = new URLSearchParams({feed:data.feed,sort:data.sort}); if (slug) params.set('community', slug); if (data.q) params.set('q',data.q); return '/?' + applyContentFilters(params); }
  $: activeCommunities = data.communities.filter(community => community.post_count > 0 || community.slug === data.community).sort((a, b) => b.post_count - a.post_count || a.slug.localeCompare(b.slug));
  $: quietCommunities = data.communities.filter(community => community.post_count === 0 && community.slug !== data.community);
  let token = '';
  let feedPosts = data.posts, feedHasMore = data.hasMore, feedPage = data.page, feedLoading = false, feedError = '';
  let feedKey = '', activeFeedKey = '', feedRequestController, followingInitialKey = '', initialPosts = data.posts;
  $: feedKey = JSON.stringify([data.feed, data.community, data.q, data.sort, data.hideR, data.hideX, data.ratings, data.page]);
  $: if (feedKey !== activeFeedKey) {
    activeFeedKey = feedKey;
    feedRequestController?.abort();
    feedRequestController = null;
    feedLoading = false;
    feedError = '';
    feedPage = data.page;
    feedHasMore = ['following', 'buddies'].includes(data.feed) ? false : data.hasMore;
    feedPosts = ['following', 'buddies'].includes(data.feed) ? [] : data.posts;
    initialPosts = data.posts;
    followingInitialKey = '';
    if (['following', 'buddies'].includes(data.feed) && !token) feedError = 'Sign in to see your followed feeds.';
  }
  $: if (feedKey === activeFeedKey && !['following', 'buddies'].includes(data.feed) && data.posts !== initialPosts) {
    const freshPosts = data.posts || [];
    const freshIds = new Set(freshPosts.map(post => post.id));
    feedPosts = [...freshPosts, ...feedPosts.filter(post => !freshIds.has(post.id))];
    initialPosts = data.posts;
    if (feedPage === data.page) feedHasMore = data.hasMore;
  }
  onMount(() => {
    token = localStorage.getItem('swartzit_session') ?? '';
    mounted = true;
    const timer = setInterval(() => { if (!document.hidden) invalidateAll(); }, 300000);
    return () => clearInterval(timer);
  });
  function dismissable(node) {
    const close = event => { if (node.open && !node.contains(event.target)) node.open = false; };
    document.addEventListener('pointerdown', close);
    return { destroy: () => document.removeEventListener('pointerdown', close) };
  }
  $: matureLabel = !data.hideR && !data.hideX ? 'R + X shown' : !data.hideR ? 'R shown' : !data.hideX ? 'X shown' : 'Mature hidden';
  const submitForm = event => event.currentTarget.form?.requestSubmit();
  const feedTitle = { timeline: 'Timeline', following: 'Following', buddies: 'Buddies', rated: 'Rated posts' };
  $: showWelcome = mounted && !token && data.feed === 'timeline' && !data.q && !data.community && data.page === 1;
  $: railCommunities = activeCommunities.filter(c => !railFilter || c.slug.includes(railFilter.toLowerCase()));
  async function loadFeedPage(page, append = true) {
    if (feedLoading || (append && !feedHasMore)) return;
    if (['following', 'buddies'].includes(data.feed) && !token) {
      feedError = 'Sign in to see your followed feeds.';
      return;
    }
    const requestKey = activeFeedKey;
    const controller = new AbortController();
    feedRequestController = controller;
    feedLoading = true;
    feedError = '';
    const params = new URLSearchParams({sort:data.sort,page:String(page)});
    if (data.q) params.set('q',data.q);
    if (data.community) params.set('community',data.community);
    if (data.ratings) params.set('ratings', data.ratings);
    else {
      params.set('hide_r', String(data.hideR));
      params.set('hide_x', data.hideX ? 'true' : 'false');
    }
    try {
      const following = data.feed === 'following';
      const buddies = data.feed === 'buddies';
      const response = await fetch((following ? '/api/home?' : buddies ? '/api/buddies/feed?' : '/api/posts?') + params, {
        headers: following || buddies ? {authorization:'Bearer ' + token} : {},
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load more discussions.');
      if (requestKey !== activeFeedKey) return;
      const posts = Array.isArray(result.posts) ? result.posts : [];
      if (append) {
        const knownIds = new Set(feedPosts.map(post => post.id));
        feedPosts = [...feedPosts, ...posts.filter(post => !knownIds.has(post.id))];
      } else {
        feedPosts = posts;
      }
      feedPage = page;
      feedHasMore = Boolean(result.has_more);
    } catch (error) {
      if (error.name !== 'AbortError' && requestKey === activeFeedKey) feedError = error.message || 'Could not reach Swartzit.';
    } finally {
      if (feedRequestController === controller) {
        feedRequestController = null;
        feedLoading = false;
      }
    }
  }
  $: if (feedKey === activeFeedKey && ['following', 'buddies'].includes(data.feed) && token && followingInitialKey !== activeFeedKey) {
    followingInitialKey = activeFeedKey;
    loadFeedPage(data.page, false);
  }
  function loadNextPage() {
    if (!feedLoading && feedHasMore) loadFeedPage(feedPage + 1, true);
  }
  function observeFeedEnd(node) {
    if (typeof IntersectionObserver === 'undefined') return {};
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) loadNextPage();
    }, {rootMargin:'850px 0px'});
    observer.observe(node);
    return {destroy: () => observer.disconnect()};
  }
</script>
<svelte:head><title>{data.community ? `c/${data.community} · Swartzit` : data.q ? `“${data.q}” · Swartzit` : 'Swartzit — the commons'}</title></svelte:head>
<main id="main-content" class="home">
  <div class="layout">
    <aside class="rail" aria-label="Communities">
      <div class="rail-head"><h2>Communities</h2><a href="/communities" aria-label="Browse all communities" title="Browse all communities"><Icon name="grid" size={17} /></a></div>
      <a class="rail-link" class:selected={!data.community} aria-current={!data.community ? 'page' : undefined} href={communityHref()}><span>All discussions</span></a>
      {#each activeCommunities as community}
        <a class="rail-link" class:selected={data.community === community.slug} aria-current={data.community === community.slug ? 'page' : undefined} href={communityHref(community.slug)}><span>c/{community.slug}</span><small>{community.post_count}</small></a>
      {/each}
      {#if quietCommunities.length}
        <details class="quiet" open={quietCommunities.some(community => community.slug === data.community)}>
          <summary>{quietCommunities.length} with no posts yet</summary>
          {#each quietCommunities as community}<a class="rail-link" class:selected={data.community === community.slug} aria-current={data.community === community.slug ? 'page' : undefined} href={communityHref(community.slug)}><span>c/{community.slug}</span></a>{/each}
        </details>
      {/if}
    </aside>

    <section class="feed">
      <nav class="feed-tabs" aria-label="Feed">
        <a class:active={data.feed === 'timeline'} aria-current={data.feed === 'timeline' ? 'page' : undefined} href={feedHref('timeline')}>Timeline</a>
        <a class:active={data.feed === 'following'} aria-current={data.feed === 'following' ? 'page' : undefined} href={feedHref('following')}>Following</a>
        <a class:active={data.feed === 'buddies'} aria-current={data.feed === 'buddies' ? 'page' : undefined} href={feedHref('buddies')}>Buddies</a>
        <a class:active={data.feed === 'rated'} aria-current={data.feed === 'rated' ? 'page' : undefined} href={feedHref('rated')}>Rated</a>
      </nav>

      <div class="chip-row" aria-label="Communities">
        <a class="chip" class:active={!data.community} href={communityHref()}>All</a>
        {#each activeCommunities.slice(0, 14) as community}<a class="chip" class:active={data.community === community.slug} href={communityHref(community.slug)}>c/{community.slug}</a>{/each}
        <a class="chip" href="/communities">More →</a>
      </div>

      {#if showWelcome}
        <section class="welcome" aria-label="About Swartzit">
          <div><p class="eyebrow">Open discussion network</p><h2>Read freely. Participate under a pseudonym. Take your community with you.</h2></div>
          <div class="welcome-actions"><a class="btn" href="/signup">Create account</a><a class="btn btn-secondary" href="/about">How it works</a></div>
        </section>
      {/if}

      {#if data.feed === 'following'}<FollowingXAuthors />{/if}
      {#if data.feed === 'buddies' && token}<BuddiesPanel />{/if}

      <div class="feed-head">
        <div class="title-block">
          {#if data.community}<a class="back-all" href={communityHref()}><Icon name="arrow-left" size={15} />All communities</a>{/if}
          <h1>{data.community ? `c/${data.community}` : data.q ? `Results for “${data.q}”` : feedTitle[data.feed]}</h1>
          {#if data.q}<a class="clear-search" href={communityHref(data.community)}>Clear search</a>{/if}
        </div>
        <form class="controls" method="GET" action="/">
          {#if data.community}<input type="hidden" name="community" value={data.community} />{/if}
          <input type="hidden" name="feed" value={data.feed} />
          {#if data.q}<input type="hidden" name="q" value={data.q} />{/if}
          {#if data.ratings}
            <label class="ctl"><span>Show</span><select name="ratings" aria-label="Choose ratings to show" value={data.ratings} onchange={submitForm}><option value="rx">R and X</option><option value="r">R only</option><option value="x">X only</option></select></label>
          {:else}
            <details class="menu filter" use:dismissable>
              <summary class="ctl-button"><Icon name="sliders" size={16} /><span>{matureLabel}</span></summary>
              <div class="menu-panel">
                <label class="check"><input type="checkbox" name="show_r" value="true" checked={!data.hideR} onchange={submitForm} /><span class="content-rating content-rating-r" aria-hidden="true">R</span>Show R-rated</label>
                <label class="check"><input type="checkbox" name="show_x" value="true" checked={!data.hideX} onchange={submitForm} /><span class="content-rating content-rating-x" aria-hidden="true">X</span>Show X-rated</label>
              </div>
            </details>
          {/if}
          {#if data.feed !== 'buddies'}
            <label class="ctl"><span>Sort</span><select name="sort" aria-label="Sort discussions" value={data.sort} onchange={submitForm}><option value="newest">Newest</option><option value="score">Most upvoted</option><option value="comments">Most discussed</option><option value="views">Most viewed</option></select></label>
          {/if}
          <noscript><button type="submit" class="btn-sm">Apply</button></noscript>
        </form>
      </div>

      {#if ['following', 'buddies'].includes(data.feed) && !token}
        <div class="state"><h2>Sign in to see your {data.feed === 'buddies' ? 'buddies' : 'followed feed'}</h2><p>Sign in to see your followed feeds.</p><a class="btn" href={loginHref(feedHref(data.feed))}>Sign in</a></div>
      {:else if feedPosts.length === 0 && feedLoading}
        <div class="skeletons" role="status" aria-label="Loading discussions">{#each [1, 2, 3] as n (n)}<div class="skeleton"><i></i><i></i><i></i></div>{/each}</div>
      {:else if feedPosts.length === 0 && feedError}
        <div class="state" role="alert"><h2>Couldn’t load this feed</h2><p>{feedError}</p>{#if ['following', 'buddies'].includes(data.feed) && token}<button type="button" onclick={() => loadFeedPage(data.page, false)}>Retry</button>{/if}</div>
      {:else if feedPosts.length === 0}
        <div class="state"><h2>Nothing here yet</h2><p>{data.feed === 'buddies' ? 'Pin a buddy above to see the posts they upvote here.' : data.ratings ? `No ${data.ratings === 'r' ? 'R-rated' : data.ratings === 'x' ? 'X-rated' : 'R- or X-rated'} posts found${data.feed === 'following' ? ' in your Following feed' : ''}.` : data.feed === 'following' ? 'Follow a person on X or a community to fill your Following feed.' : data.q ? 'No discussions match that search. Try different words.' : 'No discussions found.'}</p>{#if data.feed === 'following'}<a class="btn btn-secondary" href="/communities">Browse communities</a>{/if}</div>
      {:else}
        {#each feedPosts as post (post.id)}<PostCard {post} feed={data.feed} />{/each}
      {/if}

      {#if feedPosts.length > 0 && feedHasMore}
        <div class="pagination">
          <div class="sentinel" use:observeFeedEnd aria-hidden="true"></div>
          {#if feedLoading}<p role="status">Loading more discussions…</p>{/if}
          {#if feedError}<p role="alert" class="form-error">{feedError}</p><button type="button" onclick={loadNextPage}>Retry loading</button>{:else}<button type="button" class="secondary" disabled={feedLoading} onclick={loadNextPage}>Load more discussions</button>{/if}
        </div>
      {/if}
    </section>
  </div>
</main>
<MediaDock />
<style>
  .home { padding-top: 24px; }
  .layout { display: grid; grid-template-columns: 220px minmax(0, var(--feed)); justify-content: center; gap: 40px; }
  .rail { position: sticky; top: calc(var(--header-h) + 20px); align-self: start; max-height: calc(100vh - var(--header-h) - 40px); overflow-y: auto; scrollbar-width: thin; padding-right: 4px; }
  .rail-head { display: flex; align-items: center; justify-content: space-between; padding: 0 10px; margin-bottom: 6px; }
  .rail-head h2 { margin: 0; font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
  .rail-head a { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; color: var(--muted); }
  .rail-head a:hover { background: var(--hover); color: var(--heading); }
  .rail-link { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: var(--radius-sm); color: var(--muted); font-size: .9rem; font-weight: 500; }
  .rail-link small { font-size: .72rem; font-variant-numeric: tabular-nums; color: var(--text-light); }
  .rail-link:hover { background: var(--hover); color: var(--heading); }
  .rail-link.selected { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .quiet { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border); }
  .quiet > summary { cursor: pointer; padding: 8px 10px; color: var(--text-light); font-size: .78rem; font-weight: 600; }

  .feed { min-width: 0; }
  .feed-tabs { display: flex; gap: 4px; margin: 0 0 14px; padding: 4px; border-radius: 999px; background: var(--surface2); border: 1px solid var(--border); }
  .feed-tabs a { flex: 1; text-align: center; padding: 8px 10px; border-radius: 999px; font-size: .875rem; font-weight: 600; color: var(--muted); }
  .feed-tabs a:hover { color: var(--heading); }
  .feed-tabs a.active { background: var(--surface); color: var(--heading); box-shadow: var(--shadow-sm); }
  .chip-row { display: none; }

  .welcome { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 16px; padding: 22px 24px; border-radius: var(--radius); background: var(--wash); border: 1px solid var(--border); }
  .welcome h2 { margin: 0; max-width: 34ch; font: 600 1.35rem/1.3 var(--font-serif); }
  .welcome .eyebrow { margin-bottom: 6px; }
  .welcome-actions { display: flex; gap: 8px; flex-wrap: wrap; }

  .feed-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 6px 2px 14px; }
  .title-block { min-width: 0; }
  .feed-head h1 { margin: 0; font: 650 1.5rem/1.2 var(--font-sans); letter-spacing: -.02em; overflow-wrap: anywhere; }
  .back-all, .clear-search { display: inline-flex; align-items: center; gap: 5px; margin-right: 10px; font-size: .78rem; font-weight: 600; color: var(--muted); }
  .back-all:hover, .clear-search:hover { color: var(--heading); text-decoration: underline; }
  .controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ctl { display: inline-flex; align-items: center; gap: 6px; font-size: .8rem; font-weight: 600; color: var(--muted); }
  .ctl select { width: auto; min-height: 34px; padding: 4px 8px; border-radius: 999px; font-size: .8rem; font-weight: 600; }
  .ctl-button { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); font-size: .8rem; font-weight: 600; color: var(--muted); }
  .ctl-button:hover, .filter[open] .ctl-button { background: var(--hover); color: var(--heading); }
  .filter .menu-panel { right: 0; left: auto; min-width: 200px; padding: 10px; display: grid; gap: 4px; }
  .check { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: var(--radius-sm); cursor: pointer; font-weight: 500; }
  .check:hover { background: var(--hover); }

  .state { display: grid; justify-items: start; gap: 6px; padding: 32px 24px; border: 1px dashed var(--border-strong); border-radius: var(--radius); background: var(--surface); }
  .state h2 { margin: 0; font-size: 1.1rem; }
  .state p { margin: 0 0 8px; color: var(--muted); max-width: 52ch; }
  .skeletons { display: grid; gap: 14px; }
  .skeleton { display: grid; gap: 10px; padding: 20px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .skeleton i { display: block; height: 14px; border-radius: 6px; background: linear-gradient(90deg, var(--subtle), var(--hover), var(--subtle)); background-size: 200% 100%; animation: shimmer 1.4s infinite linear; }
  .skeleton i:nth-child(1) { width: 35%; } .skeleton i:nth-child(2) { width: 85%; height: 20px; } .skeleton i:nth-child(3) { width: 60%; }
  @keyframes shimmer { to { background-position: -200% 0; } }

  .pagination { display: grid; justify-items: center; gap: 10px; padding: 20px 0 36px; }
  .pagination p { margin: 0; color: var(--muted); font-size: .85rem; }
  .sentinel { width: 100%; height: 1px; pointer-events: none; }

  @media (max-width: 960px) {
    .layout { display: block; }
    .rail { display: none; }
    .chip-row { display: flex; gap: 8px; overflow-x: auto; margin: 0 0 14px; padding-bottom: 4px; scrollbar-width: none; }
    .chip-row::-webkit-scrollbar { display: none; }
    .chip { flex: none; }
  }
  @media (max-width: 700px) {
    .home { padding: 12px 0 120px; }
    .feed-tabs, .chip-row, .welcome, .feed-head, .state { margin-left: 12px; margin-right: 12px; }
    .feed-tabs { margin-bottom: 12px; }
    .pagination { padding: 20px 12px 36px; }
    .skeletons { padding: 0 12px; }
    .welcome { padding: 18px; }
  }
</style>
