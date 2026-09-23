<script>
  export let source;
  export let text = '';
  const count = n => n == null ? '—' : new Intl.NumberFormat().format(n);
  let failed = {};
  let activeMedia = 0;
  const attachment = m => typeof m === 'string' ? {kind:'image',src:m} : m;
  const clean = value => String(value ?? '').trim();
  function cleanSourceText(value) {
    let body = clean(value);
    // X syndication sometimes appends its own video title, player clock and
    // engagement counts to extracted profile-page text. The actual video is
    // rendered from source.media, so keep that player chrome out of the copy.
    body = body.replace(/\nFrom\s*\n[^\n]+\n\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}[\s\S]*$/i, '');
    const lines = body.split(/\r?\n/);
    while (lines.length) {
      const line = lines[0].trim();
      if (!line || line === source.profile_display_name || line === source.source_author || line === '·' || line === 'Fan account' || /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/i.test(line)) lines.shift();
      else break;
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function splitPost(value) {
    const match = clean(value).match(/^(.*?)(?:\n\nQuoted post by (@[^:]+):\s*)([\s\S]*)$/i);
    return match ? { text: match[1].trim(), quotedAuthor: match[2].trim(), quotedText: match[3].trim() } : { text: clean(value), quotedAuthor: '', quotedText: '' };
  }
  $: parsed = splitPost(source.provider === 'x' ? cleanSourceText(text) : text);
  $: displayDate = source.published_at
    ? new Date(source.published_at).toLocaleDateString()
    : source.provider === 'x'
      ? clean(text).split(/\r?\n/).map(line => line.trim()).find(line => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/i.test(line))
      : null;
  $: sourceMetrics = (source.provider === 'reddit'
    ? [['Score', source.source_likes, '▲'], ['Comments', source.source_replies, '💬']]
    : [['Likes', source.source_likes, '♥'], ['Reposts', source.source_reposts, '↻'], ['Replies', source.source_replies, '💬'], ['Views', source.source_views, '◉']])
    .filter(([, value]) => value != null);
  $: providerLabel = source.provider === 'x' ? 'X' : source.provider === 'reddit' ? 'Reddit' : 'Wikimedia Commons';
  $: mediaCount = source.media?.length ?? 0;
  $: if (activeMedia >= mediaCount) activeMedia = Math.max(0, mediaCount - 1);
  function moveMedia(delta) {
    if (mediaCount < 2) return;
    activeMedia = (activeMedia + delta + mediaCount) % mediaCount;
  }
  function announcePlay(event, media) {
    window.dispatchEvent(new CustomEvent('swartzit-media-play', { detail: { element: event.currentTarget, media, source } }));
  }
  function announcePause(event) {
    window.dispatchEvent(new CustomEvent('swartzit-media-pause', { detail: { element: event.currentTarget } }));
  }
  function announceEnded(event) {
    window.dispatchEvent(new CustomEvent('swartzit-media-ended', { detail: { element: event.currentTarget } }));
  }
  function observeMedia(node, media) {
    // Muted inline playback is allowed by mobile browsers. Keep only the
    // visible card playing so scrolling never leaves background video running.
    node.muted = true;
    const autoplayEnabled = () => {
      try { return localStorage.getItem('swartzit_autoplay') !== 'off'; } catch { return true; }
    };
    const preferenceChanged = (event) => {
      if (!event.detail?.enabled && !node.paused) node.pause();
      if (event.detail?.enabled && node.getBoundingClientRect().top < innerHeight && node.getBoundingClientRect().bottom > 0) node.play().catch(() => {});
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (autoplayEnabled() && entry.isIntersecting && entry.intersectionRatio >= 0.45) {
        node.muted = true;
        node.play().catch(() => {});
      } else if (!node.paused) node.pause();
    }, { threshold: [0, 0.45] });
    observer.observe(node);
    window.addEventListener('swartzit-autoplay-change', preferenceChanged);
    return { destroy: () => { observer.disconnect(); window.removeEventListener('swartzit-autoplay-change', preferenceChanged); } };
  }
