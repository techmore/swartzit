<script>
  export let sourceMedia = [];
  export let uploadedMedia = [];

  let failed = {};

  function safeUrl(value) {
    const raw = String(value ?? '').trim();
    if (/^\/media\/\d+(?:\/(?:original|thumbnail))?$/.test(raw)) return raw;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port ? raw : null;
    } catch {
      return null;
    }
  }

  function normalize(value) {
    const item = typeof value === 'string' ? { kind: 'image', src: value } : value;
    if (!item || typeof item !== 'object') return null;
    const kind = item.kind === 'video' ? 'video' : item.kind === 'image' ? 'image' : null;
    const src = safeUrl(item.src);
    if (!kind || !src) return null;
    return {
      kind,
      src,
      poster: safeUrl(item.poster),
      originalSrc: safeUrl(item.original_src) || src,
      alt: String(item.alt ?? '').trim()
    };
  }

  $: allMedia = [
    ...(Array.isArray(sourceMedia) ? sourceMedia : []),
    ...(Array.isArray(uploadedMedia) ? uploadedMedia : [])
  ].map(normalize).filter(Boolean);
  $: media = allMedia.filter((item, index, items) => items.findIndex(candidate => candidate.kind === item.kind && candidate.src === item.src) === index);
  $: previews = media.slice(0, 4);
</script>

{#if previews.length}
  <div class="admin-media-previews" role="group" aria-label="Post media previews">
    <div class="admin-media-grid">
      {#each previews as item, index}
        <figure>
          {#if failed[item.src]}
            <span class="preview-failed">Preview could not load</span>
          {:else if item.kind === 'video'}
            <!-- Admin previews never autoplay; playback starts only from the native controls. -->
            <!-- svelte-ignore a11y_media_has_caption -->
            <video controls playsinline preload="none" src={item.src} poster={item.poster || undefined} aria-label={item.alt || 'Post video preview'} onerror={() => failed = { ...failed, [item.src]: true }}></video>
          {:else}
            <a href={item.originalSrc} target="_blank" rel="noopener noreferrer" aria-label="Open image in a new tab">
              <img src={item.src} alt={item.alt || 'Post image ' + (index + 1)} loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={() => failed = { ...failed, [item.src]: true }} />
            </a>
          {/if}
        </figure>
      {/each}
    </div>
    {#if media.length > previews.length}<small>+{media.length - previews.length} more attachments</small>{/if}
  </div>
{/if}

<style>
  .admin-media-previews{max-width:280px;margin:9px 0}
  .admin-media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
  .admin-media-grid figure{min-width:0;margin:0;overflow:hidden;border:1px solid var(--border,#d8ded6);border-radius:7px;background:var(--subtle,#edf1e9)}
  .admin-media-grid figure:only-child{grid-column:1/-1}
  .admin-media-grid a{display:block}
  .admin-media-grid img,.admin-media-grid video{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#151816}
  .admin-media-grid video{object-fit:contain}
  .preview-failed{display:grid;min-height:76px;place-items:center;padding:8px;color:var(--muted,#69786f);font-size:.68rem;text-align:center}
  .admin-media-previews>small{display:block;margin-top:4px;color:var(--muted,#69786f);font-size:.68rem}
</style>
