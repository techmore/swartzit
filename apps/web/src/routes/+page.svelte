<script>
  export let data;
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import { invalidateAll } from '$app/navigation';
  import SessionNav from '$lib/SessionNav.svelte';
  import PostActions from '$lib/PostActions.svelte';
  import PostBody from '$lib/PostBody.svelte';
  import SourcePost from '$lib/SourcePost.svelte';
  import MediaDock from '$lib/MediaDock.svelte';
  import AuthorAvatar from '$lib/AuthorAvatar.svelte';
  import PostViews from '$lib/PostViews.svelte';
  import QuickCrossPost from '$lib/QuickCrossPost.svelte';
  import CommunityPicker from '$lib/CommunityPicker.svelte';
  import Brand from '$lib/Brand.svelte';
  let searchOpen = Boolean(data.q);
  let composeOpen = false;
  let searchInput;
  function applyContentFilters(params) { if (data.hideR) params.set('hide_r', 'true'); if (!data.hideX) params.set('show_x', 'true'); if (data.matureOnly) params.set('mature', 'true'); return params; }
  function pageLink(page) { return '/?' + applyContentFilters(new URLSearchParams({feed:data.feed,community:data.community,q:data.q,sort:data.sort,page:String(page)})); }
  function feedHref(feed, includeFilters = true) { const params = new URLSearchParams({feed,sort:data.sort}); if (data.community) params.set('community',data.community); if (data.q) params.set('q',data.q); return '/' + (includeFilters ? '?' + applyContentFilters(params) : '?' + params); }
  function clearRHref() { const params = new URLSearchParams({feed:data.feed,sort:data.sort}); if (data.community) params.set('community',data.community); if (data.q) params.set('q',data.q); if (!data.hideX) params.set('show_x', 'true'); if (data.matureOnly) params.set('mature', 'true'); return '/?' + params; }
  function communityHref(slug = '') { const params = new URLSearchParams(); if (slug) params.set('community', slug); if (data.hideR) params.set('hide_r', 'true'); if (!data.hideX) params.set('show_x', 'true'); if (data.matureOnly) params.set('mature', 'true'); return params.toString() ? '/?' + params : '/'; }
  const initialCommunity = data.communities.find(item => item.slug === data.community)?.slug || data.communities[0]?.slug || '';
  let token = '', title = '', body = '', contentRating = 'general', community = initialCommunity, formError = '', formMessage = '';
  let feedPosts = data.posts, feedHasMore = data.hasMore, feedLoading = false, feedError = '', followingRequestKey = '';
  const TIMELINE_LONG_POST_THRESHOLD = 900;
  const TIMELINE_EXCERPT_LIMIT = 420;
  const redundantSourceTitle = post => post?.source?.provider === 'x' && post.title?.trim() === post.body?.split(/\r?\n/, 1)[0]?.trim();
  const articleConfig = post => post?.source?.generation_config?.content_kind === 'article' ? post.source.generation_config : null;
  const timelineMedia = post => { const item = post?.source?.media?.[0]; return typeof item === 'string' ? item : item?.kind === 'image' ? item.src : item?.poster || ''; };
  const timelineLabel = post => { const config = articleConfig(post); return config ? `Article · Day ${config.unit_order || 1}${config.unit_count ? ` of ${config.unit_count}` : ''}` : 'Long post'; };
  const timelineExcerpt = body => { const text = String(body || '').replace(/^#{1,6}\s+/gm, '').replace(/[*_>`]/g, '').replace(/\s+/g, ' ').trim(); return text.length > TIMELINE_EXCERPT_LIMIT ? `${text.slice(0, TIMELINE_EXCERPT_LIMIT).trimEnd()}…` : text; };
  const isArticlePost = post => Boolean(articleConfig(post));
  const isLongPost = post => String(post?.body || '').trim().length > TIMELINE_LONG_POST_THRESHOLD;
  const isTimelinePreview = post => isArticlePost(post) || isLongPost(post);
  onMount(() => {
    token = localStorage.getItem('swartzit_session') ?? '';
    const timer = setInterval(() => { if (!document.hidden) invalidateAll(); }, 300000);
    return () => clearInterval(timer);
  });
  function toggleSearch() {
    searchOpen = !searchOpen;
    if (searchOpen) setTimeout(() => searchInput?.focus(), 0);
  }
  async function loadFollowing() {
    if (!token) return;
    const key = `${data.page}:${data.q}:${data.community}:${data.sort}:${data.hideR}:${data.hideX}:${data.matureOnly}`;
    if (followingRequestKey === key) return;
    followingRequestKey = key; feedLoading = true; feedError = '';
    const params = new URLSearchParams({sort:data.sort,page:String(data.page)});
    if (data.q) params.set('q',data.q);
    if (data.community) params.set('community',data.community);
    if (data.hideR) params.set('hide_r', 'true');
    params.set('hide_x', data.hideX ? 'true' : 'false');
    if (data.matureOnly) params.set('mature_only', 'true');
    try {
      const response = await fetch('/api/home?' + params,{headers:{authorization:'Bearer ' + token}});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load your following feed.');
      feedPosts = result.posts; feedHasMore = result.has_more;
    } catch (error) { feedError = error.message || 'Could not reach Swartzit.'; }
    finally { feedLoading = false; }
  }
  $: if (data.feed === 'following' && token && followingRequestKey !== `${data.page}:${data.q}:${data.community}:${data.sort}:${data.hideR}:${data.hideX}:${data.matureOnly}`) loadFollowing();
  $: if (data.feed === 'following') {
    if (token) loadFollowing();
    else { feedPosts = []; feedHasMore = false; feedError = 'Sign in to see posts from communities you follow.'; }
  } else { feedPosts = data.posts; feedHasMore = data.hasMore; feedError = ''; followingRequestKey = ''; }
  async function createPost() { formError = ''; formMessage = ''; const response = await fetch('/api/posts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ community, title, body, content_rating: contentRating }) }); const result = await response.json(); if (!response.ok) { formError = result.error ?? 'Could not submit discussion'; return; } if (result.status === 'pending') { formMessage = result.message ?? 'Your discussion is waiting for moderator review.'; title = ''; body = ''; contentRating = 'general'; return; } window.location.assign(`/post/${result.public_id}`); }
</script>

<svelte:head><title>Swartzit — the commons</title></svelte:head>
<header class="home-header">
  <div class="home-header-inner">
    <Brand />
    <span class="header-context">The community commons</span>
    <div class="header-actions">
      <button class="header-icon" type="button" aria-label={searchOpen ? 'Close search' : 'Search discussions'} title={searchOpen ? 'Close search' : 'Search discussions'} aria-expanded={searchOpen} onclick={toggleSearch}><Icon name={searchOpen ? 'x' : 'search'} /></button>
      <SessionNav compact />
    </div>
  </div>
  {#if searchOpen}
    <form class="global-search" method="GET" action="/" onsubmit={() => searchOpen = false}>
      <Icon name="search" size={19} />
      <input bind:this={searchInput} name="q" value={data.q} maxlength="200" placeholder="Search discussions" aria-label="Search discussions" />
      <input type="hidden" name="feed" value={data.feed} />
      <input type="hidden" name="sort" value={data.sort} />
      {#if data.hideR}<input type="hidden" name="hide_r" value="true" />{/if}
      {#if !data.hideX}<input type="hidden" name="show_x" value="true" />{/if}
      {#if data.community}<input type="hidden" name="community" value={data.community} />{/if}
      <button type="submit" aria-label="Run search" title="Run search"><Icon name="search" size={18} /></button>
    </form>
  {/if}
</header>
<main class="home">
<div class="layout">
  <aside class="community-nav">
    <div class="sidebar-heading"><h2>Communities</h2><a href="/communities" aria-label="Browse all communities" title="Browse all communities"><Icon name="grid" size={17} /></a></div>
    <a class="selected" href={communityHref()}>All discussions</a>
    {#each data.communities as community}<a href={communityHref(community.slug)}><strong>c/{community.slug}</strong><small>{community.post_count} posts</small></a>{/each}
  </aside>
  <section class="feed">
    <nav class="feed-tabs" aria-label="Feed"><a class:active={data.feed === 'timeline'} href={feedHref('timeline')}>Timeline</a><a class:active={data.feed === 'following'} href={feedHref('following')}>Following</a></nav>
    <details class="mobile-community-nav"><summary>Browse communities <span>{data.community ? `c/${data.community}` : 'All discussions'}</span></summary><div><a class="selected" href={communityHref()}>All discussions</a>{#each data.communities as community}<a href={communityHref(community.slug)}><strong>c/{community.slug}</strong><small>{community.post_count} posts</small></a>{/each}</div></details>
    <div class="feed-head">
      <div><p class="eyebrow">{data.community ? `c/${data.community}` : 'COMMUNITY TIMELINE'}</p><h1>{data.feed === 'following' ? 'Following' : 'Timeline'}</h1></div>
      <div class="feed-head-actions">
        {#if token}<button class="start-discussion-button" type="button" aria-label="Start a discussion" aria-expanded={composeOpen} aria-controls="compose-panel" onclick={() => composeOpen = true}><Icon name="plus" size={17} />Start discussion</button>{:else}<a class="post-cta" href="/login">Sign in to post</a>{/if}
        <details class="feed-options"><summary><Icon name="sliders" size={16} /><span>Sort</span></summary><form method="GET"><input type="hidden" name="community" value={data.community} /><input type="hidden" name="feed" value={data.feed} /><input type="hidden" name="q" value={data.q} />{#if data.hideR}<input type="hidden" name="hide_r" value="true" />{/if}{#if !data.hideX}<input type="hidden" name="show_x" value="true" />{/if}{#if data.matureOnly}<input type="hidden" name="mature" value="true" />{/if}<select name="sort" aria-label="Sort discussions" value={data.sort}><option value="newest">Newest</option><option value="score">Most upvoted</option><option value="comments">Most discussed</option><option value="views">Most viewed</option></select><button type="submit">Apply</button></form></details>
        <details class="feed-options content-filters"><summary><span>Content</span>{#if data.matureOnly}<span class="filter-count">Mature only</span>{:else if data.hideR}<span class="filter-count">R filtered</span>{:else if data.hideX}<span class="filter-count">X hidden</span>{/if}</summary><form method="GET"><input type="hidden" name="community" value={data.community} /><input type="hidden" name="feed" value={data.feed} /><input type="hidden" name="q" value={data.q} /><input type="hidden" name="sort" value={data.sort} /><label class="content-filter-option"><input type="checkbox" name="mature" value="true" checked={data.matureOnly} /><span>Only R and X-rated</span></label><label class="content-filter-option"><input type="checkbox" name="hide_r" value="true" checked={data.hideR} /><span><span class="content-rating content-rating-r" aria-hidden="true">R</span> Hide R-rated</span></label><label class="content-filter-option"><input type="checkbox" name="show_x" value="true" checked={!data.hideX} /><span><span class="content-rating content-rating-x" aria-hidden="true">X</span> Include X-rated</span></label><button type="submit">Apply filters</button>{#if data.hideR}<a class="clear-content-filters" href={clearRHref()}>Clear R filter</a>{/if}</form></details>
      </div>
    </div>
    {#if data.feed === 'following' && !token}<p><a href="/login">Sign in</a> to see posts from communities you follow.</p>{:else if feedLoading}<p role="status">Loading Following…</p>{:else if feedError}<p role="alert">{feedError}</p>{:else if feedPosts.length === 0}<p class="empty">{data.feed === 'following' ? 'Follow a community to fill your Following feed.' : 'No discussions found.'}</p>{:else}
      {#each feedPosts as post (post.id)}
        <article class:source-article={Boolean(post.source)}>
          {#if post.content_rating === 'r' || post.content_rating === 'x'}<div class="content-rating-row"><span class:content-rating-r={post.content_rating === 'r'} class:content-rating-x={post.content_rating === 'x'} class="content-rating" title={post.content_rating === 'r' ? 'R-rated content' : 'X-rated content'}>{post.content_rating.toUpperCase()}</span><span>{post.content_rating === 'r' ? 'R-rated' : 'X-rated'}</span></div>{/if}
          {#if isTimelinePreview(post)}
            {#if post.source?.provider === 'x' || post.source?.provider === 'youtube'}
              <div class="feed-context"><a href={'/?community=' + encodeURIComponent(post.community)}>c/{post.community}</a><span>·</span><span>Shared from {post.source.provider === 'youtube' ? 'YouTube' : 'X'}</span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></div>
              {#if !redundantSourceTitle(post) && post.title}<h3 class="feed-title"><a href={'/post/' + post.public_id}>{post.title}</a></h3>{/if}
            {:else}
              <div class="meta">
                {#if post.source?.provider === 'reddit'}<AuthorAvatar handle={post.source.source_author} size="small" /><span><strong>From Reddit</strong><span> · </span><span>{post.source.source_author}</span><span> · </span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></span>
                {:else}<AuthorAvatar handle={post.author} size="small" /><span><a href="/?community={post.community}">c/{post.community}</a><span> · </span><span>posted by <a href={'/u/' + post.author}>u/{post.author}</a></span><span> · </span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></span>{/if}
              </div>
              {#if !redundantSourceTitle(post)}<h3><a href={'/post/' + post.public_id}>{post.title}</a></h3>{/if}
            {/if}
            <div class="timeline-preview-card" class:no-image={!timelineMedia(post)}>
              {#if timelineMedia(post)}<a class="timeline-preview-image" href={'/post/' + post.public_id} aria-label={'Open ' + post.title}><img src={timelineMedia(post)} alt={post.title} loading="lazy" /></a>{/if}
              <div class="timeline-preview-copy"><span class="timeline-preview-label">{timelineLabel(post)}</span><p>{timelineExcerpt(post.body)}</p><a class="timeline-read-link" href={'/post/' + post.public_id}>{isArticlePost(post) ? 'Read full article →' : 'Read full post →'}</a></div>
            </div>
            <PostActions {post} />
          {:else if post.source?.provider === 'x' || post.source?.provider === 'youtube'}
            <div class="feed-context"><a href={'/?community=' + encodeURIComponent(post.community)}>c/{post.community}</a><span>·</span><span>Shared from {post.source.provider === 'youtube' ? 'YouTube' : 'X'}</span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></div>
            {#if !redundantSourceTitle(post) && post.title}<h3 class="feed-title"><a href={'/post/' + post.public_id}>{post.title}</a></h3>{/if}
            <SourcePost source={post.source} text={post.body} post={post} embedded={true} />
          {:else}
            <div class="meta">
              {#if post.source?.provider === 'reddit'}<AuthorAvatar handle={post.source.source_author} size="small" /><span><strong>From Reddit</strong><span> · </span><span>{post.source.source_author}</span><span> · </span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></span>
              {:else}<AuthorAvatar handle={post.author} size="small" /><span><a href="/?community={post.community}">c/{post.community}</a><span> · </span><span>posted by <a href={'/u/' + post.author}>u/{post.author}</a></span><span> · </span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></span>{/if}
            </div>
            {#if !redundantSourceTitle(post)}<h3><a href={'/post/' + post.public_id}>{post.title}</a></h3>{/if}
            <PostBody body={post.body} />
            {#if post.source}<SourcePost source={post.source} text={post.body} post={post} embedded={true} />{:else}<PostActions {post} />{/if}
          {/if}
          <footer><PostViews id={post.id} initial={post} /><a class="open-discussion" href={'/post/' + post.public_id}>Open discussion →</a></footer>
        </article>
      {/each}
    {/if}
    <nav aria-label="Discussion pages">{#if data.page > 1}<a href={pageLink(data.page - 1)}>← Previous</a>{/if} {#if feedHasMore}<a href={pageLink(data.page + 1)}>Next →</a>{/if}</nav>
  </section>
</div>
{#if token}<div class="compose-launcher"><button class="compose-fab" type="button" aria-label={composeOpen ? 'Close composer' : 'Start a discussion'} title={composeOpen ? 'Close composer' : 'Start a discussion'} aria-expanded={composeOpen} onclick={() => composeOpen = !composeOpen}><Icon name={composeOpen ? 'x' : 'plus'} size={20} /><span class="compose-label">{composeOpen ? 'Close' : 'Start discussion'}</span></button>{#if composeOpen}<section id="compose-panel" class="compose-panel" aria-labelledby="compose-title"><div class="compose-panel-heading"><div><p class="eyebrow">ADD TO THE COMMONS</p><h2 id="compose-title">Start a discussion</h2></div><button class="panel-close" type="button" aria-label="Close composer" title="Close composer" onclick={() => composeOpen = false}><Icon name="x" size={18} /></button></div><form onsubmit={(event) => { event.preventDefault(); createPost(); }}><CommunityPicker communities={data.communities} bind:value={community} id="discussion-community" /><label>Title<input bind:value={title} required maxlength="300" /></label><label>Body<textarea bind:value={body} maxlength="50000" rows="5" aria-describedby="discussion-body-help"></textarea><small id="discussion-body-help">Paste a YouTube video URL here and it will be embedded automatically.</small></label><label>Content rating<select bind:value={contentRating} aria-describedby="content-rating-help"><option value="general">General</option><option value="r">R — mature themes</option><option value="x">X — explicit content</option></select><small id="content-rating-help">Choose the highest rating that applies. Auto-tagging will build on this label later.</small></label><button class="publish-button" type="submit">Publish</button>{#if formError}<p class="form-error">{formError}</p>{/if}{#if formMessage}<p class="form-message">{formMessage}</p>{/if}</form><details class="source-import"><summary><Icon name="download" size={16} />Share a source post (X, Reddit, or YouTube)</summary><QuickCrossPost communities={data.communities} selectedCommunity={community} /></details></section>{/if}</div>{/if}
</main>
<MediaDock />
<style>
  .home-header{height:auto;display:block;padding:0;background:color-mix(in srgb,var(--page,#f6f4ee) 94%,transparent);backdrop-filter:blur(14px);position:sticky;top:0;z-index:15}
  .home-header-inner{height:64px;max-width:1180px;margin:auto;padding:0 24px;display:flex;align-items:center;gap:18px}
  :global(.home-header .brand){flex:none}
  .header-context{font-size:.78rem;color:var(--muted,#66766c);letter-spacing:.02em}
  .header-actions{display:flex;align-items:center;gap:4px;margin-left:auto}
  .header-icon{width:36px;height:36px;display:inline-grid;place-items:center;border-radius:9px;color:var(--muted,#66766c);background:transparent;border:0;cursor:pointer}
  .header-icon:hover,.header-icon:focus-visible{background:var(--subtle,#e4e9df);color:var(--heading,#173d34)}
  :global(.header-icon svg){width:19px;height:19px}
  .global-search{max-width:1180px;margin:auto;padding:0 24px 12px;display:flex;align-items:center;gap:10px}
  :global(.global-search>svg){flex:none;color:var(--muted,#66766c)}
  .global-search input{height:40px;min-width:0;flex:1;border:1px solid var(--border,#c7ccc3);border-radius:8px;background:var(--surface,#fff);font:inherit}
  .global-search button{width:40px;height:40px;display:grid;place-items:center;border-radius:8px;padding:0}
  .home{padding:34px 24px 110px}
  .layout{grid-template-columns:204px minmax(0,720px);justify-content:center;gap:48px}
  .community-nav{position:sticky;top:82px;align-self:start;max-height:calc(100vh - 104px);overflow-y:auto;padding-top:8px;scrollbar-width:thin}
  .community-nav::-webkit-scrollbar{width:7px}
  .community-nav::-webkit-scrollbar-thumb{background:var(--border,#c7ccc3);border-radius:999px}
  .sidebar-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .sidebar-heading h2{margin:0}
  .sidebar-heading a{width:30px;height:30px;display:grid;place-items:center;border-radius:8px;color:var(--muted,#66766c)}
  .sidebar-heading a:hover{background:var(--subtle,#e4e9df);color:var(--heading,#173d34)}
  .community-nav>a{padding:8px 10px;border-radius:8px}
  .feed{min-width:0;max-width:720px}
  .feed>article.source-article{padding:20px 22px}
  .feed-context{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px;color:var(--muted,#66766c);font-size:.76rem;font-weight:650}
  .feed-context a{color:var(--accent,#575d3d);font-weight:800}
  .feed-context time{margin-left:auto;font-weight:500}
  .feed-title{margin:0 0 12px!important;font-size:1.45rem!important;line-height:1.15!important;overflow-wrap:anywhere}
  .feed-title a,.feed>article h3 a{overflow-wrap:anywhere}
  .feed-tabs{display:flex;gap:20px;margin:0 0 26px;border-bottom:1px solid var(--border,#dedfd7)}
  .feed-tabs a{position:relative;padding:0 2px 12px;color:var(--muted,#66766c);font-size:.9rem;font-weight:700}
  .feed-tabs a.active{color:var(--heading,#173d34)}
  .feed-tabs a.active::after{content:'';position:absolute;right:0;bottom:-1px;left:0;height:3px;border-radius:3px 3px 0 0;background:var(--accent,#9b5e38)}
  .feed-head{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:22px}
  .feed-head .eyebrow{margin:0 0 5px}
  .feed-head h1{margin:0;color:var(--heading,#173d34);font:500 clamp(2rem,3vw,2.7rem)/1.05 Georgia,serif;letter-spacing:-.04em}
  .feed-head-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}
  .start-discussion-button,.post-cta{height:38px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 14px;border:1px solid var(--accent,#575d3d);border-radius:999px;font:750 .78rem ui-sans-serif,system-ui,sans-serif;white-space:nowrap;cursor:pointer}
  .start-discussion-button{background:var(--button-bg,#575d3d);color:var(--button-text,#f7f8f4)}
  .start-discussion-button:hover,.start-discussion-button:focus-visible{background:var(--heading,#1f2117);border-color:var(--heading,#1f2117)}
  .post-cta{background:transparent;color:var(--accent,#575d3d)}
  .post-cta:hover,.post-cta:focus-visible{background:var(--subtle,#c4c9b0);color:var(--heading,#1f2117)}
  .feed-options{position:relative;flex:none}
  .feed-options>summary{display:flex;align-items:center;gap:7px;padding:8px 10px;border:1px solid var(--border,#c7ccc3);border-radius:8px;color:var(--muted,#66766c);font-size:.78rem;font-weight:700;cursor:pointer;list-style:none}
  .feed-options>summary::-webkit-details-marker{display:none}
  .feed-options[open]>summary,.feed-options>summary:hover{background:var(--subtle,#e4e9df);color:var(--heading,#173d34)}
  .feed-options form{position:absolute;right:0;top:calc(100% + 8px);z-index:5;width:220px;padding:12px;border:1px solid var(--border,#c7ccc3);border-radius:10px;background:var(--surface,#fff);box-shadow:0 12px 28px #0002}
  .feed-options select{width:100%;height:38px;border:1px solid var(--border,#c7ccc3);border-radius:7px;padding:0 8px;background:var(--page,#f6f4ee);font:inherit;font-size:.8rem}
  .feed-options button{margin-top:9px;width:100%;height:36px;border-radius:7px;font-size:.78rem}
  .content-filters>summary{justify-content:center}
  .filter-count{font-size:.65rem;color:var(--accent,#9b5e38);text-transform:uppercase;letter-spacing:.05em}
  .content-filters form{display:grid;gap:9px}
  .content-filter-option{display:flex;align-items:center;gap:8px;color:var(--heading,#173d34);font-size:.78rem;font-weight:650;cursor:pointer}
  .content-filter-option input{accent-color:var(--accent,#575d3d)}
  .content-filter-option>span{display:inline-flex;align-items:center;gap:7px}
  .content-rating-row{display:flex;align-items:center;gap:8px;margin:0 0 10px;color:var(--muted,#66766c);font-size:.72rem;font-weight:750;text-transform:uppercase;letter-spacing:.06em}
  .content-rating{width:22px;height:22px;display:inline-grid;place-items:center;border:1px solid transparent;border-radius:6px;font:800 .7rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:0}
  .content-rating-r{background:#9b5e38;border-color:#9b5e38;color:#fff}
  .content-rating-x{background:#6f263d;border-color:#6f263d;color:#fff}
  .clear-content-filters{display:block;margin-top:1px;color:var(--accent,#9b5e38);font-size:.76rem;font-weight:700;text-align:center}
  .timeline-preview-card{display:grid;grid-template-columns:minmax(0,180px) minmax(0,1fr);gap:16px;align-items:start;margin:10px 0 2px;padding:10px;border:1px solid var(--border,#c7ccc3);border-radius:10px;background:color-mix(in srgb,var(--subtle,#e4e9df) 48%,var(--surface,#fff))}
  .timeline-preview-card.no-image{grid-template-columns:minmax(0,1fr)}
  .timeline-preview-image{display:block;overflow:hidden;border-radius:7px;background:var(--subtle,#dde3da);aspect-ratio:16/10}
  .timeline-preview-image img{display:block;width:100%;height:100%;object-fit:cover}
  .timeline-preview-copy{min-width:0;padding:2px 2px 3px}
  .timeline-preview-label{display:block;color:var(--accent,#9b5e38);font-size:.68rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
  .timeline-preview-copy p{display:-webkit-box;margin:7px 0 10px;overflow:hidden;color:var(--muted,#66766c);font-size:.84rem;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:4;line-clamp:4}
  .timeline-read-link{color:var(--heading,#173d34);font-size:.8rem;font-weight:800}
  .feed>article>footer{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--border,#dedfd7);color:var(--muted,#66766c);font-size:.78rem}
  .open-discussion{margin-left:auto;color:var(--accent,#9b5e38);font-weight:700}
  .mobile-community-nav{display:none}
  .compose-launcher{position:fixed;right:30px;bottom:132px;z-index:40}
  .compose-fab{min-width:54px;height:46px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;padding:0 17px;background:var(--accent,#9b5e38);color:#fff;box-shadow:0 8px 22px #0003;cursor:pointer;font-weight:750}
  .compose-label{white-space:nowrap;font-size:.8rem}
  .compose-fab:hover,.compose-fab:focus-visible{transform:translateY(-2px);box-shadow:0 11px 26px #0004}
  .compose-panel{position:absolute;right:0;bottom:66px;width:min(390px,calc(100vw - 40px));padding:20px;border:1px solid var(--border,#c7ccc3);border-radius:14px;background:var(--surface,#fff);box-shadow:0 16px 45px #0003}
  .compose-panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
  .compose-panel-heading .eyebrow{margin:0 0 4px}
  .compose-panel h2{margin:0;color:var(--heading,#173d34);font:500 1.45rem/1.1 Georgia,serif}
  .panel-close{width:32px;height:32px;display:grid;place-items:center;padding:0;border-radius:8px;background:transparent;color:var(--muted,#66766c)}
  .panel-close:hover{background:var(--subtle,#e4e9df);color:var(--heading,#173d34)}
  .compose-panel form{display:grid;gap:11px}
  .compose-panel label{display:grid;gap:5px;color:var(--muted,#66766c);font-size:.77rem;font-weight:700}
  .compose-panel input,.compose-panel textarea{width:100%;border:1px solid var(--border,#c7ccc3);border-radius:7px;padding:9px 10px;background:var(--page,#f6f4ee);font:inherit}
  .compose-panel select{width:100%;height:40px;border:1px solid var(--border,#c7ccc3);border-radius:7px;padding:0 10px;background:var(--page,#f6f4ee);font:inherit}
  .compose-panel label small{font-size:.68rem;font-weight:500;line-height:1.35;color:var(--muted,#66766c)}
  .compose-panel textarea{resize:vertical;min-height:92px}
  .publish-button{height:38px;border-radius:7px}
  .form-error,.form-message{margin:0;font-size:.78rem}
  .source-import{margin-top:16px;border-top:1px solid var(--border,#dedfd7);padding-top:12px}
  .source-import>summary{display:flex;align-items:center;gap:7px;color:var(--muted,#66766c);font-size:.8rem;font-weight:700;cursor:pointer;list-style:none}
  .source-import>summary::-webkit-details-marker{display:none}
  .source-import :global(.quick-crosspost){margin:12px 0 0;padding:0;border:0;background:transparent}
  .source-import :global(.crosspost-heading){display:block}
  .source-import :global(.crosspost-heading>p),.source-import :global(.crosspost-note){display:none}
  .source-import :global(form){display:grid;grid-template-columns:1fr;gap:9px}
  .source-import :global(form button){width:100%}
  @media(max-width:900px){.header-context{display:none}.layout{grid-template-columns:180px minmax(0,720px);gap:28px}.community-nav{position:static;max-height:none;overflow:visible}}
  @media(max-width:700px){
    .home-header-inner{height:60px;padding:0 16px;gap:10px}
    :global(.home-header .brand){font-size:1.2rem}
    :global(.home-header .brand::before){width:26px;height:26px}
    .header-actions{gap:0}
    .header-icon{width:32px;height:32px}
    .global-search{padding:0 16px 10px}
    .home{padding:22px 0 110px}
    .layout{display:block}
    .community-nav{display:none}
    .feed{max-width:none}
  .feed>article.source-article{padding:20px 18px}
  .timeline-preview-card{grid-template-columns:92px minmax(0,1fr);gap:11px;padding:8px}
  .timeline-preview-card.no-image{grid-template-columns:minmax(0,1fr)}
  .timeline-preview-copy p{font-size:.78rem;-webkit-line-clamp:3;line-clamp:3}
    .feed-context time{margin-left:0}
    .feed-tabs{padding:0 18px;margin-bottom:20px}
    .feed-head{padding:0 18px;margin-bottom:16px}
    .feed-head-actions{justify-content:space-between;margin-top:12px}
    .feed-head h1{font-size:2rem}
    .feed-options>summary{padding:7px 8px}
    .mobile-community-nav{display:none}
    .feed>article{border:0;border-top:1px solid var(--border,#dedfd7);border-radius:0;background:transparent;padding:20px 18px;margin:0}
    .feed>article:first-of-type{border-top:0}
    .feed nav{padding:22px 18px}
    .compose-launcher{right:18px;bottom:132px}
    .compose-fab{width:54px;min-width:54px;height:54px;padding:0;border-radius:50%}
    .compose-label{display:none}
    .compose-panel{bottom:66px;width:min(390px,calc(100vw - 28px));max-height:calc(100dvh - 220px);overflow-y:auto;overscroll-behavior:contain;padding:17px}
    .source-import :global(form button){grid-column:1;grid-row:auto}
  }
</style>
