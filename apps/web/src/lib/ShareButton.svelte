<script>
  import { requestNativeShare } from '$lib/share-action.mjs';

  export let id;
  export let url = '';
  export let media = false;
  export let label = '';
  export let compact = false;
  let message = '';
  let shareUrl = '';

  function legacyCopy(value) {
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    input.setSelectionRange(0, input.value.length);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    input.remove();
    return copied;
  }

  async function copyLink(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return legacyCopy(value);
    }
  }

  async function share() {
    shareUrl = new URL(url || `/post/${id}`, window.location.origin).href;
    const shareData = {
      title: document.title,
      text: media ? 'Check out this media on Swartzit.' : 'Join this discussion on Swartzit.',
      url: shareUrl
    };

    // Invoke the native chooser directly from this click so browsers that
    // require a user gesture (including mobile browsers) allow Signal to open.
    const outcome = await requestNativeShare(navigator, shareData);
    if (outcome === 'shared') {
      message = 'Shared.';
      return;
    }
    if (outcome === 'cancelled') {
      message = 'Sharing cancelled.';
      return;
    }

    const copied = await copyLink(shareUrl);
    message = copied
      ? 'Share menu unavailable. Link copied; paste it into Signal.'
      : 'Could not open the share menu or copy the link. Copy it below.';
  }
</script>

<div class="share-control" class:compact>
  <button class:copied={message.includes('copied')} class="share-button" type="button" on:click={share} aria-label={label || (media ? 'Share media' : 'Share discussion')}>↗ Share</button>
  {#if message}<span role="status" aria-live="polite">{message}</span>{/if}
  {#if shareUrl && message.includes('Copy it below')}<input readonly value={shareUrl} aria-label={label ? `${label} URL` : media ? 'Media link' : 'Discussion link'} on:focus={(event) => event.currentTarget.select()} />{/if}
</div>

<style>
  .share-control{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:10px 0;color:var(--muted,#66766c);font-size:.82rem}.share-button{border:1px solid var(--border,#9aaba3);border-radius:999px;padding:7px 12px;background:var(--surface,#fff);color:var(--heading,#173d34);cursor:pointer;font:inherit}.share-button:hover{background:var(--subtle,#e4e9df)}.share-button.copied{border-color:var(--link,#215e47);color:var(--link,#215e47)}.share-control input{min-width:260px;max-width:100%;padding:7px 9px;border:1px solid var(--border,#c7ccc3);border-radius:6px;background:var(--surface,#fff);color:inherit}.share-control.compact{gap:6px;margin:0;font-size:.76rem}.share-control.compact .share-button{padding:4px 8px;font-size:.76rem}.share-control.compact input{min-width:180px;padding:5px 7px}
</style>
