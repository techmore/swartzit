<script>
  export let data;
  import { onMount } from 'svelte';
  import SessionNav from '$lib/SessionNav.svelte';
  let token = '', title = '', body = '', community = data.communities[0]?.slug ?? '', formError = '', formMessage = '';
  onMount(() => { token = localStorage.getItem('swartzit_session') ?? ''; });
  async function createPost() { formError = ''; formMessage = ''; const response = await fetch('/api/posts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ community, title, body }) }); const result = await response.json(); if (!response.ok) { formError = result.error ?? 'Could not publish discussion'; return; } window.location.assign(`/post/${result.id}`); }
</script>

<svelte:head><title>Swartzit — the commons</title></svelte:head>
<header><a class="brand" href="/">swartzit</a><span>Read freely. Participate under a pseudonym. Take your community with you.</span><a href="/api/export" download="swartzit-export.json">Export public data</a><SessionNav /></header>
<main>
  <section class="intro"><p class="eyebrow">THE OPEN DISCUSSION NETWORK</p><h1>Conversations that belong to their communities.</h1><p>Public posts and comments stay readable without an account. Join when you’re ready to contribute.</p></section>
  <div class="layout"><aside><h2>Communities</h2><a class="selected" href="/">All discussions</a>{#each data.communities as community}<a href="/?community={community.slug}"><strong>c/{community.slug}</strong><small>{community.post_count} posts</small></a>{/each}</aside><section class="feed"><div class="feed-head"><h2>Recent discussions</h2><form><input name="q" placeholder="Search discussions" aria-label="Search discussions" /><button>Search</button></form></div>{#if data.posts.length === 0}<p class="empty">No discussions found.</p>{:else}{#each data.posts as post}<article><div class="meta"><a href="/?community={post.community}">c/{post.community}</a><span>·</span><span>posted by u/{post.author}</span><span>·</span><time datetime={post.created_at}>{new Date(post.created_at).toLocaleDateString()}</time></div><h3><a href="/post/{post.id}">{post.title}</a></h3><p>{post.body}</p><footer><span>↕ {post.score}</span><a href="/post/{post.id}">{post.comment_count} comments</a></footer></article>{/each}{/if}</section></div>
{#if token}<section class="compose"><h2>Start a discussion</h2><form on:submit|preventDefault={createPost}><label>Community<select bind:value={community}>{#each data.communities as item}<option value={item.slug}>c/{item.slug}</option>{/each}</select></label><label>Title<input bind:value={title} required maxlength="300" /></label><label>Body<textarea bind:value={body} maxlength="50000" rows="5"></textarea></label><button>Publish</button>{#if formError}<p class="form-error">{formError}</p>{/if}{#if formMessage}<p class="form-message">{formMessage}</p>{/if}</form></section>{/if}
</main>
