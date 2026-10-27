<script>
  import { parseMarkdown } from '#lib/markdown.mjs';
  let { source = '' } = $props();
  const blocks = $derived(parseMarkdown(source));
  // The page already has one <h1>, so body headings start at <h2>.
  const level = n => Math.min(n + 1, 6);
</script>

{#snippet inline(nodes)}
  {#each nodes as node}
    {#if node.type === 'text'}{node.value}
    {:else if node.type === 'br'}<br />
    {:else if node.type === 'strong'}<strong>{@render inline(node.children)}</strong>
    {:else if node.type === 'em'}<em>{@render inline(node.children)}</em>
    {:else if node.type === 'code'}<code>{node.value}</code>
    {:else if node.type === 'link'}<a href={node.href} target="_blank" rel="noopener noreferrer nofollow ugc">{@render inline(node.children)}</a>
    {/if}
  {/each}
{/snippet}

{#snippet list(node)}
  {#if node.ordered}
    <ol start={node.start}>{#each node.items as item}<li>{@render inline(item.inline)}{#each item.children as child}{@render list(child)}{/each}</li>{/each}</ol>
  {:else}
    <ul>{#each node.items as item}<li>{@render inline(item.inline)}{#each item.children as child}{@render list(child)}{/each}</li>{/each}</ul>
  {/if}
{/snippet}

{#snippet render(nodes)}
  {#each nodes as block}
    {#if block.type === 'heading'}
      <svelte:element this={`h${level(block.level)}`}>{@render inline(block.children)}</svelte:element>
    {:else if block.type === 'paragraph'}<p>{@render inline(block.children)}</p>
    {:else if block.type === 'list'}{@render list(block)}
    {:else if block.type === 'quote'}<blockquote>{@render render(block.children)}</blockquote>
    {:else if block.type === 'code'}<pre><code>{block.value}</code></pre>
    {:else if block.type === 'rule'}<hr />
    {/if}
  {/each}
{/snippet}

<div class="markdown">{@render render(blocks)}</div>

<style>
  .markdown { overflow-wrap: anywhere; }
  .markdown > :global(:first-child) { margin-top: 0; }
  .markdown > :global(:last-child) { margin-bottom: 0; }
  .markdown :global(p) { margin: 0 0 1em; }
  .markdown :global(h2), .markdown :global(h3), .markdown :global(h4), .markdown :global(h5), .markdown :global(h6) { margin: 1.6em 0 .5em; line-height: 1.25; }
  .markdown :global(h2) { font: 600 1.45em/1.25 var(--font-serif); }
  .markdown :global(h3) { font-size: 1.2em; }
  .markdown :global(h4), .markdown :global(h5), .markdown :global(h6) { font-size: 1em; }
  .markdown :global(ul), .markdown :global(ol) { margin: 0 0 1em; padding-left: 1.5em; }
  .markdown :global(li) { margin: .25em 0; }
  .markdown :global(li > ul), .markdown :global(li > ol) { margin: .25em 0 0; }
  .markdown :global(blockquote) { margin: 0 0 1em; padding: .1em 0 .1em 1em; border-left: 3px solid var(--border-strong); color: var(--muted); }
  .markdown :global(code) { padding: .12em .35em; border-radius: 5px; background: var(--subtle); font: .88em var(--font-mono); }
  .markdown :global(pre) { margin: 0 0 1em; padding: 12px 14px; overflow-x: auto; border-radius: var(--radius-sm); background: var(--surface2); border: 1px solid var(--border); }
  .markdown :global(pre code) { padding: 0; background: none; font-size: .85em; white-space: pre; }
  .markdown :global(hr) { margin: 1.6em 0; border: 0; border-top: 1px solid var(--border); }
  .markdown :global(a) { color: var(--link); text-decoration: underline; text-underline-offset: 3px; }
  .markdown :global(a:hover) { color: var(--accent); }
</style>
