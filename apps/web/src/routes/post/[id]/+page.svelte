<script>
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import SessionNav from '$lib/SessionNav.svelte';
  export let data;
  let token = '', body = '', parent = null, message = '', busy = false;
  onMount(() => { token = localStorage.getItem('swartzit_session') || ''; });
  async function send(path, payload) {
    busy = true; message = '';
    try {
      const response = await fetch(path, { method: 'POST', headers: {
        'content-type': 'application/json', authorization: `Bearer ${token}`
      }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Please try again.');
      await invalidateAll();
      return true;
    } catch (error) { message = error.message || 'Could not reach Swartzit.'; return false; }
    finally { busy = false; }
  }
  async function comment() {
    if (await send(`/api/posts/${data.post.id}/comments`, { body, parent_id: parent })) {
      body = ''; parent = null;
    }
  }
  function children(comments, id) { return comments.filter(comment => comment.parent_id === id); }
</script>
<svelte:head><title>{data.post.title} — Swartzit</title></svelte:head>
<header>
  <a class="brand" href="/">swartzit</a>
  <a href="/api/export?community={data.post.community}" download="swartzit-community-export.json">Export community</a>
  <SessionNav />
</header>
<main class="post-page">
  <a class="back" href="/?community={data.post.community}">← c/{data.post.community}</a>
  <article class="post">
    <div class="meta">c/{data.post.community} · u/{data.post.author}</div>
    <h1>{data.post.title}</h1>
    <p>{data.post.body}</p>
    <footer><span>{data.post.score} points</span><span>{data.post.comment_count} comments</span></footer>
    {#if token}
      <div class="vote-controls">
        <button class="vote-button" disabled={busy} on:click={() => send(`/api/posts/${data.post.id}/vote`, { value: 1 })}>Upvote</button>
        <button class="vote-button" disabled={busy} on:click={() => send(`/api/posts/${data.post.id}/vote`, { value: -1 })}>Downvote</button>
        <button class="vote-button" disabled={busy} on:click={() => send(`/api/posts/${data.post.id}/vote`, { value: 0 })}>Clear vote</button>
      </div>
    {/if}
  </article>
  {#if message}<p role="alert" class="form-error">{message}</p>{/if}
  {#if token}
    <section class="comment-compose" id="reply">
      <h2>{parent ? 'Reply to comment #' + parent : 'Join the conversation'}</h2>
      <form on:submit|preventDefault={comment}>
        <label for="comment-body">Your comment</label>
        <textarea id="comment-body" bind:value={body} required maxlength="10000" rows="4"></textarea>
        <button disabled={busy}>{busy ? 'Saving…' : 'Post comment'}</button>
        {#if parent}<button type="button" on:click={() => parent = null}>Cancel reply</button>{/if}
      </form>
    </section>
  {:else}<p><a href="/login">Sign in</a> to comment or vote. Everyone can read the discussion.</p>{/if}
  <section class="comments">
    <h2>Comments</h2>
    {#snippet thread(parentId, depth)}
      {#each children(data.comments, parentId) as item (item.id)}
        <div style:margin-left={depth > 0 ? '16px' : '0'}>
          <article id={'comment-' + item.id}>
            <div class="meta">u/{item.author} · {new Date(item.created_at).toLocaleDateString()}</div>
            <p>{item.body}</p>
            {#if token}<a href="#reply" on:click={() => parent = item.id}>Reply</a>{/if}
          </article>
          {@render thread(item.id, depth + 1)}
        </div>
      {/each}
    {/snippet}
    {@render thread(null, 0)}
    {#if !data.comments.length}<p>No comments yet.</p>{/if}
    {#if data.comments_truncated}<p>Showing the first 500 comments.</p>{/if}
  </section>
</main>
