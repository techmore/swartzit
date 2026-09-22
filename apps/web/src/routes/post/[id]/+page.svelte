<script>
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import SessionNav from '$lib/SessionNav.svelte';
  import BookmarkButton from '$lib/BookmarkButton.svelte';
  import ShareButton from '$lib/ShareButton.svelte';
  import PostViews from '$lib/PostViews.svelte';
  import SourcePost from '$lib/SourcePost.svelte';
  import AuthorAvatar from '$lib/AuthorAvatar.svelte';
  let commentOrder = 'oldest';
  export let data;
  let token = '', body = '', parent = null, message = '', busy = false;
  const redundantSourceTitle = post => post?.source?.provider === 'x' && post.title?.trim() === post.body?.split(/\r?\n/, 1)[0]?.trim();
  const mediaValue = value => typeof value === 'string' ? { kind: 'image', src: value } : value;
  $: previewTitle = `${data.post.title} — Swartzit`;
  $: previewDescription = (data.post.body || '').replace(/\s+/g, ' ').trim().slice(0, 240) || 'A public discussion on Swartzit.';
  $: previewMedia = mediaValue(data.post.source?.media?.[0]);
  $: canonicalUrl = `https://stoverparc.org/post/${data.post.public_id}`;
  onMount(() => {
    token = localStorage.getItem('swartzit_session') || '';
    const timer = setInterval(() => { if (!document.hidden) invalidateAll(); }, 300000);
    return () => clearInterval(timer);
  });
  async function send(path, payload) {
    busy = true; message = '';
    try {
      const response = await fetch(path, { method: 'POST', headers: {
        'content-type': 'application/json', authorization: `Bearer ${token}`
      }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Please try again.');
      await invalidateAll();
      return true;
    } catch (error) { message = error.message || 'Could not reach Swartzit.'; return false; }
    finally { busy = false; }
  }
  async function comment() {
    if (await send(`/api/posts/${data.post.id}/comments`, { body, parent_id: parent })) {
      body = ''; parent = null;
    }
  }
  function children(comments, id, order) { return comments.filter(comment => comment.parent_id === id).sort((a,b) => order === 'newest' ? b.id-a.id : a.id-b.id); }
</script>
<svelte:head>
  <title>{previewTitle}</title>
  <meta name="description" content={previewDescription} />
  <link rel="canonical" href={canonicalUrl} />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Swartzit" />
  <meta property="og:title" content={previewTitle} />
  <meta property="og:description" content={previewDescription} />
  <meta property="og:url" content={canonicalUrl} />
  {#if previewMedia?.src}<meta property="og:image" content={previewMedia.poster || previewMedia.src} /><meta property="og:image:alt" content={previewMedia.alt || previewTitle} />{/if}
  <meta name="twitter:card" content={previewMedia?.src ? 'summary_large_image' : 'summary'} />
  <meta name="twitter:title" content={previewTitle} />
  <meta name="twitter:description" content={previewDescription} />
</svelte:head>
<header>
  <a class="brand" href="/">swartzit</a>
  <a href="/api/export?community={data.post.community}" download="swartzit-community-export.json">Export community</a>
  <SessionNav />
</header>
<main class="post-page">
  <a class="back" href="/?community={data.post.community}">← c/{data.post.community}</a>
  <article class="post">
    {#if data.post.source?.provider !== 'x'}<div class="meta post-author">
{#if data.post.source?.provider === 'x'}<AuthorAvatar handle={data.post.source.source_author} /> <span><strong>From X</strong> · {data.post.source.source_author}</span>
{:else}<AuthorAvatar handle={data.post.author} /> <span>c/{data.post.community} · u/{data.post.author}</span>{/if}
</div>{/if}
    {#if data.post.source?.provider !== 'x'}{#if !redundantSourceTitle(data.post)}<h1>{data.post.title}</h1>{/if}<p>{data.post.body}</p>{/if}
    {#if data.post.source}{#key data.post.id}<SourcePost source={data.post.source} text={data.post.body} />{/key}{/if}
    <div class="post-actions">{#key data.post.id}<BookmarkButton id={data.post.id} />{/key}
    <ShareButton id={data.post.public_id} title={data.post.title} /></div>
    <footer><span>{data.post.score} points</span><span>{data.post.comment_count} comments</span></footer>
    {#key data.post.id}<PostViews id={data.post.id} initial={data.post} />{/key}
    {#if token}
      <div class="vote-controls">
        <button class="vote-button" disabled={busy} on:click={() => send(`/api/posts/${data.post.id}/vote`, { value: 1 })}>Upvote</button>
        <button class="vote-button" disabled={busy} on:click={() => send(`/api/posts/${data.post.id}/vote`, { value: -1 })}>Downvote</button>
        <button class="vote-button" disabled={busy} on:click={() => send(`/api/posts/${data.post.id}/vote`, { value: 0 })}>Clear vote</button>
      </div>
    {/if}
  </article>
  {#if message}<p role="alert" class="form-error">{message}</p>{/if}
  {#if token}
    <section class="comment-compose" id="reply">
      <h2>{parent ? 'Reply to comment #' + parent : 'Join the conversation'}</h2>
      <form on:submit|preventDefault={comment}>
        <label for="comment-body">Your comment</label>
        <textarea id="comment-body" bind:value={body} required maxlength="10000" rows="4"></textarea>
        <button disabled={busy}>{busy ? 'Saving…' : 'Post comment'}</button>
        {#if parent}<button type="button" on:click={() => parent = null}>Cancel reply</button>{/if}
      </form>
    </section>
  {:else}<p><a href="/login">Sign in</a> to comment or vote. Everyone can read the discussion.</p>{/if}
  <section class="comments">
    <h2>Comments</h2>
    <label>Swartzit comment order <select bind:value={commentOrder}><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>
    {#if data.post.source}<p class="muted">These are local comments. Original replies remain on the source site.</p>{/if}
    {#snippet thread(parentId, depth)}
      {#each children(data.comments, parentId, commentOrder) as item (item.id)}
        <div style:margin-left={depth > 0 ? '16px' : '0'}>
          <article id={'comment-' + item.id}>
            <div class="meta comment-author"><AuthorAvatar handle={item.author} size="small" /><span>u/{item.author} · {new Date(item.created_at).toLocaleDateString()}</span></div>
            <p>{item.body}</p>
            {#if token}<a href="#reply" on:click={() => parent = item.id}>Reply</a>{/if}
          </article>
          {@render thread(item.id, depth + 1)}
        </div>
      {/each}
    {/snippet}
    {@render thread(null, 0)}
    {#if !data.comments.length}<p>No comments yet.</p>{/if}
    {#if data.comments_truncated}<p>Showing the first 500 comments.</p>{/if}
  </section>
</main>
<style>
  .post-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
</style>
