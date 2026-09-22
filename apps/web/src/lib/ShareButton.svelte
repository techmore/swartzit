<script>
  export let id;
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
  async function share() {
    shareUrl = new URL(`/post/${id}`, window.location.origin).href;
    let copied = false;
    try {
      await navigator.clipboard.writeText(shareUrl);
      copied = true;
    } catch { copied = legacyCopy(shareUrl); }
    message = copied ? 'Copied to clipboard' : 'Copy the link below';
  }
</script>
<div class="share-control">
  <button class:copied={message === 'Copied to clipboard'} class="share-button" type="button" on:click={share} aria-label="Share discussion">{message === 'Copied to clipboard' ? '✓ Copied' : '↗ Share'}</button>
  {#if message}<span role="status" aria-live="polite">{message}</span>{/if}
  {#if shareUrl && message === 'Copy the link below'}<input readonly value={shareUrl} aria-label="Discussion link" on:focus={(event) => event.currentTarget.select()} />{/if}
</div>
<style>
  .share-control{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:10px 0;color:var(--muted,#66766c);font-size:.82rem}.share-button{border:1px solid var(--border,#9aaba3);border-radius:999px;padding:7px 12px;background:var(--surface,#fff);color:var(--heading,#173d34);cursor:pointer;font:inherit}.share-button:hover{background:var(--subtle,#e4e9df)}.share-button.copied{border-color:var(--link,#215e47);color:var(--link,#215e47)}.share-control input{min-width:260px;max-width:100%;padding:7px 9px;border:1px solid var(--border,#c7ccc3);border-radius:6px;background:var(--surface,#fff);color:inherit}
</style>
