<script>
  export let communities = [];
  export let value = '';
  export let id = 'community-picker';
  export let label = 'Community';
  export let placeholder = 'Search communities…';
  let query = '';
  let open = false;
  let highlighted = 0;
  let blurTimer;

  $: if (!query && value) query = value;
  $: normalizedQuery = query.trim().replace(/^c\//i, '').toLowerCase();
  $: filtered = communities
    .filter(item => !normalizedQuery || `${item.slug} ${item.name} ${item.description ?? ''}`.toLowerCase().includes(normalizedQuery))
    .slice(0, 10);

  function update(event) {
    query = event.currentTarget.value;
    value = '';
    highlighted = 0;
    open = true;
  }

  function choose(item) {
    value = item.slug;
    query = item.slug;
    open = false;
  }

  function show() {
    clearTimeout(blurTimer);
    if (value && query === value) query = '';
    open = true;
  }

  function hide() {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => { open = false; }, 120);
  }

  function keydown(event) {
    if (!filtered.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = (highlighted + 1) % filtered.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = (highlighted - 1 + filtered.length) % filtered.length;
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      choose(filtered[highlighted]);
    } else if (event.key === 'Escape') {
      open = false;
    }
  }
</script>

<div class="community-picker">
  <label for={id}>{label}
    <input
      id={id}
      type="search"
      value={query}
      placeholder={placeholder}
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={`${id}-options`}
      aria-label={label}
      oninput={update}
      onfocus={show}
      onblur={hide}
      onkeydown={keydown}
    />
  </label>
  {#if open && filtered.length}
    <div class="community-options" id={`${id}-options`} role="listbox">
      {#each filtered as item, index}
        <button type="button" role="option" aria-selected={item.slug === value} class:highlighted={index === highlighted} onclick={() => choose(item)}>
          <strong>c/{item.slug}</strong><span>{item.name}</span>
        </button>
      {/each}
    </div>
  {:else if open && query}
    <p class="no-results" role="status">No communities match “{query}”.</p>
  {/if}
  {#if query && !value}<small>Choose a community from the results.</small>{/if}
</div>

<style>
  .community-picker{position:relative;min-width:0}
  label{display:grid;gap:5px;color:var(--muted,#66766c);font-size:.77rem;font-weight:700}
  input{width:100%;height:40px;border:1px solid var(--border,#c7ccc3);border-radius:7px;padding:9px 10px;background:var(--page,#f6f4ee);color:inherit;font:inherit}
  .community-options{position:absolute;z-index:8;right:0;left:0;top:calc(100% + 4px);max-height:240px;overflow:auto;padding:4px;border:1px solid var(--border,#c7ccc3);border-radius:8px;background:var(--surface,#fff);box-shadow:0 12px 28px #0002}
  .community-options button{display:flex;align-items:baseline;gap:8px;width:100%;padding:8px 9px;border:0;border-radius:5px;background:transparent;color:var(--text,#1d2a27);text-align:left;cursor:pointer;font:inherit}
  .community-options button:hover,.community-options button.highlighted{background:var(--subtle,#e4e9df)}
  .community-options strong{color:var(--heading,#173d34);font-size:.82rem}
  .community-options span{overflow:hidden;color:var(--muted,#66766c);font-size:.75rem;text-overflow:ellipsis;white-space:nowrap}
  .no-results,small{display:block;margin:5px 0 0;color:var(--muted,#66766c);font-size:.7rem}
  .no-results{position:absolute;z-index:8;right:0;left:0;top:calc(100% + 4px);padding:10px;border:1px solid var(--border,#c7ccc3);border-radius:8px;background:var(--surface,#fff);box-shadow:0 12px 28px #0002}
</style>
