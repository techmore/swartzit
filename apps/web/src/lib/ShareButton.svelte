<script>
  import { copyTextToClipboard } from '$lib/post-preferences.mjs';

  export let id;
  export let url = '';
  export let media = false;
  export let label = '';
  export let compact = false;
  let message = '';
  let shareUrl = '';

  async function share() {
    shareUrl = new URL(url || `/post/${id}`, window.location.origin).href;
    const copied = await copyTextToClipboard(shareUrl, navigator, document);
    message = copied ? 'Link copied to clipboard.' : 'Could not copy automatically. Select and copy the link below.';
  }
</script>

<div class="share-control" class:compact>
  <button class:copied={message.includes('copied')} class="share-button" type="button" on:click={share} aria-label={label || (media ? 'Share media' : 'Share discussion')}>
    <svg class="share-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
    </svg>
    <span>Share</span>
  </button>
  {#if message}<span role="status" aria-live="polite">{message}</span>{/if}
  {#if shareUrl && message.includes('Select and copy')}<input readonly value={shareUrl} aria-label={label ? `${label} URL` : media ? 'Media link' : 'Discussion link'} on:focus={(event) => event.currentTarget.select()} />{/if}
</div>

<style>
  .share-control{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:10px 0;color:var(--muted,#66766c);font-size:.82rem}.share-button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border,#9aaba3);border-radius:999px;padding:7px 12px;background:var(--surface,#fff);color:var(--heading,#173d34);cursor:pointer;font:inherit}.share-button:hover{background:var(--subtle,#e4e9df)}.share-button.copied{border-color:var(--link,#215e47);color:var(--link,#215e47)}.share-icon{width:1.15em;height:1.15em;flex:none}.share-control input{min-width:260px;max-width:100%;padding:7px 9px;border:1px solid var(--border,#c7ccc3);border-radius:6px;background:var(--surface,#fff);color:inherit}.share-control.compact{gap:6px;margin:0;font-size:.76rem}.share-control.compact .share-button{padding:4px 8px;font-size:.76rem}.share-control.compact .share-icon{width:1em;height:1em}.share-control.compact input{min-width:180px;padding:5px 7px}
</style>
