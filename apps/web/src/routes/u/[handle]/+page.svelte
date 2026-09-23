<script>
  import { onMount } from 'svelte';
  import SessionNav from '$lib/SessionNav.svelte';
  import AuthorAvatar from '$lib/AuthorAvatar.svelte';

  export let data;
  let token = '', viewer = null, pending = null, displayName = data.profile.display_name ?? '', bio = data.profile.bio ?? '', avatarUrl = data.profile.avatar_url ?? '', formError = '', formMessage = '', saving = false;
  let activeTab = 'posts';
  const date = value => value ? new Date(value).toLocaleDateString() : '—';
  const attachment = value => {
    const media = typeof value === 'string' ? { kind: 'image', src: value } : value ?? {};
    const src = String(media.src ?? '').trim();
    return /^https?:\/\//i.test(src) ? { ...media, src, kind: media.kind === 'video' ? 'video' : 'image' } : null;
  };
  $: posts = data.posts ?? [];
  $: replies = data.replies ?? [];
  $: media = (data.media ?? []).flatMap(post => (post.source?.media ?? []).map(attachment).filter(Boolean).map(item => ({ ...item, post })));

  onMount(async () => {
    token = localStorage.getItem('swartzit_session') ?? '';
    if (!token) return;
    try {
      const meResponse = await fetch('/api/me', { headers: { authorization: 'Bearer ' + token } });
      if (!meResponse.ok) return;
      viewer = await meResponse.json();
      if (viewer.handle !== data.profile.handle) return;
      const profileResponse = await fetch('/api/me/profile', { headers: { authorization: 'Bearer ' + token } });
      if (profileResponse.ok) {
        const profile = await profileResponse.json();
        pending = profile.pending_change;
      }
    } catch { /* Public profile rendering does not depend on session refresh. */ }
  });

  async function saveProfile() {
    formError = ''; formMessage = ''; saving = true;
    try {
      const response = await fetch('/api/me/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ display_name: displayName, bio, avatar_url: avatarUrl || null })
      });
      const result = await response.json();
      if (!response.ok) { formError = result.error ?? 'Could not submit profile changes.'; return; }
      pending = result;
      formMessage = result.message ?? 'Profile changes are waiting for moderator review.';
    } catch { formError = 'Could not reach Swartzit.'; }
    finally { saving = false; }
  }
</script>

<svelte:head>
  <title>u/{data.profile.handle} · Swartzit</title>
  <meta name="description" content={data.profile.bio || 'Profile for u/' + data.profile.handle + ' on Swartzit.'} />
</svelte:head>

