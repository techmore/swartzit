<script>
  export let data;
  import { onMount } from 'svelte';
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
  function pageLink(page) { return '/?' + new URLSearchParams({feed:data.feed,community:data.community,q:data.q,sort:data.sort,page:String(page)}); }
  function feedHref(feed) { const params = new URLSearchParams({feed}); if (data.community) params.set('community',data.community); if (data.q) params.set('q',data.q); return '/?' + params; }
  function openPost(event, publicId) {
    if (event.target.closest('a,button,input,select,textarea,video')) return;
    window.location.assign(`/post/${publicId}`);
  }
  function openPostFromKeyboard(event, publicId) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPost(event, publicId);
  }
  let token = '', title = '', body = '', community = data.communities[0]?.slug ?? '', formError = '', formMessage = '';
  let feedPosts = data.posts, feedHasMore = data.hasMore, feedLoading = false, feedError = '', followingRequestKey = '';
  const redundantSourceTitle = post => post?.source?.provider === 'x' && post.title?.trim() === post.body?.split(/\r?\n/, 1)[0]?.trim();
  onMount(() => {
    token = localStorage.getItem('swartzit_session') ?? '';
    const timer = setInterval(() => { if (!document.hidden) invalidateAll(); }, 300000);
    return () => clearInterval(timer);
  });
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
  async function createPost() { formError = ''; formMessage = ''; const response = await fetch('/api/posts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ community, title, body }) }); const result = await response.json(); if (!response.ok) { formError = result.error ?? 'Could not publish discussion'; return; } window.location.assign(`/post/${result.public_id}`); }
</script>

<svelte:head><title>Swartzit — the commons</title></svelte:head>
<header><a class="brand" href="/">swartzit</a><span>Read freely. Participate under a pseudonym. Take your community with you.</span><a href="/api/export" download="swartzit-export.json">Export public data</a><SessionNav /></header>
<main class="home">
<div class="layout"><aside class="community-nav"><h2>Communities</h2><a class="selected" href="/">All discussions</a>{#each data.communities as community}<a href="/?community={community.slug}"><strong>c/{community.slug}</strong><small>{community.post_count} posts</small></a>{/each}</aside><section class="feed">{#if token}<QuickCrossPost communities={data.communities} selectedCommunity={data.community} />{/if}<nav class="feed-tabs" aria-label="Feed"><a class:active={data.feed === 'recommended'} href={feedHref('recommended')}>For you</a><a class:active={data.feed === 'following'} href={feedHref('following')}>Following</a></nav><details class="mobile-community-nav"><summary>Browse communities <span>{data.community ? `c/${data.community}` : 'All discussions'}</span></summary><div><a class="selected" href="/">All discussions</a>{#each data.communities as community}<a href="/?community={community.slug}"><strong>c/{community.slug}</strong><small>{community.post_count} posts</small></a>{/each}</div></details><div class="feed-head"><h2>{data.feed === 'following' ? 'Following' : 'For you'}</h2><form><input type="hidden" name="community" value={data.community} /><input type="hidden" name="feed" value={data.feed} /><input name="q" value={data.q} placeholder="Search discussions" aria-label="Search discussions" /><select name="sort" aria-label="Sort discussions" value={data.sort}><option value="recommended">Recommended</option><option value="newest">Newest imports / posts</option><option value="score">Swartzit votes</option><option value="views">Swartzit views</option><option value="engaged">Swartzit engaged views</option><option value="comments">Swartzit comments</option><option value="source_views">X views</option><option value="source_likes">X likes</option><option value="source_reposts">X reposts</option><option value="source_replies">X replies</option></select><button>Apply</button></form></div>{#if data.feed === 'following' && !token}<p><a href="/login">Sign in</a> to see posts from communities you follow.</p>{:else if feedLoading}<p role="status">Loading Following…</p>{:else if feedError}<p role="alert">{feedError}</p>{:else if feedPosts.length === 0}<p class="empty">{data.feed === 'following' ? 'Follow a community to fill your Following feed.' : 'No discussions found.'}</p>{:else}{#each feedPosts as post (post.id)}<article role="link" tabindex="0" aria-label={`Open discussion: ${post.title}`} on:click={(event) => openPost(event, post.public_id)} on:keydown={(event) => openPostFromKeyboard(event, post.public_id)}>{#if post.source?.provider !== 'x'}<div class="meta">
{#if post.source?.provider === 'x'}<AuthorAvatar handle={post.source.source_author} size="small" /><span><strong>From X</strong><span> · </span><span>{post.source.source_author}</span><span> · </span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></span>
{:else}<AuthorAvatar handle={post.author} size="small" /><span><a href="/?community={post.community}">c/{post.community}</a><span> · </span><span>posted by u/{post.author}</span><span> · </span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></span>{/if}
</div>{/if}{#if post.source?.provider === 'x'}<SourcePost source={post.source} text={post.body} />{:else}{#if !redundantSourceTitle(post)}<h3><a href="/post/{post.public_id}">{post.title}</a></h3>{/if}<p>{post.body}</p>{#if post.source}<SourcePost source={post.source} text={post.body} />{/if}{/if}<div class="post-actions"><BookmarkButton id={post.id} /><ShareButton id={post.public_id} title={post.title} /></div><VoteButtons id={post.id} score={post.score} /><footer><PostViews id={post.id} initial={post} /><a href="/post/{post.public_id}">{post.comment_count} comments</a><a class="open-discussion" href="/post/{post.public_id}">Open discussion →</a></footer></article>{/each}{/if}<nav aria-label="Discussion pages">{#if data.page > 1}<a href={pageLink(data.page - 1)}>← Previous</a>{/if} {#if feedHasMore}<a href={pageLink(data.page + 1)}>Next →</a>{/if}</nav></section></div>
{#if token}<section class="compose"><h2>Start a discussion</h2><form on:submit|preventDefault={createPost}><label>Community<select bind:value={community}>{#each data.communities as item}<option value={item.slug}>c/{item.slug}</option>{/each}</select></label><label>Title<input bind:value={title} required maxlength="300" /></label><label>Body<textarea bind:value={body} maxlength="50000" rows="5"></textarea></label><button>Publish</button>{#if formError}<p class="form-error">{formError}</p>{/if}{#if formMessage}<p class="form-message">{formMessage}</p>{/if}</form></section>{/if}
</main>
<MediaDock />
<style>
  .home{padding-top:42px}
  .feed{min-width:0;max-width:650px}   .feed-tabs{display:flex;gap:8px;margin:0 0 18px;border-bottom:1px solid var(--border,#dedfd7)}.feed-tabs a{padding:8px 12px;color:var(--muted,#66766c)}.feed-tabs a.active{color:var(--heading,#173d34);border-bottom:2px solid var(--accent,#9b5e38);font-weight:700}   .follow-button{margin-top:12px;border:1px solid var(--border,#9aaba3);border-radius:6px;padding:8px 12px;background:var(--surface,#fff);color:var(--text,#1d2a27);cursor:pointer}
  .feed article[tabindex="0"]{cursor:pointer}
  .feed article[tabindex="0"]:focus-visible{outline:3px solid var(--accent,#9b5e38);outline-offset:3px}
  .open-discussion{margin-left:auto;color:var(--accent,#9b5e38);font-weight:700}
  .post-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .feed-head, .feed-head form { display:flex; flex-wrap:wrap; gap:.75rem; align-items:center; }
  .feed-head form { flex:1; }
  .feed-head input { min-width:10rem; flex:1; }
  .mobile-community-nav { display:none; }
  @media(max-width:700px) {
    .home{padding-top:0}
    .mobile-community-nav { display:none; }
  }
</style>
