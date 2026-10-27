<script>
  import PostActions from '#lib/PostActions.svelte';
  import PostBody from '#lib/PostBody.svelte';
  import SourcePost from '#lib/SourcePost.svelte';
  import AuthorAvatar from '#lib/AuthorAvatar.svelte';
  import PostViews from '#lib/PostViews.svelte';
  import { timeAgo, fullDate } from '#lib/time-ago.mjs';

  export let post;
  export let feed = 'timeline';

  const LONG_POST = 900;
  const EXCERPT = 420;
  const redundantSourceTitle = p => p?.source?.provider === 'x' && p.title?.trim() === p.body?.split(/\r?\n/, 1)[0]?.trim();
  const articleConfig = p => p?.source?.generation_config?.content_kind === 'article' ? p.source.generation_config : null;
  const previewMedia = p => { const item = p?.source?.media?.[0]; return typeof item === 'string' ? item : item?.kind === 'image' ? item.src : item?.poster || ''; };
  const previewLabel = p => { const c = articleConfig(p); return c ? `Article · Day ${c.unit_order || 1}${c.unit_count ? ` of ${c.unit_count}` : ''}` : 'Long post'; };
  const excerpt = body => { const text = String(body || '').replace(/^#{1,6}\s+/gm, '').replace(/[*_>`]/g, '').replace(/\s+/g, ' ').trim(); return text.length > EXCERPT ? `${text.slice(0, EXCERPT).trimEnd()}…` : text; };
  const providerName = p => p === 'youtube' ? 'YouTube' : p === 'reddit' ? 'Reddit' : 'X';

  $: provider = post.source?.provider;
  $: isExternalCard = provider === 'x' || provider === 'youtube';
  $: isPreview = Boolean(articleConfig(post)) || String(post.body || '').trim().length > LONG_POST;
  $: showTitle = !redundantSourceTitle(post) && !(provider === 'x' && /^Post by @/i.test(post.title || '')) && Boolean(post.title);
  $: rating = post.content_rating === 'r' || post.content_rating === 'x' ? post.content_rating : '';
  $: media = previewMedia(post);
  $: href = '/post/' + post.public_id;
</script>

<article class="post-card" class:source-article={Boolean(post.source)}>
  {#if feed === 'buddies' && post.liked_by?.length}
    <div class="buddy-context"><span>♥ Upvoted by</span>{#each post.liked_by as handle}<a href={'/u/' + handle}>u/{handle}</a>{/each}</div>
  {/if}

  <div class="meta">
    {#if !isExternalCard}
      <AuthorAvatar handle={provider === 'reddit' ? post.source.source_author : post.author} size="small" />
    {/if}
    <div class="meta-text">
      <a class="community" href={'/?community=' + encodeURIComponent(post.community)}>c/{post.community}</a>
      {#if provider === 'reddit'}<span class="sep" aria-hidden="true">·</span><span>From Reddit · {post.source.source_author}</span>
      {:else if !isExternalCard}<span class="sep" aria-hidden="true">·</span><a href={'/u/' + post.author}>u/{post.author}</a>{/if}
      {#if !isExternalCard}<span class="sep" aria-hidden="true">·</span><time datetime={post.created_at} title={fullDate(post.created_at)}>{timeAgo(post.created_at)}</time>{/if}
      <span class="sep" aria-hidden="true">·</span><PostViews id={post.id} initial={post} />
    </div>
    {#if rating}<span class="content-rating content-rating-{rating}" title={rating === 'r' ? 'R-rated content' : 'X-rated content'}>{rating.toUpperCase()}</span>{/if}
  </div>

  {#if showTitle}<h3 class="title"><a href={href}>{post.title}</a></h3>{/if}

  {#if isPreview}
    <div class="preview" class:no-image={!media}>
      {#if media}<a class="preview-image" href={href} tabindex="-1" aria-hidden="true"><img src={media} alt="" loading="lazy" /></a>{/if}
      <div class="preview-copy">
        <span class="preview-label">{previewLabel(post)}</span>
        <p>{excerpt(post.body)}</p>
        <a class="read-link" href={href}>{articleConfig(post) ? 'Read full article →' : 'Read full post →'}</a>
      </div>
    </div>
    <PostActions {post} />
  {:else if isExternalCard}
    <SourcePost source={post.source} text={post.body} {post} embedded={true} />
  {:else}
    <PostBody body={post.body} />
    {#if post.source}<SourcePost source={post.source} text={post.body} {post} embedded={true} />{:else}<PostActions {post} />{/if}
  {/if}
</article>

<style>
  .post-card { padding: 12px 16px; margin-bottom: 10px; transition: border-color .15s, box-shadow .15s; }
  .post-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow); }
  .meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: .78rem; color: var(--muted); }
  .meta-text { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; row-gap: 2px; }
  .community { font-weight: 700; color: var(--heading); }
  .community:hover, .meta-text a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .title { margin: 0 0 6px; font: 650 1.15rem/1.3 var(--font-sans); letter-spacing: -.015em; overflow-wrap: anywhere; }
  .title a:hover { color: var(--accent); }
  .buddy-context { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: -4px 0 12px; padding: 7px 10px; border-radius: var(--radius-sm); background: var(--wash); color: var(--muted); font-size: .78rem; }
  .buddy-context a { color: var(--heading); font-weight: 700; }
  :global(.post-card .post-body) { color: var(--text); font-size: .975rem; line-height: 1.6; }
  .preview { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px; align-items: start; margin: 2px 0 0; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface2); }
  .preview.no-image { grid-template-columns: minmax(0, 1fr); }
  .preview-image { display: block; overflow: hidden; border-radius: var(--radius-sm); aspect-ratio: 16 / 10; background: var(--subtle); }
  .preview-image img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .preview-label { display: block; color: var(--accent); font-size: .7rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .preview-copy p { display: -webkit-box; margin: 4px 0 6px; overflow: hidden; color: var(--muted); font-size: .9rem; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; }
  .read-link { color: var(--heading); font-size: .85rem; font-weight: 700; }
  .read-link:hover { color: var(--accent); }
  @media (max-width: 700px) {
    .post-card { padding: 12px 14px 10px; border-radius: 0; border-left: 0; border-right: 0; box-shadow: none; margin-bottom: 0; border-bottom: 0; }
    .post-card:hover { box-shadow: none; }
    .title { font-size: 1.2rem; }
    .preview { grid-template-columns: 96px minmax(0, 1fr); gap: 12px; padding: 10px; }
    .preview.no-image { grid-template-columns: minmax(0, 1fr); }
    .preview-copy p { -webkit-line-clamp: 3; line-clamp: 3; font-size: .85rem; }
  }
</style>
