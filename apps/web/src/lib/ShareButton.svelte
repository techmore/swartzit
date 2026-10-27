<script>
  import { copyTextToClipboard } from '#lib/post-preferences.mjs';
  import Icon from '#lib/Icon.svelte';

  export let id;
  export let url = '';
  export let media = false;
  export let label = '';
  export let compact = false;
  let message = '';
  let shareUrl = '';
  let timer;

  async function share() {
    shareUrl = new URL(url || `/post/${id}`, window.location.origin).href;
    const copied = await copyTextToClipboard(shareUrl, navigator, document);
    message = copied ? 'Link copied' : 'Select and copy the link below.';
    clearTimeout(timer);
    if (copied) timer = setTimeout(() => { message = ''; }, 2200);
  }
</script>

<div class="share-control" class:compact>
  <button class:copied={message === 'Link copied'} class="share-button pill" type="button" on:click={share} aria-label={label || (media ? 'Share media' : 'Share discussion')}>
    <Icon name={message === 'Link copied' ? 'check' : 'share'} size={compact ? 14 : 16} />
    <span class="share-label">{message === 'Link copied' ? 'Copied' : 'Share'}</span>
  </button>
  <span class="visually-hidden" role="status" aria-live="polite">{message}</span>
  {#if shareUrl && message.startsWith('Select')}<input readonly value={shareUrl} aria-label={label ? `${label} URL` : media ? 'Media link' : 'Discussion link'} on:focus={(event) => event.currentTarget.select()} />{/if}
</div>

<style>
  .share-control { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .share-button { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--muted); font-size: .8rem; font-weight: 600; }
  .share-button:hover:not(:disabled) { background: var(--hover); color: var(--heading); filter: none; }
  .share-button.copied { color: var(--success); border-color: var(--success); }
  .share-control input { min-width: 240px; max-width: 100%; }
  .compact .share-button { min-height: 30px; padding: 0 10px; border-color: transparent; background: transparent; font-size: .8rem; }
  .compact .share-button:hover:not(:disabled) { background: var(--hover); }
  @media (max-width: 460px) { .share-button:not(.copied) .share-label { display: none; } .share-button { padding: 0 12px; } .compact .share-label { display: inline !important; } }
</style>
