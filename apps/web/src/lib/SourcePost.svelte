<script>
  export let source;
  const count = n => n == null ? '—' : new Intl.NumberFormat().format(n);
  let failed = {};
  const attachment = m => typeof m === 'string' ? {kind:'image',src:m} : m;
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
<section class="source-post" aria-label="Original source">
  <div class="source-heading">
    {#if source.provider === 'x' && source.profile_image_url}
      <span class="profile-hover" role="button" tabindex="0" aria-label={`Preview ${source.profile_display_name || source.source_author} profile`}>
        <img class="source-avatar" src={`/profile-images/${source.post_id}`} alt="" loading="lazy" onerror={(event) => event.currentTarget.src = source.profile_image_url} />
        <div class="profile-card" role="tooltip">
          <div class="profile-card-heading"><img src={`/profile-images/${source.post_id}`} alt="" /><div><strong>{source.profile_display_name || source.source_author}</strong>{#if source.profile_verified}<span class="verified" aria-label="Verified">✓</span>{/if}<small>{source.profile_url ? new URL(source.profile_url).pathname : source.source_author}</small></div></div>
          {#if source.profile_bio}<p>{source.profile_bio}</p>{/if}
          <div class="profile-stats">{#if source.profile_followers != null}<span><strong>{count(source.profile_followers)}</strong> followers</span>{/if}{#if source.profile_following != null}<span><strong>{count(source.profile_following)}</strong> following</span>{/if}</div>
          {#if source.profile_url}<a href={source.profile_url} target="_blank" rel="noopener noreferrer">Open profile ↗</a>{/if}
        </div>
      </span>
    {/if}
    <strong>{source.provider === 'x' ? 'From X' : 'Wikimedia Commons'} · {source.profile_display_name || source.source_author}</strong>
  <a href={source.source_url} target="_blank" rel="noopener noreferrer">Open original ↗</a></div>
  {#if source.published_at}<small>Originally published {new Date(source.published_at).toLocaleString()}</small>{/if}
  {#if source.provider === 'x'}<p class="source-metrics">X: {count(source.source_views)} views · {count(source.source_likes)} likes · {count(source.source_reposts)} reposts · {count(source.source_replies)} replies</p>
  <small>Snapshot {new Date(source.observed_at).toLocaleString()} · — means not captured. X counts are separate from Swartzit activity.</small>{/if}
  {#if source.attribution}<p>{source.attribution}</p>{/if}
  {#if source.media?.length}
    <div class="source-images count-{source.media.length > 4 ? 'many' : source.media.length}">
      {#each source.media as item}
        {@const media = attachment(item)}
        <figure>
          {#if failed[media.src]}<p>This browser could not load the {media.kind === 'video' ? 'video' : 'image'}. <a href={source.source_url} target="_blank" rel="noopener noreferrer">View original post</a></p>
          {:else if media.kind === 'video'}
            <!-- Source videos have no caption tracks available. -->
            <!-- svelte-ignore a11y_media_has_caption -->
            <video use:observeMedia={media} muted controls playsinline preload="metadata" src={media.src} poster={media.poster || undefined} aria-label={media.alt || 'Video shared by '+source.source_author} onplay={(event) => announcePlay(event, media)} onpause={announcePause} onended={announceEnded} onerror={() => failed={...failed,[media.src]:true}}></video>
          {:else}<a href={media.src} target="_blank" rel="noopener noreferrer"><img src={media.src} alt={media.alt || 'Image shared by '+source.source_author} loading="lazy" referrerpolicy="no-referrer" onerror={() => failed={...failed,[media.src]:true}} /></a>{/if}
          {#if media.kind === 'video' || media.alt}<figcaption>{media.alt || ''}{#if media.kind === 'video'} <a href={media.src} target="_blank" rel="noopener noreferrer">Open video ↗</a>{/if}</figcaption>{/if}
        </figure>
      {/each}
    </div><small>Photos and videos load directly from the source host. Videos autoplay muted while visible and pause when scrolled away.</small>
  {/if}
</section>
<style>
  .source-post{border-left:3px solid var(--border,#89a28c);background:var(--subtle,#f0f3ec);padding:14px;margin:16px 0;font-size:.85rem}
  .source-post>div:first-child{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap}
  .source-heading{align-items:center}.source-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;background:var(--subtle,#dde3da)}
  .profile-hover{position:relative;display:flex;align-items:center;outline:none}.profile-hover:focus-visible .source-avatar{box-shadow:0 0 0 3px var(--link,#215e47)}
  .profile-card{position:absolute;z-index:5;top:42px;left:0;width:280px;padding:14px;border:1px solid var(--border,#89a28c);border-radius:10px;background:var(--surface,#fff);box-shadow:0 8px 24px #0003;visibility:hidden;opacity:0;transform:translateY(-4px);transition:opacity .12s,transform .12s,visibility .12s;pointer-events:none}
  .profile-hover:hover .profile-card,.profile-hover:focus-within .profile-card,.profile-hover:focus .profile-card{visibility:visible;opacity:1;transform:translateY(0);pointer-events:auto}
  .profile-card-heading{display:flex;gap:10px;align-items:center}.profile-card-heading img{width:44px;height:44px;border-radius:50%;object-fit:cover}.profile-card-heading small{margin:2px 0 0}.profile-card p{font-size:.9rem;line-height:1.35}.profile-stats{display:flex;gap:12px;font-size:.8rem;color:var(--muted,#66766c)}.verified{display:inline-grid;place-items:center;width:16px;height:16px;margin-left:4px;border-radius:50%;background:var(--link,#215e47);color:white;font-size:.7rem}
  a{color:var(--link,#215e47);text-decoration:underline}
  small{display:block;color:var(--muted,#66766c);margin:6px 0}
  .source-post p{margin:8px 0}
  .source-images{display:grid;gap:8px;margin:8px 0;max-width:680px}
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