</script>
<section class="source-post" class:external-x={source.provider === 'x'} aria-label={`Imported ${providerLabel} post`}>
  <div class="source-heading">
    {#if source.provider === 'x' && source.profile_image_url}
      <span class="profile-hover" role="button" tabindex="0" aria-label={`Preview ${source.profile_display_name || source.source_author} profile`}>
        <img class="source-avatar" src={`/profile-images/${source.post_id}`} alt="" loading="lazy" onerror={(event) => event.currentTarget.hidden = true} />
        <div class="profile-card" role="tooltip">
          <div class="profile-card-heading"><img src={`/profile-images/${source.post_id}`} alt="" onerror={(event) => event.currentTarget.hidden = true} /><div><strong>{source.profile_display_name || source.source_author}</strong>{#if source.profile_verified}<span class="verified" aria-label="Verified">✓</span>{/if}<small>{source.profile_url ? new URL(source.profile_url).pathname : source.source_author}</small></div></div>
          {#if source.profile_bio}<p>{source.profile_bio}</p>{/if}
          <div class="profile-stats">{#if source.profile_followers != null}<span><strong>{count(source.profile_followers)}</strong> followers</span>{/if}{#if source.profile_following != null}<span><strong>{count(source.profile_following)}</strong> following</span>{/if}</div>
          {#if source.profile_url}<a href={source.profile_url} target="_blank" rel="noopener noreferrer">Open profile ↗</a>{/if}
        </div>
      </span>
    {:else}<span class="source-avatar source-avatar-fallback" aria-hidden="true">{(source.profile_display_name || source.source_author || '?').slice(0, 1).toUpperCase()}</span>
    {/if}
    <div class="source-identity"><strong>{source.profile_display_name || source.source_author}</strong>{#if source.profile_verified}<span class="verified" aria-label="Verified">✓</span>{/if}<span class="source-handle">{source.source_author}</span>{#if displayDate}<time datetime={source.published_at || undefined}>{displayDate}</time>{/if}</div>
    <div class="source-right"><span class="provider-badge">{source.provider === 'x' ? '𝕏' : source.provider === 'reddit' ? 'Reddit' : 'Commons'}</span><a class="source-link" href={source.source_url} target="_blank" rel="noopener noreferrer" aria-label={`View original on ${providerLabel}`}>↗</a></div></div>
  {#if source.provider === 'x'}
    {#if parsed.text}<p class="source-text">{parsed.text}</p>{/if}
    {#if parsed.quotedText}<blockquote class="quoted-post"><strong>{parsed.quotedAuthor}</strong><p>{parsed.quotedText}</p></blockquote>{/if}
    {#if sourceMetrics.length}<div class="source-metrics" aria-label="X metrics"><div class="source-metric-items">{#each sourceMetrics as [label, value, icon]}<span title={label}>{icon} {count(value)}</span>{/each}</div><small>Source counts · {new Date(source.observed_at).toLocaleDateString()}</small></div>{/if}
  {:else}
    {#if source.published_at}<small>Originally published {new Date(source.published_at).toLocaleString()}</small>{/if}
    {#if source.attribution}<p>{source.attribution}</p>{/if}
    {#if sourceMetrics.length}<div class="source-metrics" aria-label={`${providerLabel} metrics`}><div class="source-metric-items">{#each sourceMetrics as [label, value, icon]}<span title={label}>{icon} {count(value)}</span>{/each}</div><small>Source counts · {new Date(source.observed_at).toLocaleDateString()}</small></div>{/if}
  {/if}
  {#if source.media?.length}
    <div class:carousel-shell={source.media.length > 1} class="media-shell">
      {#if source.media.length > 1}<button class="carousel-button previous" type="button" aria-label="Previous media" onclick={() => moveMedia(-1)}>‹</button>{/if}
      <div class="source-images count-{source.media.length > 4 ? 'many' : source.media.length} {source.media.length > 1 ? 'carousel-images' : ''}">
      {#each source.media as item, index}
        {@const media = attachment(item)}
        <figure class:carousel-slide={source.media.length > 1} class:inactive={source.media.length > 1 && index !== activeMedia}>
          {#if failed[media.src]}<p>This browser could not load the {media.kind === 'video' ? 'video' : 'image'}. <a href={source.source_url} target="_blank" rel="noopener noreferrer">View original post</a></p>
          {:else if media.kind === 'video'}
            <!-- Source videos have no caption tracks available. -->
            <!-- svelte-ignore a11y_media_has_caption -->
            <video use:observeMedia={media} muted controls playsinline preload="metadata" src={media.src} poster={media.poster || undefined} aria-label={media.alt || 'Video shared by '+source.source_author} onplay={(event) => announcePlay(event, media)} onpause={announcePause} onended={announceEnded} onerror={() => failed={...failed,[media.src]:true}}></video>
          {:else}<a href={media.src} target="_blank" rel="noopener noreferrer"><img src={media.src} alt={media.alt || 'Image shared by '+source.source_author} loading="lazy" referrerpolicy="no-referrer" onerror={() => failed={...failed,[media.src]:true}} /></a>{/if}
          {#if media.kind === 'video' || media.alt}<figcaption>{media.alt || ''}{#if media.kind === 'video'} <a href={media.src} target="_blank" rel="noopener noreferrer">Open video ↗</a>{/if}</figcaption>{/if}
        </figure>
      {/each}
      </div>
      {#if source.media.length > 1}<button class="carousel-button next" type="button" aria-label="Next media" onclick={() => moveMedia(1)}>›</button>{/if}
    </div>
    {#if source.media.length > 1}<div class="carousel-status" aria-live="polite"><span>Photo {activeMedia + 1} of {source.media.length}</span><div class="carousel-dots" aria-label="Choose media">{#each source.media as _, index}<button class:active={index === activeMedia} type="button" aria-label={`Show media ${index + 1}`} aria-current={index === activeMedia ? 'true' : undefined} onclick={() => activeMedia = index}></button>{/each}</div></div>{/if}
  {/if}
  {#if source.provider === 'reddit' && source.source_comments?.length}
    <details class="source-comments">
      <summary>Top Reddit comments ({source.source_comments.length})</summary>
      <div class="source-comment-list">
        {#each source.source_comments as comment}
          <article class="source-comment">
            <div><strong>{comment.author}</strong>{#if comment.score != null}<span>{comment.score} points</span>{/if}{#if comment.created_at}<time datetime={comment.created_at}>{new Date(comment.created_at).toLocaleDateString()}</time>{/if}</div>
            <p>{comment.body}</p>
          </article>
        {/each}
      </div>
    </details>
  {/if}
</section>
<style>
  .source-post{border:1px solid var(--border,#c7d0c6);border-radius:12px;background:var(--surface,#fff);padding:14px 16px;margin:14px 0;font-size:.92rem}
  .source-post>div:first-child{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap}
  .source-heading{align-items:center}.source-avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;background:var(--subtle,#dde3da)}.source-avatar-fallback{display:grid;place-items:center;font-weight:700;color:var(--link,#215e47)}
  .source-identity{display:flex;align-items:center;gap:7px;flex-wrap:wrap;flex:1}.source-identity strong{font-size:.92rem}.source-handle,.source-identity time{font-size:.78rem;color:var(--muted,#66766c)}.source-right{display:flex;align-items:center;gap:8px}.provider-badge{font-size:.8rem;color:var(--muted,#66766c);font-weight:700}.source-link{font-size:1.1rem;text-decoration:none}
  .profile-hover{position:relative;display:flex;align-items:center;outline:none}.profile-hover:focus-visible .source-avatar{box-shadow:0 0 0 3px var(--link,#215e47)}
  .profile-card{position:absolute;z-index:5;top:42px;left:0;width:280px;padding:14px;border:1px solid var(--border,#89a28c);border-radius:10px;background:var(--surface,#fff);box-shadow:0 8px 24px #0003;visibility:hidden;opacity:0;transform:translateY(-4px);transition:opacity .12s,transform .12s,visibility .12s;pointer-events:none}
  .profile-hover:hover .profile-card,.profile-hover:focus-within .profile-card,.profile-hover:focus .profile-card{visibility:visible;opacity:1;transform:translateY(0);pointer-events:auto}
  .profile-card-heading{display:flex;gap:10px;align-items:center}.profile-card-heading img{width:44px;height:44px;border-radius:50%;object-fit:cover}.profile-card-heading small{margin:2px 0 0}.profile-card p{font-size:.9rem;line-height:1.35}.profile-stats{display:flex;gap:12px;font-size:.8rem;color:var(--muted,#66766c)}.verified{display:inline-grid;place-items:center;width:16px;height:16px;margin-left:4px;border-radius:50%;background:var(--link,#215e47);color:white;font-size:.7rem}
  a{color:var(--link,#215e47);text-decoration:underline}
  small{display:block;color:var(--muted,#66766c);margin:6px 0}
  .source-post p{margin:8px 0}.source-text{font-size:1rem;line-height:1.5;white-space:pre-wrap;color:var(--text,#1d2a27)}.quoted-post{border-left:3px solid var(--border,#c7d0c6);margin:12px 0;padding:8px 12px;background:var(--subtle,#f5f7f3);color:var(--muted,#53615d)}.quoted-post p{margin:4px 0 0;white-space:pre-wrap}.source-metrics{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--muted,#66766c);margin:10px 0 0!important;font-size:.76rem}.source-metric-items{display:flex;gap:12px}.source-metrics small{font-size:.68rem;margin:0 0 0 auto}
  .source-comments{margin-top:12px;border-top:1px solid var(--border,#c7d0c6);padding-top:10px}.source-comments summary{cursor:pointer;color:var(--muted,#66766c);font-size:.78rem;font-weight:700}.source-comment-list{display:grid;gap:9px;margin-top:10px}.source-comment{padding:9px 10px;border-left:2px solid var(--border,#c7d0c6);background:var(--subtle,#f5f7f3)}.source-comment>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--muted,#66766c);font-size:.72rem}.source-comment>div strong{color:var(--heading,#173d34)}.source-comment>div time{margin-left:auto}.source-comment p{margin:5px 0 0!important;white-space:pre-wrap;font-size:.82rem;line-height:1.4}
  .source-images{display:grid;gap:8px;margin:8px 0;max-width:680px}
  .media-shell{position:relative}.carousel-shell{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px}.carousel-images{display:block;min-height:220px}.carousel-slide.inactive{display:none}.carousel-button{width:36px;height:36px;border:1px solid var(--border,#c7d0c6);border-radius:50%;background:var(--surface,#fff);color:var(--text,#15251b);font-size:1.8rem;line-height:1;cursor:pointer}.carousel-button:hover{background:var(--subtle,#f0f3ec)}.carousel-status{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:680px;color:var(--muted,#66766c);font-size:.78rem}.carousel-dots{display:flex;gap:5px}.carousel-dots button{width:7px;height:7px;padding:0;border:0;border-radius:50%;background:var(--border,#c7d0c6);cursor:pointer}.carousel-dots button.active{background:var(--link,#215e47);transform:scale(1.25)}
  figure{margin:0;min-width:0} figcaption{margin-top:6px;color:var(--muted,#66766c)}
  .source-images img,.source-images video{width:100%;max-height:600px;object-fit:contain;background:var(--subtle,#dde3da);display:block}
  .count-1{grid-template-columns:1fr}
  .count-1 img{aspect-ratio:16/9;max-height:510px}
  .count-2{grid-template-columns:1fr 1fr}
  .count-2 img{aspect-ratio:16/9}
  .count-3{grid-template-columns:1fr 1fr}
  .count-3 figure:first-child{grid-column:1/-1}
  .count-3 img{aspect-ratio:16/9}
  .count-4,.count-many{grid-template-columns:1fr 1fr}
  .count-4 img,.count-many img{aspect-ratio:16/9}
</style>
