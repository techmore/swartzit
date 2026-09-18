<script>
  export let source;
  let loaded = false;
  const count = n => n == null ? '—' : new Intl.NumberFormat().format(n);
</script>
<section class="source-post" aria-label="Original source">
  <div><strong>{source.provider === 'x' ? 'From X' : 'Wikimedia Commons'} · {source.source_author}</strong>
  <a href={source.source_url} target="_blank" rel="noopener noreferrer">Open original ↗</a></div>
  {#if source.published_at}<small>Originally published {new Date(source.published_at).toLocaleString()}</small>{/if}
  {#if source.provider === 'x'}<p class="source-metrics">X: {count(source.source_views)} views · {count(source.source_likes)} likes · {count(source.source_reposts)} reposts · {count(source.source_replies)} replies</p>
  <small>Snapshot {new Date(source.observed_at).toLocaleString()} · — means not captured. X counts are separate from Swartzit activity.</small>{/if}
  {#if source.attribution}<p>{source.attribution}</p>{/if}
  {#if source.media?.length}
    {#if !loaded}<button type="button" onclick={() => loaded = true}>Load {source.media.length} source image{source.media.length === 1 ? '' : 's'}</button><small>Loads directly from the source image host.</small>
    {:else}<div class="source-images">{#each source.media as url}<img src={url} alt={'Image shared by ' + source.source_author} loading="lazy" referrerpolicy="no-referrer" />{/each}</div>{/if}
  {/if}
</section>
<style>
  .source-post{border-left:3px solid #89a28c;background:#f0f3ec;padding:14px;margin:16px 0;font-size:.85rem}
  .source-post>div:first-child{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap}
  a{color:#215e47;text-decoration:underline}
  small{display:block;color:#66766c;margin:6px 0}
  .source-post p{margin:8px 0}
  button{padding:9px 13px;border-radius:6px;margin-top:8px;cursor:pointer}
  .source-images{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
  img{width:100%;max-height:600px;object-fit:contain}
</style>
