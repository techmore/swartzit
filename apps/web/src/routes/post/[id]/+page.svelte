<script>
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import Icon from '#lib/Icon.svelte';
  import PostViews from '#lib/PostViews.svelte';
  import PostActions from '#lib/PostActions.svelte';
  import SourcePost from '#lib/SourcePost.svelte';
  import PostBody from '#lib/PostBody.svelte';
  import DrawThingsFeedback from '#lib/DrawThingsFeedback.svelte';
  import AuthorAvatar from '#lib/AuthorAvatar.svelte';
  import ShareButton from '#lib/ShareButton.svelte';
  import ContentRatingControl from '#lib/ContentRatingControl.svelte';
  import { parseCommentDraft } from '#lib/comment-source.mjs';
  import { loginHref } from '#lib/auth-session.mjs';
  let commentOrder = 'oldest';
  export let data;
  let token = '', body = '', parent = null, message = '', busy = false, showAllComments = false;
  $: commentDraft = parseCommentDraft(body);
  const redundantSourceTitle = post => post?.source?.provider === 'x' && post.title?.trim() === post.body?.split(/\r?\n/, 1)[0]?.trim();
  const articleConfig = post => post?.source?.generation_config?.content_kind === 'article' ? post.source.generation_config : null;
  const mediaValue = value => typeof value === 'string' ? { kind: 'image', src: value } : value;
  const sourceProviderLabel = provider => provider === 'reddit' ? 'Reddit' : provider === 'youtube' ? 'YouTube' : 'X';
  $: article = articleConfig(data.post);
  $: articleSeries = Array.isArray(data.article_series) ? data.article_series : [];
  $: articleIndex = articleSeries.findIndex(item => item.public_id === data.post.public_id);
  $: previousArticle = articleIndex > 0 ? articleSeries[articleIndex - 1] : null;
  $: nextArticle = articleIndex >= 0 && articleIndex < articleSeries.length - 1 ? articleSeries[articleIndex + 1] : null;
  $: previewTitle = `${data.post.title} — Swartzit`;
  $: previewDescription = (data.post.body || '').replace(/\s+/g, ' ').trim().slice(0, 240) || 'A public discussion on Swartzit.';
  $: previewMedia = mediaValue(data.post.source?.media?.[0]);
  $: canonicalUrl = data.canonical_url;
  onMount(() => {
    token = localStorage.getItem('swartzit_session') || '';
    const commentId = window.location.hash.match(/^#comment-(\d+)$/)?.[1];
    if (commentId && data.comments.some(comment => String(comment.id) === commentId)) {
      showAllComments = true;
      requestAnimationFrame(() => document.getElementById(`comment-${commentId}`)?.scrollIntoView({ block: 'start' }));
    }
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
      return result;
    } catch (error) { message = error.message || 'Could not reach Swartzit.'; return false; }
    finally { busy = false; }
  }
  async function comment() {
    if (commentDraft.error) { message = commentDraft.error; return; }
    if (!commentDraft.body && !commentDraft.sourceUrl) { message = 'Write a comment or paste a supported source link.'; return; }
    const result = commentDraft.sourceUrl
      ? await send('/api/comment-cross-post', {
        post_id: data.post.id, parent_id: parent, body: commentDraft.body, url: commentDraft.sourceUrl
      })
      : await send(`/api/posts/${data.post.id}/comments`, { body: commentDraft.body, parent_id: parent });
    if (result) {
      body = ''; parent = null;
      message = result.status === 'pending' ? (result.message ?? 'Your comment is waiting for moderator review.') : '';
    }
  }
  $: visibleComments = showAllComments ? data.comments : data.comments.slice(0, 50);
  function children(id, order) { return visibleComments.filter(comment => comment.parent_id === id).sort((a,b) => order === 'newest' ? b.id-a.id : a.id-b.id); }
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
<main id="main-content" class="post-page" class:article-page={Boolean(article)}>
  <div class="post-context">
    <a class="back" href="/?community={data.post.community}"><Icon name="arrow-left" size={16} />c/{data.post.community}</a>
    <a class="community-export" href="/api/export?community={data.post.community}" download="swartzit-community-export.json">Export data ↓</a>
  </div>
  <article class="post">
    <ContentRatingControl postId={data.post.id} rating={data.post.content_rating} on:update={(event) => data = { ...data, post: { ...data.post, content_rating: event.detail.content_rating } }} />
    {#if data.post.content_rating === 'r' || data.post.content_rating === 'x'}<div class="content-rating-row"><span class:content-rating-r={data.post.content_rating === 'r'} class:content-rating-x={data.post.content_rating === 'x'} class="content-rating">{data.post.content_rating.toUpperCase()}</span><span>{data.post.content_rating === 'r' ? 'R-rated content' : 'X-rated content'}</span></div>{/if}
    {#if article}<div class="article-kicker"><span>ARTICLE</span><span>{article.series_title || 'Generated series'}</span><span>Day {article.unit_order || articleIndex + 1}{article.unit_count ? ` of ${article.unit_count}` : ''}</span></div>{/if}
    {#if data.post.source?.provider === 'x' || data.post.source?.provider === 'reddit' || data.post.source?.provider === 'youtube'}<div class="meta post-author"><AuthorAvatar handle={data.post.source.source_author} /> <span><strong>From {data.post.source.provider === 'x' ? 'X' : data.post.source.provider === 'reddit' ? 'Reddit' : 'YouTube'}</strong> · {data.post.source.source_author}</span></div>
    {:else}<div class="meta post-author"><AuthorAvatar handle={data.post.author} /> <span>c/{data.post.community} · <a href={'/u/' + data.post.author}>u/{data.post.author}</a></span></div>{/if}
    {#if data.post.source?.provider !== 'x'}{#if !redundantSourceTitle(data.post)}<h1>{data.post.title}</h1>{/if}{#if data.post.source?.provider !== 'youtube'}<PostBody body={data.post.body} />{/if}{/if}
    {#if data.post.source}{#key data.post.id}<SourcePost source={data.post.source} text={data.post.body} />{/key}{/if}
    {#if data.draw_feedback && data.post.source?.generation_config?.provider === 'draw_things'}
      <DrawThingsFeedback postId={data.post.id} summary={data.draw_feedback} />
    {/if}
    {#key data.post.id}<PostActions post={data.post} />{/key}
    <footer class="post-reading-stats"><PostViews id={data.post.id} initial={data.post} /></footer>
  </article>
  {#if article}
    <aside class="article-rail" aria-label="Article series navigation">
      <p class="eyebrow">IN THIS SERIES</p>
      <h2>{article.series_title || data.post.title}</h2>
      <p class="article-rail-count">{articleSeries.length || article.unit_count || 1} day{(articleSeries.length || article.unit_count || 1) === 1 ? '' : 's'} · long-form article</p>
      {#if articleSeries.length}<ol>{#each articleSeries as item}<li class:current={item.public_id === data.post.public_id}><a href={'/post/' + item.public_id}><span>Day {item.unit_order}</span><strong>{item.title.replace(/^.*? · Day \d+: /, '')}</strong></a></li>{/each}</ol>{/if}
      <div class="article-rail-nav">{#if previousArticle}<a href={'/post/' + previousArticle.public_id}>← Previous day</a>{/if}{#if nextArticle}<a href={'/post/' + nextArticle.public_id}>Next day →</a>{/if}</div>
    </aside>
  {/if}
  {#if message}<p role="alert" class="form-error">{message}</p>{/if}
  <section class="comments" id="comments">
    <div class="comments-heading"><div><p class="eyebrow">COMMUNITY DISCUSSION</p><h2>Comments <span>{data.post.comment_count}</span></h2></div><label>Sort<select aria-label="Sort comments" bind:value={commentOrder}><option value="oldest">Oldest</option><option value="newest">Newest</option></select></label></div>
    {#if token}
      <section class="comment-compose" id="reply">
        {#if parent}<p class="replying-to">Replying to comment #{parent} <button type="button" class="text-button" on:click={() => parent = null}>Cancel</button></p>{/if}
        <form on:submit|preventDefault={comment}>
          <label class="visually-hidden" for="comment-body">Add a comment</label>
          <textarea id="comment-body" bind:value={body} maxlength="10000" rows="3" placeholder="Add to the conversation or paste an X, Reddit, or YouTube link…"></textarea>
          {#if commentDraft.sourceUrl}<p class="comment-source-hint">{sourceProviderLabel(commentDraft.provider)} link detected. It will appear as a cross-post in the thread.</p>{/if}
          {#if commentDraft.error}<p class="comment-source-error" role="alert">{commentDraft.error}</p>{/if}
          <div class="comment-submit"><button disabled={busy || Boolean(commentDraft.error) || (!commentDraft.body && !commentDraft.sourceUrl)}>{busy ? 'Posting…' : 'Post comment'}</button></div>
        </form>
      </section>
    {:else}<p class="join-prompt"><a href={loginHref(`/post/${data.post.public_id}#reply`)}>Sign in</a> to join the discussion.</p>{/if}
    {#if data.post.source}<p class="source-replies-note">Comments here belong to Swartzit. <a href={data.post.source.source_url} target="_blank" rel="noopener noreferrer">See the original {data.post.source.provider === 'reddit' ? 'Reddit discussion' : data.post.source.provider === 'x' ? 'X replies' : 'source'} ↗</a></p>{/if}
    {#snippet thread(parentId, depth)}
      {#each children(parentId, commentOrder) as item (item.id)}
        <div class:nested={depth > 0}>
          <article id={'comment-' + item.id}>
            <div class="meta comment-author"><AuthorAvatar handle={item.author} size="small" /><span><a href={'/u/' + item.author}>u/{item.author}</a> · {new Date(item.created_at).toLocaleDateString()}</span></div>
            {#if item.body}<p>{item.body}</p>{/if}
            {#if item.source}<div class="comment-source"><SourcePost source={item.source} text={item.source.body} embedded={true} /></div>{/if}
            <div class="comment-actions">
              {#if token}<a href="#reply" on:click={() => parent = item.id}>Reply</a>{/if}
              <ShareButton id={data.post.public_id} url={`/post/${data.post.public_id}#comment-${item.id}`} label="Share comment" compact={true} />
            </div>
          </article>
          {@render thread(item.id, depth + 1)}
        </div>
      {/each}
    {/snippet}
    <div class="thread">{@render thread(null, 0)}</div>
    {#if !data.comments.length}<p class="muted">No comments yet. Start the conversation.</p>{/if}
    {#if !showAllComments && data.comments.length > 50}
      <div class="comment-expansion">
        <p>Showing the first 50 comments of this deep thread.</p>
        <button type="button" on:click={() => showAllComments = true}>Show all {data.comments.length} comments</button>
      </div>
    {/if}
    {#if data.comments_truncated}<p>Showing the first 500 comments.</p>{/if}
  </section>
  {#if data.post.comment_count >= 50}
    <section class="content-loop" aria-label="Continue exploring">
      <p class="eyebrow">KEEP EXPLORING</p>
      <h2>More conversations in c/{data.post.community}</h2>
      <p class="loop-copy">This thread runs deep. Keep the discussion moving with another conversation from the community.</p>
      {#if data.related_posts?.length}
        <div class="related-posts">
          {#each data.related_posts as related (related.id)}
            <a class="related-post" href="/post/{related.public_id}">
              <strong>{related.title}</strong>
              <span>{related.comment_count} comments · {related.score} points</span>
            </a>
          {/each}
        </div>
      {:else}
        <a class="browse-link" href="/?community={data.post.community}">Browse all discussions in c/{data.post.community} →</a>
      {/if}
    </section>
  {/if}
</main>
<style>
  .post-page { max-width: 760px; padding-top: 20px; padding-bottom: 96px; }
  .article-page { max-width: 1120px; display: grid; grid-template-columns: minmax(0, 760px) 260px; column-gap: 36px; align-items: start; }
  .article-page > .post-context { grid-column: 1 / -1; }
  .article-page > .post, .article-page > .form-error, .article-page > .comments, .article-page > .content-loop { grid-column: 1; }
  .post-context { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
  .back { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px 6px 8px; border-radius: 999px; font-size: .85rem; font-weight: 600; color: var(--muted); }
  .back:hover { background: var(--hover); color: var(--heading); }
  .community-export { font-size: .78rem; color: var(--muted); text-decoration: underline; text-underline-offset: 3px; }
  .post { padding: 26px 30px; }
  .post :global(h1) { margin: 6px 0 14px; font: 600 clamp(1.7rem, 3.4vw, 2.3rem)/1.2 var(--font-serif); letter-spacing: -.02em; overflow-wrap: anywhere; }
  .post :global(.post-body) { font-size: 1.05rem; line-height: 1.7; }
  .post-author { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: .875rem; color: var(--muted); }
  .post-author a { font-weight: 700; color: var(--heading); }
  .post-author a:hover { text-decoration: underline; }
  .article-kicker { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 14px; color: var(--accent); font-size: .72rem; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  .article-kicker span + span { padding-left: 8px; border-left: 1px solid var(--border-strong); color: var(--muted); font-weight: 600; letter-spacing: 0; text-transform: none; }
  .article-rail { grid-column: 2; grid-row: 2 / span 4; position: sticky; top: calc(var(--header-h) + 20px); padding: 18px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .article-rail h2 { margin: 0; font: 600 1.25rem/1.2 var(--font-serif); overflow-wrap: anywhere; }
  .article-rail-count { margin: 7px 0 14px; color: var(--muted); font-size: .78rem; }
  .article-rail ol { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .article-rail li a { display: grid; gap: 3px; padding: 9px 10px; border-radius: var(--radius-sm); color: var(--muted); }
  .article-rail li a:hover { background: var(--hover); color: var(--heading); }
  .article-rail li.current a { background: var(--accent-soft); color: var(--heading); box-shadow: inset 3px 0 var(--accent); }
  .article-rail li span { font-size: .66rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--accent); }
  .article-rail li strong { font-size: .8rem; line-height: 1.3; overflow-wrap: anywhere; }
  .article-rail-nav { display: flex; justify-content: space-between; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); font-size: .78rem; font-weight: 700; }
  .article-rail-nav a { color: var(--accent); }
  .post-reading-stats { margin: 10px 0 0; font-size: .75rem; color: var(--text-light); }

  .comments { margin-top: 36px; }
  .comments-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
  .comments-heading h2 { margin: 0; font: 600 1.5rem/1.1 var(--font-serif); }
  .comments-heading h2 span { font: 600 .9rem var(--font-sans); color: var(--muted); margin-left: 6px; }
  .comments-heading label { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: .8rem; }
  .comments-heading select { width: auto; min-height: 34px; padding: 4px 8px; border-radius: 999px; font-size: .8rem; }
  .comment-compose { margin: 0 0 22px; padding: 12px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface); }
  .comment-compose:focus-within { border-color: var(--accent); box-shadow: var(--ring); }
  .comment-compose form { gap: 8px; }
  .comment-compose textarea { border: 0; padding: 4px; background: transparent; resize: vertical; min-height: 72px; box-shadow: none; }
  .comment-compose textarea:focus-visible { box-shadow: none; }
  .comment-submit { display: flex; justify-content: flex-end; }
  .comment-source-hint, .comment-source-error { margin: 0; color: var(--muted); font-size: .8rem; }
  .comment-source-error { color: var(--danger); }
  .comment-source { margin-top: 10px; }
  .comment-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .comment-actions > a { padding: 4px 10px; border-radius: 999px; font-size: .8rem; font-weight: 600; color: var(--muted); }
  .comment-actions > a:hover { background: var(--hover); color: var(--heading); }
  .join-prompt, .source-replies-note, .replying-to { font-size: .875rem; color: var(--muted); margin: 10px 0 18px; }
  .join-prompt { padding: 14px 16px; border-radius: var(--radius); background: var(--wash); }
  .join-prompt a, .source-replies-note a { color: var(--link); font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
  .replying-to { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; }
  .thread article { margin: 0; padding: 14px 0; border: 0; border-top: 1px solid var(--border); border-radius: 0; background: transparent; box-shadow: none; }
  .thread article p { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .thread .nested { margin-left: 14px; padding-left: 14px; border-left: 2px solid var(--border); }
  .comment-author { display: flex; align-items: center; gap: 8px; font-size: .8rem; color: var(--muted); }
  .comment-author a { font-weight: 700; color: var(--heading); }
  .comment-expansion { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .comment-expansion p { color: var(--muted); margin: 0; }

  .content-loop { border-top: 1px solid var(--border); margin-top: 48px; padding-top: 26px; }
  .content-loop h2 { font: 600 1.5rem/1.2 var(--font-serif); margin: 6px 0 8px; }
  .loop-copy { color: var(--muted); margin: 0 0 18px; max-width: 60ch; }
  .related-posts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .related-post { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 16px; transition: border-color .15s, transform .15s; }
  .related-post:hover { border-color: var(--accent); transform: translateY(-1px); }
  .related-post strong { font-size: 1rem; line-height: 1.3; color: var(--heading); }
  .related-post span { font-size: .8rem; color: var(--muted); }
  .browse-link { color: var(--accent); font-weight: 700; }
  @media (max-width: 960px) { .article-page { display: block; } .article-rail { position: static; margin: 0 0 24px; } }
  @media (max-width: 700px) {
    .related-posts { grid-template-columns: 1fr; }
    .post { padding: 18px 16px; margin-left: -16px; margin-right: -16px; border-radius: 0; border-left: 0; border-right: 0; }
    .post-context { margin-bottom: 8px; }
  }
</style>
