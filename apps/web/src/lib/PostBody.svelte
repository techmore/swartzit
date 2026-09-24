<script>
  import { parsePostBody } from '$lib/post-body.mjs';
  export let body = '';
  $: parsed = parsePostBody(body);
</script>

<div class="post-body">
  {#if parsed.text}<p>{parsed.text}</p>{/if}
  {#each parsed.embeds as embed}
    <div class="youtube-post-embed">
      <iframe src={embed.embed_url} title="Embedded YouTube video" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      <a href={embed.source_url} target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a>
    </div>
  {/each}
</div>

<style>
  .post-body p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
  .youtube-post-embed{position:relative;margin:14px 0 2px;overflow:hidden;background:#111;border-radius:8px;aspect-ratio:16/9}
  .youtube-post-embed iframe{display:block;width:100%;height:100%;border:0}
  .youtube-post-embed>a{position:absolute;right:8px;bottom:8px;padding:4px 7px;border-radius:5px;background:#000b;color:#fff;font-size:.72rem;text-decoration:none}
  .youtube-post-embed>a:hover,.youtube-post-embed>a:focus-visible{background:#000;color:#fff;text-decoration:underline}
</style>
