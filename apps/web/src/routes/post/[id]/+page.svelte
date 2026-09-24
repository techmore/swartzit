<script>
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import SessionNav from '$lib/SessionNav.svelte';
  import Brand from '$lib/Brand.svelte';
  import BookmarkButton from '$lib/BookmarkButton.svelte';
  import ShareButton from '$lib/ShareButton.svelte';
  import PostViews from '$lib/PostViews.svelte';
  import SourcePost from '$lib/SourcePost.svelte';
  import PostBody from '$lib/PostBody.svelte';
  import DrawThingsFeedback from '$lib/DrawThingsFeedback.svelte';
  import AuthorAvatar from '$lib/AuthorAvatar.svelte';
  import { mediaShareUrl } from '$lib/media-share.js';
  let commentOrder = 'oldest';
  export let data;
  let token = '', body = '', parent = null, message = '', busy = false, showAllComments = false;
  const redundantSourceTitle = post => post?.source?.provider === 'x' && post.title?.trim() === post.body?.split(/\r?\n/, 1)[0]?.trim();
  const articleConfig = post => post?.source?.generation_config?.content_kind === 'article' ? post.source.generation_config : null;
  const mediaValue = value => typeof value === 'string' ? { kind: 'image', src: value } : value;
  $: article = articleConfig(data.post);
  $: articleSeries = Array.isArray(data.article_series) ? data.article_series : [];
  $: articleIndex = articleSeries.findIndex(item => item.public_id === data.post.public_id);
  $: previousArticle = articleIndex > 0 ? articleSeries[articleIndex - 1] : null;
  $: nextArticle = articleIndex >= 0 && articleIndex < articleSeries.length - 1 ? articleSeries[articleIndex + 1] : null;
  $: previewTitle = `${data.post.title} — Swartzit`;
  $: previewDescription = (data.post.body || '').replace(/\s+/g, ' ').trim().slice(0, 240) || 'A public discussion on Swartzit.';
  $: previewMedia = mediaValue(data.post.source?.media?.[0]);
  $: shareMediaUrl = mediaShareUrl(data.post.source?.media);
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
      return result;
    } catch (error) { message = error.message || 'Could not reach Swartzit.'; return false; }
    finally { busy = false; }
  }
  async function comment() {
    const result = await send(`/api/posts/${data.post.id}/comments`, { body, parent_id: parent });
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
<header>
  <Brand />
  <SessionNav />
</header>
<main class="post-page" class:article-page={Boolean(article)}>
  <div class="post-context">
    <a class="back" href="/?community={data.post.community}">← c/{data.post.community}</a>
    <a class="community-export" href="/api/export?community={data.post.community}" download="swartzit-community-export.json">Export data ↓</a>
  </div>
  <article class="post">
    {#if data.post.content_rating === 'r' || data.post.content_rating === 'x'}<div class="content-rating-row"><span class:content-rating-r={data.post.content_rating === 'r'} class:content-rating-x={data.post.content_rating === 'x'} class="content-rating">{data.post.content_rating.toUpperCase()}</span><span>{data.post.content_rating === 'r' ? 'R-rated content' : 'X-rated content'}</span></div>{/if}
    {#if article}<div class="article-kicker"><span>ARTICLE</span><span>{article.series_title || 'Generated series'}</span><span>Day {article.unit_order || articleIndex + 1}{article.unit_count ? ` of ${article.unit_count}` : ''}</span></div>{/if}
    {#if data.post.source?.provider === 'x' || data.post.source?.provider === 'reddit' || data.post.source?.provider === 'youtube'}<div class="meta post-author"><AuthorAvatar handle={data.post.source.source_author} /> <span><strong>From {data.post.source.provider === 'x' ? 'X' : data.post.source.provider === 'reddit' ? 'Reddit' : 'YouTube'}</strong> · {data.post.source.source_author}</span></div>
    {:else}<div class="meta post-author"><AuthorAvatar handle={data.post.author} /> <span>c/{data.post.community} · <a href={'/u/' + data.post.author}>u/{data.post.author}</a></span></div>{/if}
    {#if data.post.source?.provider !== 'x'}{#if !redundantSourceTitle(data.post)}<h1>{data.post.title}</h1>{/if}{#if data.post.source?.provider !== 'youtube'}<PostBody body={data.post.body} />{/if}{/if}
    {#if data.post.source}{#key data.post.id}<SourcePost source={data.post.source} text={data.post.body} />{/key}{/if}
    {#if data.draw_feedback && data.post.source?.generation_config?.provider === 'draw_things'}
      <DrawThingsFeedback postId={data.post.id} summary={data.draw_feedback} />
    {/if}
    <div class="post-engagement"><div class="post-actions">{#key data.post.id}<BookmarkButton id={data.post.id} />{/key}
    <ShareButton id={data.post.public_id} title={data.post.title} url={shareMediaUrl} media={Boolean(shareMediaUrl)} /></div>
    <span class="local-score" aria-label="Swartzit score">{data.post.score} points</span>
    <footer class="post-reading-stats"><PostViews id={data.post.id} initial={data.post} /></footer>
    {#if token}
      <div class="vote-controls">
        <button class="vote-button icon-button upvote" disabled={busy} aria-label="Upvote" title="Upvote" on:click={() => send(`/api/posts/${data.post.id}/vote`, { value: 1 })}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 0 1-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 9.953 4.167 9.5 5 9.5h1.053c.472 0 .745.556.5.96a8.958 8.958 0 0 0-1.302 4.665c0 1.194.232 2.333.654 3.375Z" /></svg>
        </button>
        <button class="vote-button icon-button downvote" disabled={busy} aria-label="Downvote" title="Downvote" on:click={() => send(`/api/posts/${data.post.id}/vote`, { value: -1 })}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M7.498 15.25H4.372c-1.026 0-1.945-.694-2.054-1.715a12.137 12.137 0 0 1-.068-1.285c0-2.848.992-5.464 2.649-7.521C5.287 4.247 5.886 4 6.504 4h4.016a4.5 4.5 0 0 1 1.423.23l3.114 1.04a4.5 4.5 0 0 0 1.423.23h1.294M7.498 15.25c.618 0 .991.724.725 1.282A7.471 7.471 0 0 0 7.5 19.75 2.25 2.25 0 0 0 9.75 22a.75.75 0 0 0 .75-.75v-.633c0-.573.11-1.14.322-1.672.304-.76.93-1.33 1.653-1.715a9.04 9.04 0 0 0 2.86-2.4c.498-.634 1.226-1.08 2.032-1.08h.384m-10.253 1.5H9.7m8.075-9.75c.01.05.027.1.05.148.593 1.2.925 2.55.925 3.977 0 1.487-.36 2.89-.999 4.125m.023-8.25c-.076-.365.183-.75.575-.75h.908c.889 0 1.713.518 1.972 1.368.339 1.11.521 2.287.521 3.507 0 1.553-.295 3.036-.831 4.398-.306.774-1.086 1.227-1.918 1.227h-1.053c-.472 0-.745-.556-.5-.96a8.95 8.95 0 0 0 .303-.54" /></svg>
        </button>
        <button class="vote-button" disabled={busy} on:click={() => send(`/api/posts/${data.post.id}/vote`, { value: 0 })}>Clear vote</button>
      </div>
    {/if}
    </div>
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
  <section class="comments">
    <div class="comments-heading"><div><p class="eyebrow">COMMUNITY DISCUSSION</p><h2>Comments <span>{data.post.comment_count}</span></h2></div><label>Sort<select aria-label="Sort comments" bind:value={commentOrder}><option value="oldest">Oldest</option><option value="newest">Newest</option></select></label></div>
    {#if token}
      <section class="comment-compose" id="reply">
        {#if parent}<p class="replying-to">Replying to comment #{parent} <button type="button" class="text-button" on:click={() => parent = null}>Cancel</button></p>{/if}
        <form on:submit|preventDefault={comment}>
          <label class="visually-hidden" for="comment-body">Add a comment</label>
          <textarea id="comment-body" bind:value={body} required maxlength="10000" rows="3" placeholder="Add to the conversation…"></textarea>
          <div class="comment-submit"><button disabled={busy}>{busy ? 'Posting…' : 'Post comment'}</button></div>
        </form>
      </section>
    {:else}<p class="join-prompt"><a href="/login">Sign in</a> to join the discussion.</p>{/if}
    {#if data.post.source}<p class="source-replies-note">Comments here belong to Swartzit. <a href={data.post.source.source_url} target="_blank" rel="noopener noreferrer">See the original {data.post.source.provider === 'reddit' ? 'Reddit discussion' : data.post.source.provider === 'x' ? 'X replies' : 'source'} ↗</a></p>{/if}
    {#snippet thread(parentId, depth)}
      {#each children(parentId, commentOrder) as item (item.id)}
        <div style:margin-left={depth > 0 ? '16px' : '0'}>
          <article id={'comment-' + item.id}>
            <div class="meta comment-author"><AuthorAvatar handle={item.author} size="small" /><span><a href={'/u/' + item.author}>u/{item.author}</a> · {new Date(item.created_at).toLocaleDateString()}</span></div>
            <p>{item.body}</p>
            {#if token}<a href="#reply" on:click={() => parent = item.id}>Reply</a>{/if}
          </article>
          {@render thread(item.id, depth + 1)}
        </div>
      {/each}
    {/snippet}
    {@render thread(null, 0)}
    {#if !data.comments.length}<p>No comments yet.</p>{/if}
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
  .post-page{max-width:780px;padding-top:32px;padding-bottom:80px}
  .article-page{max-width:1120px;display:grid;grid-template-columns:minmax(0,780px) 250px;column-gap:36px;align-items:start}
  .article-page>.post-context{grid-column:1/-1}
  .article-page>.post,.article-page>.form-error,.article-page>.comments,.article-page>.content-loop{grid-column:1}
  .post-context{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
  .back,.community-export{font-size:.82rem;color:var(--muted,#66766c)}
  .community-export{font-size:.76rem;text-decoration:underline;text-underline-offset:3px}
  .post{padding:20px 24px}
  .content-rating-row{display:flex;align-items:center;gap:8px;margin:0 0 12px;color:var(--muted,#66766c);font-size:.72rem;font-weight:750;text-transform:uppercase;letter-spacing:.06em}
  .content-rating{width:22px;height:22px;display:inline-grid;place-items:center;border:1px solid transparent;border-radius:6px;font:800 .7rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:0}
  .content-rating-r{background:#9b5e38;border-color:#9b5e38;color:#fff}
  .content-rating-x{background:#6f263d;border-color:#6f263d;color:#fff}
  .article-kicker{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;color:var(--accent,#9b5e38);font-size:.7rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
  .article-kicker span+span{padding-left:8px;border-left:1px solid var(--border,#d8d5ca);color:var(--muted,#77827d);font-weight:650;letter-spacing:.03em;text-transform:none}
  .article-rail{grid-column:2;grid-row:2 / span 4;position:sticky;top:92px;padding:18px 16px;border:1px solid var(--border,#d8d5ca);border-radius:12px;background:var(--surface,#fff)}
  .article-rail .eyebrow{margin:0 0 8px;font-size:.66rem;letter-spacing:.14em;color:var(--accent,#9b5e38);font-weight:800}
  .article-rail h2{margin:0;color:var(--heading,#173d34);font:500 1.35rem/1.15 Georgia,serif;overflow-wrap:anywhere}
  .article-rail-count{margin:7px 0 14px;color:var(--muted,#77827d);font-size:.75rem}
  .article-rail ol{display:grid;gap:4px;margin:0;padding:0;list-style:none}
  .article-rail li a{display:grid;gap:3px;padding:9px 10px;border-radius:8px;color:var(--muted,#66766c);text-decoration:none}
  .article-rail li a:hover{background:var(--subtle,#e4e9df);color:var(--heading,#173d34)}
  .article-rail li.current a{background:var(--subtle,#e4e9df);color:var(--heading,#173d34);box-shadow:inset 3px 0 var(--accent,#9b5e38)}
  .article-rail li span{font-size:.66rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--accent,#9b5e38)}
  .article-rail li strong{font-size:.78rem;line-height:1.25;font-weight:700;overflow-wrap:anywhere}
  .article-rail-nav{display:flex;justify-content:space-between;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border,#d8d5ca);font-size:.72rem;font-weight:750}
  .article-rail-nav a{color:var(--accent,#9b5e38)}
  .post-engagement{display:flex;align-items:center;gap:14px;flex-wrap:wrap;border-top:1px solid var(--border,#dedfd7);padding-top:10px;margin-top:14px}
  .post-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .local-score{font-size:.78rem;color:var(--muted,#77827d)}
  .post-engagement :global(.vote-controls){margin:0 0 0 auto;gap:6px}
  .post-engagement :global(.vote-button.icon-button){width:36px;height:36px;padding:6px}
  .post-engagement :global(.vote-button.icon-button svg){width:21px;height:21px}
  .post-engagement .vote-button:not(.icon-button){padding:6px 8px;background:transparent;color:var(--muted,#66766c);font-size:.74rem}
  .post-reading-stats{border:0!important;padding:4px 0!important;margin:0!important;font-size:.72rem!important}
  .comments{border-top:1px solid var(--border,#d8d5ca);margin-top:32px;padding-top:24px}
  .comments-heading{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:16px}
  .comments-heading .eyebrow{margin:0 0 4px;font-size:.66rem;letter-spacing:.14em}
  .comments-heading h2{font:500 1.7rem/1.1 Georgia,serif;color:var(--heading,#173d34);margin:0}
  .comments-heading h2 span{font:500 .9rem ui-sans-serif,system-ui,sans-serif;color:var(--muted,#77827d);vertical-align:middle}
  .comments-heading label{display:flex;align-items:center;gap:8px;color:var(--muted,#77827d);font-size:.78rem}
  .comments-heading select{width:auto;padding:7px 28px 7px 9px;font-size:.8rem}
  .comment-compose{margin:16px 0 22px;padding:12px;border:1px solid var(--border,#d8d5ca);border-radius:10px;background:var(--surface,#fff)}
  .comment-compose form{gap:8px}
  .comment-compose textarea{border:0;padding:4px;background:transparent;resize:vertical;min-height:64px}
  .comment-submit{display:flex;justify-content:flex-end}
  .comment-submit button{border-radius:6px;padding:8px 13px;font-size:.84rem}
  .join-prompt,.source-replies-note,.replying-to{font-size:.82rem;color:var(--muted,#77827d);margin:10px 0 18px}
  .join-prompt a,.source-replies-note a{color:var(--link,#215e47);font-weight:650}
  .replying-to{display:flex;align-items:center;gap:8px;margin:0 0 6px}
  .text-button{background:transparent;color:var(--link,#215e47);padding:0;font-size:.78rem}
  .visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  :global(.post-views){color:var(--muted,#77827d)}
  .content-loop{border-top:1px solid var(--border,#d8d5ca);margin-top:52px;padding-top:28px}
  .comment-expansion{border-top:1px solid var(--border,#dedfd7);margin-top:24px;padding-top:20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  .comment-expansion p{color:var(--muted,#77827d);margin:0}
  .comment-expansion button{border-radius:6px;padding:10px 14px}
  .content-loop .eyebrow{font-size:.72rem;letter-spacing:.16em;color:var(--accent,#9b5e38);font-weight:700}
  .content-loop h2{font:500 1.8rem/1.15 Georgia,serif;color:var(--heading,#173d34);margin:10px 0 8px}
  .loop-copy{color:var(--muted,#53615d);margin:0 0 20px;max-width:620px}
  .related-posts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .related-post{display:flex;flex-direction:column;gap:8px;border:1px solid var(--border,#dedfd7);border-radius:8px;background:var(--surface,#fff);padding:16px;transition:border-color .15s ease,transform .15s ease}
  .related-post:hover{border-color:var(--accent,#9b5e38);transform:translateY(-1px)}
  .related-post strong{font:600 1.05rem/1.25 Georgia,serif;color:var(--heading,#173d34)}
  .related-post span{font-size:.8rem;color:var(--muted,#77827d)}
  .browse-link{color:var(--accent,#9b5e38);font-weight:700;font-size:.9rem}
  @media(max-width:900px){.article-page{display:block}.article-rail{position:static;margin:0 0 24px}.article-page>.post{margin-top:0}}
  @media(max-width:700px){.related-posts{grid-template-columns:1fr}.content-loop h2{font-size:1.55rem}.post{padding:16px 14px}.post-engagement{gap:8px}.post-engagement :global(.vote-controls){margin-left:auto}.comments-heading h2{font-size:1.5rem}}
  @media(max-width:420px){.post-page{padding-left:14px;padding-right:14px}.post-context{margin:0 4px 12px}.post-context .back{font-size:.78rem}.post-context .community-export{font-size:.72rem}.post{padding-left:10px;padding-right:10px}.comments-heading{align-items:center}.comments-heading label{gap:5px}}
</style>
