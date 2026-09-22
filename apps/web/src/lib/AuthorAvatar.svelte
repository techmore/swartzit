<script>
  export let handle = '';
  export let size = 'normal';
  $: name = String(handle).replace(/^u\//, '').trim() || '?';
  $: initials = name.split(/[^a-zA-Z0-9]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
  $: hue = [...name].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 360, 0);
</script>
<span class:small={size === 'small'} class="author-avatar" style={`--avatar-hue:${hue}`} role="img" aria-label={`Avatar for u/${name}`} title={`u/${name}`}>{initials}</span>
<style>
  .author-avatar{display:inline-grid;flex:0 0 34px;width:34px;height:34px;place-items:center;border-radius:50%;background:hsl(var(--avatar-hue) 30% 38%);color:#fff;font-size:.72rem;font-weight:750;letter-spacing:.02em;line-height:1;vertical-align:middle}.author-avatar.small{width:28px;height:28px;flex-basis:28px;font-size:.64rem}
</style>
