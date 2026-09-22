<script>
  export let id;
  let message = '';
  let shareUrl = '';
  async function share() {
    shareUrl = new URL(`/post/${id}`, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(shareUrl);
      message = 'Copied to clipboard';
    } catch (error) {
      message = 'Copy the link below';
    }
  }
</script>
<div class="share-control">
  <button class="share-button" type="button" on:click={share} aria-label="Share discussion">↗ Share</button>
  {#if message}<span role="status" aria-live="polite">{message}</span>{/if}
  {#if shareUrl && message === 'Copy the link below'}<input readonly value={shareUrl} aria-label="Discussion link" on:focus={(event) => event.currentTarget.select()} />{/if}
</div>
<style>
  .share-control{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:10px 0;color:var(--muted,#66766c);font-size:.82rem}.share-button{border:1px solid var(--border,#9aaba3);border-radius:999px;padding:7px 12px;background:var(--surface,#fff);color:var(--heading,#173d34);cursor:pointer;font:inherit}.share-button:hover{background:var(--subtle,#e4e9df)}.share-control input{min-width:260px;max-width:100%;padding:7px 9px;border:1px solid var(--border,#c7ccc3);border-radius:6px;background:var(--surface,#fff);color:inherit}
</style>