<header><a class="brand" href="/">swartzit</a><span>Member profile</span><SessionNav /></header>
<main class="profile-page">
  <section class="profile-card">
    <div class="profile-identity">
      {#if data.profile.avatar_url}
        <img class="profile-avatar" src={data.profile.avatar_url} alt="Avatar for u/{data.profile.handle}" />
      {:else}
        <AuthorAvatar handle={data.profile.handle} size="normal" />
      {/if}
      <div><p class="eyebrow">COMMUNITY MEMBER</p><h1>{data.profile.display_name || 'u/' + data.profile.handle}</h1><p class="handle">u/{data.profile.handle}</p></div>
    </div>
    {#if data.profile.bio}<p class="bio">{data.profile.bio}</p>{:else}<p class="muted">This member has not added a bio yet.</p>{/if}
    <dl class="profile-stats"><div><dt>Joined</dt><dd>{date(data.profile.joined_at)}</dd></div><div><dt>Posts</dt><dd>{data.profile.post_count}</dd></div><div><dt>Replies</dt><dd>{data.profile.comment_count}</dd></div></dl>
  </section>

  {#if viewer?.handle === data.profile.handle}
    <section class="panel profile-editor">
      <h2>Edit your profile</h2>
      <p class="muted">Changes are held for moderator review before they become public.</p>
      <form onsubmit={(event) => { event.preventDefault(); saveProfile(); }}>
        <label>Display name<input bind:value={displayName} maxlength="80" placeholder="How should people see you?" /></label>
        <label>Bio<textarea bind:value={bio} maxlength="2000" rows="4" placeholder="Tell the community a little about yourself."></textarea></label>
        <label>Avatar URL <span class="muted">(HTTPS image URL)</span><input bind:value={avatarUrl} maxlength="2048" placeholder="https://…" /></label>
        <button disabled={saving}>{saving ? 'Submitting…' : 'Submit profile changes'}</button>
      </form>
      {#if pending}<p class="moderation-note" role="status">A profile change is pending moderator review. Flags are advisory and do not include matched private text.</p>{/if}
      {#if formMessage}<p class="form-message" role="status">{formMessage}</p>{/if}
      {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
    </section>
  {/if}

  <section class="activity">
    <div class="section-heading"><div><p class="eyebrow">PUBLIC TIMELINE</p><h2>Contributions</h2></div><a href="/">Browse discussions →</a></div>
    <div class="profile-tabs" role="tablist" aria-label="Profile timeline tabs">
      <button type="button" role="tab" aria-selected={activeTab === 'posts'} aria-controls="profile-posts" class:active={activeTab === 'posts'} onclick={() => activeTab = 'posts'}>Posts <span>{data.profile.post_count}</span></button>
      <button type="button" role="tab" aria-selected={activeTab === 'replies'} aria-controls="profile-replies" class:active={activeTab === 'replies'} onclick={() => activeTab = 'replies'}>Replies <span>{data.profile.comment_count}</span></button>
      <button type="button" role="tab" aria-selected={activeTab === 'media'} aria-controls="profile-media" class:active={activeTab === 'media'} onclick={() => activeTab = 'media'}>Media <span>{media.length}</span></button>
    </div>

    {#if activeTab === 'posts'}
      <div id="profile-posts" role="tabpanel" aria-label="Posts">
        {#if posts.length}
          {#each posts as item}
            <article class="activity-item">
              <div><span class="badge">Post</span><span class="muted"> · {date(item.created_at)} · c/{item.community}</span></div>
              <h3><a href="/post/{item.public_id}">{item.title}</a></h3>
              {#if item.body}<p class="timeline-body">{item.body}</p>{/if}
              <div class="timeline-meta"><span>{item.score ?? 0} points</span><span>{item.comment_count ?? 0} replies</span>{#if item.source?.media?.length}<span>{item.source.media.length} media</span>{/if}</div>
            </article>
          {/each}
        {:else}<p class="muted empty-tab">No approved posts yet.</p>{/if}
      </div>
    {:else if activeTab === 'replies'}
      <div id="profile-replies" role="tabpanel" aria-label="Replies">
        {#if replies.length}
          {#each replies as item}
            <article class="activity-item reply-item">
              <div><span class="badge">Reply</span><span class="muted"> · {date(item.created_at)} · c/{item.community}</span></div>
              <p class="timeline-body">{item.body}</p>
              <a class="context-link" href="/post/{item.post_public_id}">Replying to “{item.post_title}” →</a>
            </article>
          {/each}
        {:else}<p class="muted empty-tab">No approved replies yet.</p>{/if}
      </div>
    {:else}
      <div id="profile-media" role="tabpanel" aria-label="Media">
        {#if media.length}
          <div class="media-grid">
            {#each media as item}
              <article class="media-card">
                <div class="media-preview">
                  {#if item.kind === 'video'}
                    <!-- Profile media has no caption tracks available. -->
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video controls playsinline preload="metadata" src={item.src} poster={item.poster || undefined} aria-label={item.alt || 'Video shared in '+item.post.title}></video>
                  {:else}<a href={item.src} target="_blank" rel="noopener noreferrer"><img src={item.src} alt={item.alt || item.post.title} loading="lazy" referrerpolicy="no-referrer" /></a>{/if}
                </div>
                <div class="media-caption"><a href="/post/{item.post.public_id}">{item.post.title}</a><small>{date(item.post.created_at)} · c/{item.post.community}{#if item.kind === 'video'} · <a href={item.src} target="_blank" rel="noopener noreferrer">Open video ↗</a>{/if}</small></div>
              </article>
            {/each}
          </div>
        {:else}<p class="muted empty-tab">No approved media yet.</p>{/if}
      </div>
    {/if}
  </section>
</main>

<style>
  .profile-page{max-width:780px;padding-top:38px;padding-bottom:80px}
  .profile-card{padding:26px 28px;background:var(--surface,#fff);border:1px solid var(--border,#dedfd7);border-radius:12px}
  .profile-identity{display:flex;align-items:center;gap:16px}.profile-identity :global(.author-avatar){width:72px;height:72px;flex-basis:72px;font-size:1.2rem}.profile-avatar{width:72px;height:72px;object-fit:cover;border-radius:50%;border:1px solid var(--border,#dedfd7)}
  .profile-card h1{font:500 2rem/1.1 Georgia,serif;color:var(--heading,#173d34);margin:4px 0}.handle{margin:0;color:var(--muted,#77827d);font-size:.86rem}.bio{max-width:650px;margin:22px 0 0;white-space:pre-wrap}
  .profile-stats{display:flex;gap:28px;margin:24px 0 0;border-top:1px solid var(--border,#dedfd7);padding-top:18px}.profile-stats div{display:grid;gap:3px}.profile-stats dt{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted,#77827d)}.profile-stats dd{margin:0;font-weight:700;color:var(--heading,#173d34)}
  .profile-editor{margin-top:20px}.profile-editor h2{margin-top:0}.profile-editor form{display:grid;gap:12px}.profile-editor textarea{resize:vertical}.profile-editor button{justify-self:start}.moderation-note,.form-message,.form-error{font-size:.84rem;margin-bottom:0}
  .activity{margin-top:40px}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:16px;border-bottom:1px solid var(--border,#dedfd7);padding-bottom:12px}.section-heading h2{margin:0;font:500 1.7rem/1.1 Georgia,serif;color:var(--heading,#173d34)}.section-heading a{color:var(--accent,#9b5e38);font-weight:700;font-size:.84rem}
  .profile-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border,#dedfd7);margin-top:16px;overflow-x:auto}.profile-tabs button{position:relative;padding:13px 15px;border:0;border-radius:0;background:transparent;color:var(--muted,#66766c);font:600 .82rem/1 inherit;white-space:nowrap;cursor:pointer}.profile-tabs button span{margin-left:4px;font-size:.72rem;opacity:.75}.profile-tabs button:hover{color:var(--heading,#173d34)}.profile-tabs button.active{color:var(--heading,#173d34)}.profile-tabs button.active::after{content:'';position:absolute;right:12px;bottom:-1px;left:12px;height:3px;border-radius:3px 3px 0 0;background:var(--accent,#9b5e38)}
  .activity-item{padding:17px 0;border-bottom:1px solid var(--border,#dedfd7)}.activity-item h3{margin:8px 0 0;font:600 1.1rem/1.25 Georgia,serif}.activity-item h3 a{color:var(--heading,#173d34)}.activity-item p{margin:10px 0;white-space:pre-wrap}.timeline-body{line-height:1.5}.timeline-meta{display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;color:var(--muted,#77827d);font-size:.76rem}.badge{display:inline-block;padding:3px 7px;border-radius:999px;background:var(--wash,#f0ece4);color:var(--muted,#66766c);font-size:.68rem;text-transform:uppercase;letter-spacing:.05em}.context-link{font-size:.8rem;color:var(--accent,#9b5e38);font-weight:700}.empty-tab{padding:28px 0;border-bottom:1px solid var(--border,#dedfd7)}
  .media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding-top:18px}.media-card{overflow:hidden;border:1px solid var(--border,#dedfd7);border-radius:10px;background:var(--surface,#fff)}.media-preview{background:var(--subtle,#f0f3ec);aspect-ratio:1/1;display:grid;place-items:center}.media-preview img,.media-preview video{width:100%;height:100%;object-fit:cover;display:block}.media-caption{padding:10px 12px}.media-caption>a{display:block;color:var(--heading,#173d34);font-weight:700;font-size:.84rem;line-height:1.3;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.media-caption small{display:block;margin-top:5px;color:var(--muted,#77827d);font-size:.72rem}.media-caption small a{color:var(--accent,#9b5e38);font-weight:700}
  @media(max-width:600px){.profile-page{padding-top:20px}.profile-card{padding:20px}.profile-card h1{font-size:1.6rem}.profile-stats{gap:18px}.section-heading{align-items:start;flex-direction:column;gap:8px}}
  @media(max-width:460px){.media-grid{grid-template-columns:1fr}.profile-tabs button{padding-inline:10px}}
</style>
