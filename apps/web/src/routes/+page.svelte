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
  function pageLink(page) { return '/?' + new URLSearchParams({community:data.community,q:data.q,sort:data.sort,page:String(page)}); }
  let token = '', title = '', body = '', community = data.communities[0]?.slug ?? '', formError = '', formMessage = '';
  const redundantSourceTitle = post => post?.source?.provider === 'x' && post.title?.trim() === post.body?.split(/\r?\n/, 1)[0]?.trim();
  onMount(() => {
    token = localStorage.getItem('swartzit_session') ?? '';
    const timer = setInterval(() => { if (!document.hidden) invalidateAll(); }, 300000);
    return () => clearInterval(timer);
  });
  async function createPost() { formError = ''; formMessage = ''; const response = await fetch('/api/posts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ community, title, body }) }); const result = await response.json(); if (!response.ok) { formError = result.error ?? 'Could not publish discussion'; return; } window.location.assign(`/post/${result.id}`); }
</script>

<svelte:head><title>Swartzit — the commons</title></svelte:head>
<header><a class="brand" href="/">swartzit</a><span>Read freely. Participate under a pseudonym. Take your community with you.</span><a href="/api/export" download="swartzit-export.json">Export public data</a><SessionNav /></header>
<main>
  <section class="intro"><p class="eyebrow">THE OPEN DISCUSSION NETWORK</p><h1>Conversations that belong to their communities.</h1><p>Public posts and comments stay readable without an account. Join when you’re ready to contribute.</p></section>
  <div class="layout"><aside class="community-nav"><h2>Communities</h2><a class="selected" href="/">All discussions</a>{#each data.communities as community}<a href="/?community={community.slug}"><strong>c/{community.slug}</strong><small>{community.post_count} posts</small></a>{/each}</aside><section class="feed"><details class="mobile-community-nav"><summary>Browse communities <span>{data.community ? `c/${data.community}` : 'All discussions'}</span></summary><div><a class="selected" href="/">All discussions</a>{#each data.communities as community}<a href="/?community={community.slug}"><strong>c/{community.slug}</strong><small>{community.post_count} posts</small></a>{/each}</div></details><div class="feed-head"><h2>Discussions</h2><form><input type="hidden" name="community" value={data.community} /><input name="q" value={data.q} placeholder="Search discussions" aria-label="Search discussions" /><select name="sort" aria-label="Sort discussions" value={data.sort}><option value="newest">Newest imports / posts</option><option value="score">Swartzit votes</option><option value="views">Swartzit views</option><option value="engaged">Swartzit engaged views</option><option value="comments">Swartzit comments</option><option value="source_views">X views</option><option value="source_likes">X likes</option><option value="source_reposts">X reposts</option><option value="source_replies">X replies</option></select><button>Apply</button></form></div>{#if data.posts.length === 0}<p class="empty">No discussions found.</p>{:else}{#each data.posts as post (post.id)}<article>{#if post.source?.provider !== 'x'}<div class="meta">
{#if post.source?.provider === 'x'}<AuthorAvatar handle={post.source.source_author} size="small" /><span><strong>From X</strong><span> · </span><span>{post.source.source_author}</span><span> · </span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></span>
{:else}<AuthorAvatar handle={post.author} size="small" /><span><a href="/?community={post.community}">c/{post.community}</a><span> · </span><span>posted by u/{post.author}</span><span> · </span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></span>{/if}
</div>{/if}{#if post.source?.provider === 'x'}<SourcePost source={post.source} text={post.body} />{:else}{#if !redundantSourceTitle(post)}<h3><a href="/post/{post.id}">{post.title}</a></h3>{/if}<p>{post.body}</p>{#if post.source}<SourcePost source={post.source} text={post.body} />{/if}{/if}<div class="post-actions"><BookmarkButton id={post.id} /><ShareButton id={post.id} title={post.title} /></div><footer><span>↕ {post.score}</span><span>{post.view_count} views</span><a href="/post/{post.id}">{post.comment_count} comments</a></footer></article>{/each}{/if}<nav aria-label="Discussion pages">{#if data.page > 1}<a href={pageLink(data.page - 1)}>← Previous</a>{/if} {#if data.hasMore}<a href={pageLink(data.page + 1)}>Next →</a>{/if}</nav></section></div>
{#if token}<section class="compose"><h2>Start a discussion</h2><form on:submit|preventDefault={createPost}><label>Community<select bind:value={community}>{#each data.communities as item}<option value={item.slug}>c/{item.slug}</option>{/each}</select></label><label>Title<input bind:value={title} required maxlength="300" /></label><label>Body<textarea bind:value={body} maxlength="50000" rows="5"></textarea></label><button>Publish</button>{#if formError}<p class="form-error">{formError}</p>{/if}{#if formMessage}<p class="form-message">{formMessage}</p>{/if}</form></section>{/if}
</main>
<MediaDock />
<style>
  .feed{min-width:0;max-width:650px}
  .post-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .feed-head, .feed-head form { display:flex; flex-wrap:wrap; gap:.75rem; align-items:center; }
  .feed-head form { flex:1; }
  .feed-head input { min-width:10rem; flex:1; }
  .mobile-community-nav { display:none; }
  @media(max-width:700px) {
    .intro,.mobile-community-nav,.feed-head { display:none; }
  }
</style>
