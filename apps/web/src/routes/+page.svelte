<script>
  export let data;
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import { invalidateAll } from '$app/navigation';
  import SessionNav from '$lib/SessionNav.svelte';
  import BookmarkButton from '$lib/BookmarkButton.svelte';
  import ShareButton from '$lib/ShareButton.svelte';
  import SourcePost from '$lib/SourcePost.svelte';
  import MediaDock from '$lib/MediaDock.svelte';
  import AuthorAvatar from '$lib/AuthorAvatar.svelte';
  import VoteButtons from '$lib/VoteButtons.svelte';
  import PostViews from '$lib/PostViews.svelte';
  import QuickCrossPost from '$lib/QuickCrossPost.svelte';
  import CommunityPicker from '$lib/CommunityPicker.svelte';
  let searchOpen = Boolean(data.q);
  let composeOpen = false;
  let searchInput;
  function pageLink(page) { return '/?' + new URLSearchParams({feed:data.feed,community:data.community,q:data.q,sort:data.sort,page:String(page)}); }
  function feedHref(feed) { const params = new URLSearchParams({feed}); if (data.community) params.set('community',data.community); if (data.q) params.set('q',data.q); return '/?' + params; }
  const initialCommunity = data.communities.find(item => item.slug === data.community)?.slug || data.communities[0]?.slug || '';
  let token = '', title = '', body = '', community = initialCommunity, formError = '', formMessage = '';
  let feedPosts = data.posts, feedHasMore = data.hasMore, feedLoading = false, feedError = '', followingRequestKey = '';
  const redundantSourceTitle = post => post?.source?.provider === 'x' && post.title?.trim() === post.body?.split(/\r?\n/, 1)[0]?.trim();
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
    const key = `${data.page}:${data.q}:${data.community}:${data.sort}`;
    if (followingRequestKey === key) return;
    followingRequestKey = key; feedLoading = true; feedError = '';
    const params = new URLSearchParams({sort:data.sort,page:String(data.page)});
    if (data.q) params.set('q',data.q);
    if (data.community) params.set('community',data.community);
    try {
      const response = await fetch('/api/home?' + params,{headers:{authorization:'Bearer ' + token}});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load your following feed.');
      feedPosts = result.posts; feedHasMore = result.has_more;
    } catch (error) { feedError = error.message || 'Could not reach Swartzit.'; }
    finally { feedLoading = false; }
  }
  $: if (data.feed === 'following' && token && followingRequestKey !== `${data.page}:${data.q}:${data.community}:${data.sort}`) loadFollowing();
  $: if (data.feed === 'following') {
    if (token) loadFollowing();
    else { feedPosts = []; feedHasMore = false; feedError = 'Sign in to see posts from communities you follow.'; }
  } else { feedPosts = data.posts; feedHasMore = data.hasMore; feedError = ''; followingRequestKey = ''; }
  async function createPost() { formError = ''; formMessage = ''; const response = await fetch('/api/posts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ community, title, body }) }); const result = await response.json(); if (!response.ok) { formError = result.error ?? 'Could not submit discussion'; return; } if (result.status === 'pending') { formMessage = result.message ?? 'Your discussion is waiting for moderator review.'; title = ''; body = ''; return; } window.location.assign(`/post/${result.public_id}`); }
</script>

<svelte:head><title>Swartzit — the commons</title></svelte:head>
<header class="home-header">
  <div class="home-header-inner">
    <a class="brand" href="/">swartzit</a>
    <span class="header-context">The community commons</span>
    <div class="header-actions">
      <a class="header-icon" href="/api/export" download="swartzit-export.json" aria-label="Export public data" title="Export public data"><Icon name="download" /></a>
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
      {#if data.community}<input type="hidden" name="community" value={data.community} />{/if}
      <button type="submit" aria-label="Run search" title="Run search"><Icon name="search" size={18} /></button>
    </form>
  {/if}
</header>
<main class="home">
<div class="layout"><aside class="community-nav"><div class="sidebar-heading"><h2>Communities</h2><a href="/communities" aria-label="Browse all communities" title="Browse all communities"><Icon name="grid" size={17} /></a></div><a class="selected" href="/">All discussions</a>{#each data.communities as community}<a href="/?community={community.slug}"><strong>c/{community.slug}</strong><small>{community.post_count} posts</small></a>{/each}</aside><section class="feed"><nav class="feed-tabs" aria-label="Feed"><a class:active={data.feed === 'timeline'} href={feedHref('timeline')}>Timeline</a><a class:active={data.feed === 'following'} href={feedHref('following')}>Following</a></nav><details class="mobile-community-nav"><summary>Browse communities <span>{data.community ? `c/${data.community}` : 'All discussions'}</span></summary><div><a class="selected" href="/">All discussions</a>{#each data.communities as community}<a href="/?community={community.slug}"><strong>c/{community.slug}</strong><small>{community.post_count} posts</small></a>{/each}</div></details><div class="feed-head"><div><p class="eyebrow">{data.community ? `c/${data.community}` : 'COMMUNITY TIMELINE'}</p><h1>{data.feed === 'following' ? 'Following' : 'Timeline'}</h1></div><details class="feed-options"><summary><Icon name="sliders" size={16} /><span>Sort</span></summary><form method="GET"><input type="hidden" name="community" value={data.community} /><input type="hidden" name="feed" value={data.feed} /><input type="hidden" name="q" value={data.q} /><select name="sort" aria-label="Sort discussions" value={data.sort}><option value="newest">Newest imports / posts</option><option value="score">Swartzit votes</option><option value="views">Swartzit views</option><option value="engaged">Swartzit engaged views</option><option value="comments">Swartzit comments</option><option value="source_views">X views</option><option value="source_likes">X likes</option><option value="source_reposts">X reposts</option><option value="source_replies">X replies</option></select><button type="submit">Apply</button></form></details></div>{#if data.feed === 'following' && !token}<p><a href="/login">Sign in</a> to see posts from communities you follow.</p>{:else if feedLoading}<p role="status">Loading Following…</p>{:else if feedError}<p role="alert">{feedError}</p>{:else if feedPosts.length === 0}<p class="empty">{data.feed === 'following' ? 'Follow a community to fill your Following feed.' : 'No discussions found.'}</p>{:else}{#each feedPosts as post (post.id)}<article>{#if post.source?.provider !== 'x'}<div class="meta">
{#if post.source?.provider === 'x' || post.source?.provider === 'reddit'}<AuthorAvatar handle={post.source.source_author} size="small" /><span><strong>From {post.source.provider === 'x' ? 'X' : 'Reddit'}</strong><span> · </span><span>{post.source.source_author}</span><span> · </span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></span>
{:else}<AuthorAvatar handle={post.author} size="small" /><span><a href="/?community={post.community}">c/{post.community}</a><span> · </span><span>posted by <a href={'/u/' + post.author}>u/{post.author}</a></span><span> · </span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></span>{/if}
</div>{/if}{#if post.source?.provider === 'x'}<SourcePost source={post.source} text={post.body} />{:else}{#if !redundantSourceTitle(post)}<h3><a href="/post/{post.public_id}">{post.title}</a></h3>{/if}<p>{post.body}</p>{#if post.source}<SourcePost source={post.source} text={post.body} />{/if}{/if}<div class="post-actions"><BookmarkButton id={post.id} /><ShareButton id={post.public_id} title={post.title} /></div><VoteButtons id={post.id} score={post.score} /><footer><PostViews id={post.id} initial={post} /><a href="/post/{post.public_id}">{post.comment_count} comments</a><a class="open-discussion" href="/post/{post.public_id}">Open discussion →</a></footer></article>{/each}{/if}<nav aria-label="Discussion pages">{#if data.page > 1}<a href={pageLink(data.page - 1)}>← Previous</a>{/if} {#if feedHasMore}<a href={pageLink(data.page + 1)}>Next →</a>{/if}</nav></section></div>
{#if token}<div class="compose-launcher"><button class="compose-fab" type="button" aria-label={composeOpen ? 'Close composer' : 'Start a discussion'} title={composeOpen ? 'Close composer' : 'Start a discussion'} aria-expanded={composeOpen} onclick={() => composeOpen = !composeOpen}><Icon name={composeOpen ? 'x' : 'plus'} size={23} /></button>{#if composeOpen}<section class="compose-panel" aria-labelledby="compose-title"><div class="compose-panel-heading"><div><p class="eyebrow">ADD TO THE COMMONS</p><h2 id="compose-title">Start a discussion</h2></div><button class="panel-close" type="button" aria-label="Close composer" title="Close composer" onclick={() => composeOpen = false}><Icon name="x" size={18} /></button></div><form onsubmit={(event) => { event.preventDefault(); createPost(); }}><CommunityPicker communities={data.communities} bind:value={community} id="discussion-community" /><label>Title<input bind:value={title} required maxlength="300" /></label><label>Body<textarea bind:value={body} maxlength="50000" rows="5"></textarea></label><button class="publish-button" type="submit">Publish</button>{#if formError}<p class="form-error">{formError}</p>{/if}{#if formMessage}<p class="form-message">{formMessage}</p>{/if}</form><details class="source-import"><summary><Icon name="download" size={16} />Share a source post</summary><QuickCrossPost communities={data.communities} selectedCommunity={community} /></details></section>{/if}</div>{/if}
</main>
<MediaDock />
<style>
  .home-header{height:auto;display:block;padding:0;background:color-mix(in srgb,var(--page,#f6f4ee) 94%,transparent);backdrop-filter:blur(14px);position:sticky;top:0;z-index:15}
  .home-header-inner{height:64px;max-width:1180px;margin:auto;padding:0 24px;display:flex;align-items:center;gap:18px}
  .home-header .brand{flex:none}
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
  .community-nav{padding-top:8px}
  .sidebar-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .sidebar-heading h2{margin:0}
  .sidebar-heading a{width:30px;height:30px;display:grid;place-items:center;border-radius:8px;color:var(--muted,#66766c)}
  .sidebar-heading a:hover{background:var(--subtle,#e4e9df);color:var(--heading,#173d34)}
  .community-nav>a{padding:8px 10px;border-radius:8px}
  .feed{min-width:0;max-width:720px}
  .feed-tabs{display:flex;gap:20px;margin:0 0 26px;border-bottom:1px solid var(--border,#dedfd7)}
  .feed-tabs a{position:relative;padding:0 2px 12px;color:var(--muted,#66766c);font-size:.9rem;font-weight:700}
  .feed-tabs a.active{color:var(--heading,#173d34)}
  .feed-tabs a.active::after{content:'';position:absolute;right:0;bottom:-1px;left:0;height:3px;border-radius:3px 3px 0 0;background:var(--accent,#9b5e38)}
  .feed-head{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:22px}
  .feed-head .eyebrow{margin:0 0 5px}
  .feed-head h1{margin:0;color:var(--heading,#173d34);font:500 clamp(2rem,3vw,2.7rem)/1.05 Georgia,serif;letter-spacing:-.04em}
  .feed-options{position:relative;flex:none}
  .feed-options>summary{display:flex;align-items:center;gap:7px;padding:8px 10px;border:1px solid var(--border,#c7ccc3);border-radius:8px;color:var(--muted,#66766c);font-size:.78rem;font-weight:700;cursor:pointer;list-style:none}
  .feed-options>summary::-webkit-details-marker{display:none}
  .feed-options[open]>summary,.feed-options>summary:hover{background:var(--subtle,#e4e9df);color:var(--heading,#173d34)}
  .feed-options form{position:absolute;right:0;top:calc(100% + 8px);z-index:5;width:220px;padding:12px;border:1px solid var(--border,#c7ccc3);border-radius:10px;background:var(--surface,#fff);box-shadow:0 12px 28px #0002}
  .feed-options select{width:100%;height:38px;border:1px solid var(--border,#c7ccc3);border-radius:7px;padding:0 8px;background:var(--page,#f6f4ee);font:inherit;font-size:.8rem}
  .feed-options button{margin-top:9px;width:100%;height:36px;border-radius:7px;font-size:.78rem}
  .open-discussion{margin-left:auto;color:var(--accent,#9b5e38);font-weight:700}
  .post-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .mobile-community-nav{display:none}
  .compose-launcher{position:fixed;right:30px;bottom:132px;z-index:40}
  .compose-fab{width:54px;height:54px;display:grid;place-items:center;border-radius:50%;padding:0;background:var(--accent,#9b5e38);color:#fff;box-shadow:0 8px 22px #0003;cursor:pointer}
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
  @media(max-width:900px){.header-context{display:none}.layout{grid-template-columns:180px minmax(0,720px);gap:28px}}
  @media(max-width:700px){
    .home-header-inner{height:60px;padding:0 16px;gap:10px}
    .home-header .brand{font-size:1.2rem}
    .home-header .brand::before{width:26px;height:26px}
    .header-actions{gap:0}
    .header-icon{width:32px;height:32px}
    .global-search{padding:0 16px 10px}
    .home{padding:22px 0 110px}
    .layout{display:block}
    .community-nav{display:none}
    .feed{max-width:none}
    .feed-tabs{padding:0 18px;margin-bottom:20px}
    .feed-head{padding:0 18px;margin-bottom:16px}
    .feed-head h1{font-size:2rem}
    .feed-options>summary{padding:7px 8px}
    .mobile-community-nav{display:none}
    .feed>article{border:0;border-top:1px solid var(--border,#dedfd7);border-radius:0;background:transparent;padding:20px 18px;margin:0}
    .feed>article:first-of-type{border-top:0}
    .feed nav{padding:22px 18px}
    .compose-launcher{right:18px;bottom:132px}
    .compose-panel{bottom:66px;width:min(390px,calc(100vw - 28px));padding:17px}
  }
</style>
