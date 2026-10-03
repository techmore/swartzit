<script>
  import { onMount } from 'svelte';
  import SessionNav from '#lib/SessionNav.svelte';
  import Brand from '#lib/Brand.svelte';
  import AuthorAvatar from '#lib/AuthorAvatar.svelte';
  import PostBody from '#lib/PostBody.svelte';
  import VideoLoopToggle from '#lib/VideoLoopToggle.svelte';
  import LikeSharingSettings from '#lib/LikeSharingSettings.svelte';
  import PostPreferences from '#lib/PostPreferences.svelte';

  export let data;
  let token = '', viewer = null, buddyFollowing = false, buddyPinned = false, buddyBusy = false, buddyError = '', postPinBusyId = '', postPinError = '', postPinNotice = '', displayName = data.profile.display_name ?? '', bio = data.profile.bio ?? '', avatarUrl = data.profile.avatar_url ?? '', xHandle = 'techmore_edu', fetchingXAvatar = false, projects = (data.profile.projects ?? []).map(project => ({ ...project })), formError = '', formMessage = '', saving = false;
  let activeTab = data.tab ?? 'posts';
  let pinnedPostId = data.profile.pinned_post_id ?? null;
  let videoLoops = {};
  const date = value => value ? new Date(value).toLocaleDateString() : '—';
  const attachment = value => {
    const media = typeof value === 'string' ? { kind: 'image', src: value } : value ?? {};
    const src = String(media.src ?? '').trim();
    return /^(?:https?:\/\/|\/media\/\d+(?:\?|$))/i.test(src) ? { ...media, src, kind: media.kind === 'video' ? 'video' : 'image' } : null;
  };
  const postAttachments = post => (post.source?.media ?? []).map(attachment).filter(Boolean);
  $: posts = data.posts ?? [];
  $: replies = data.replies ?? [];
  $: media = (data.media ?? []).flatMap(post => (post.source?.media ?? []).map(attachment).filter(Boolean).map(item => ({ ...item, post })));

  function setVideoLoop(src, enabled) {
    videoLoops = { ...videoLoops, [src]: enabled };
  }

  onMount(async () => {
    token = localStorage.getItem('swartzit_session') ?? '';
    if (!token) return;
    try {
      const meResponse = await fetch('/api/me', { headers: { authorization: 'Bearer ' + token } });
      if (!meResponse.ok) return;
      viewer = await meResponse.json();
      if (viewer.handle !== data.profile.handle) {
        const buddiesResponse = await fetch('/api/buddies', { headers: { authorization: 'Bearer ' + token } });
        if (buddiesResponse.ok) {
          const buddies = await buddiesResponse.json();
          const buddy = buddies.find(item => item.handle === data.profile.handle);
          buddyFollowing = Boolean(buddy);
          buddyPinned = Boolean(buddy?.pinned);
        }
      }
    } catch { /* Public profile rendering does not depend on session refresh. */ }
  });

  async function toggleBuddy() {
    buddyBusy = true; buddyError = '';
    try {
      const response = await fetch(`/api/buddies/${encodeURIComponent(data.profile.handle)}`, {
        method: buddyFollowing ? 'DELETE' : 'POST',
        headers: { authorization: 'Bearer ' + token }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update your buddies.');
      buddyFollowing = result.following;
      if (!buddyFollowing) buddyPinned = false;
    } catch (cause) { buddyError = cause.message || 'Could not reach Swartzit.'; }
    finally { buddyBusy = false; }
  }

  async function toggleBuddyPin() {
    buddyBusy = true; buddyError = '';
    try {
      const response = await fetch(`/api/buddies/${encodeURIComponent(data.profile.handle)}/pin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ pinned: !buddyPinned })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update this pin.');
      buddyPinned = result.pinned;
    } catch (cause) { buddyError = cause.message || 'Could not reach Swartzit.'; }
    finally { buddyBusy = false; }
  }

  async function togglePostPin(item) {
    const shouldPin = pinnedPostId !== item.public_id;
    if (shouldPin && pinnedPostId && !window.confirm('Pinning this post will replace your current pinned post. Continue?')) return;
    postPinBusyId = item.public_id;
    postPinError = '';
    postPinNotice = '';
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(item.public_id)}/pin`, {
        method: shouldPin ? 'POST' : 'DELETE',
        headers: { authorization: 'Bearer ' + token }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update your pinned post.');
      pinnedPostId = result.pinned ? result.public_id : null;
      data = {
        ...data,
        profile: { ...data.profile, pinned_post_id: pinnedPostId },
        posts: (data.posts ?? [])
          .map(post => ({ ...post, pinned: post.public_id === pinnedPostId }))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.created_at) - Date.parse(a.created_at))
      };
      postPinNotice = result.pinned ? 'Post pinned to the top of your profile.' : 'Post unpinned from your profile.';
    } catch (cause) {
      postPinError = cause.message || 'Could not reach Swartzit.';
    } finally {
      postPinBusyId = '';
    }
  }

  async function saveProfile() {
    formError = ''; formMessage = ''; saving = true;
    try {
      const response = await fetch('/api/me/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ display_name: displayName, bio, avatar_url: avatarUrl || null, projects })
      });
      const result = await response.json();
      if (!response.ok) { formError = result.error ?? 'Could not save profile changes.'; return; }
      data = { ...data, profile: { ...data.profile, display_name: displayName, bio, avatar_url: avatarUrl || null, projects: projects.map(project => ({ ...project })) } };
      window.dispatchEvent(new CustomEvent('swartzit:profile-updated', { detail: { avatar_url: avatarUrl || null } }));
      formMessage = result.message ?? 'Profile updated.';
    } catch { formError = 'Could not reach Swartzit.'; }
    finally { saving = false; }
  }

  async function importXAvatar() {
    formError = ''; formMessage = '';
    const handle = xHandle.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) { formError = 'Enter a valid X handle.'; return; }
    fetchingXAvatar = true;
    try {
      const response = await fetch(`/x-profile/${encodeURIComponent(handle)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'X profile lookup failed. Check the handle and try again.');
      avatarUrl = result.avatar_url;
      formMessage = `Loaded the avatar for @${result.screen_name}. Save your profile to apply it.`;
    } catch (cause) { formError = cause.message || 'Could not load the X profile image.'; }
    finally { fetchingXAvatar = false; }
  }

  function addProject() { projects = [...projects, { name: '', url: '', favicon_url: '', github_url: '' }]; }
  function removeProject(index) { projects = projects.filter((_, itemIndex) => itemIndex !== index); }
</script>

<svelte:head>
  <title>u/{data.profile.handle} · Swartzit</title>
  <meta name="description" content={data.profile.bio || 'Profile for u/' + data.profile.handle + ' on Swartzit.'} />
</svelte:head>

<header><Brand /><span>Member profile</span><SessionNav /></header>
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
    {#if data.profile.projects?.length}
      <section class="profile-projects" aria-label="Projects"><h2>Projects</h2><div class="project-grid">
        {#each data.profile.projects as project}
          <article class="project-card">
            {#if project.favicon_url}<img class="project-icon" src={project.favicon_url} alt="" loading="lazy" onerror={(event) => event.currentTarget.hidden = true} />{:else}<span class="project-icon project-icon-fallback" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span>{/if}
            <div class="project-copy"><strong>{#if project.url}<a href={project.url} target="_blank" rel="noopener noreferrer">{project.name}</a>{:else}{project.name}{/if}</strong>
              {#if project.github_url}<a class="project-github" href={project.github_url} target="_blank" rel="noopener noreferrer">GitHub ↗</a>{/if}
            </div>
          </article>
        {/each}
      </div></section>
    {/if}
    <dl class="profile-stats"><div><dt>Joined</dt><dd>{date(data.profile.joined_at)}</dd></div><div><dt>Posts</dt><dd>{data.profile.post_count}</dd></div><div><dt>Replies</dt><dd>{data.profile.comment_count}</dd></div></dl>
    {#if token && viewer && viewer.handle !== data.profile.handle}
      <div class="buddy-controls">
        <button type="button" disabled={buddyBusy} onclick={toggleBuddy}>{buddyBusy ? 'Saving…' : buddyFollowing ? 'Unfollow buddy' : 'Follow buddy'}</button>
        {#if buddyFollowing}<button class:pinned={buddyPinned} type="button" disabled={buddyBusy} onclick={toggleBuddyPin}>{buddyPinned ? 'Unpin from Buddies feed' : 'Pin to Buddies feed'}</button>{/if}
      </div>
      {#if buddyError}<p class="form-error" role="alert">{buddyError}</p>{/if}
    {:else if !token}
      <p class="buddy-sign-in"><a href="/login">Sign in</a> to follow and pin this member.</p>
    {/if}
  </section>

  {#if viewer?.handle === data.profile.handle}
    <section class="panel profile-editor">
      <h2>Edit your profile</h2>
      <p class="muted">Profile changes publish immediately and are not sent to moderation review.</p>
      <form onsubmit={(event) => { event.preventDefault(); saveProfile(); }}>
        <label>Display name<input bind:value={displayName} maxlength="80" placeholder="How should people see you?" /></label>
        <label>Bio<textarea bind:value={bio} maxlength="2000" rows="4" placeholder="Tell the community a little about yourself."></textarea></label>
        <label>Avatar URL <span class="muted">(HTTPS image URL)</span><input bind:value={avatarUrl} maxlength="2048" placeholder="https://…" /></label>
        <div class="x-avatar-import"><label for="x-handle">X handle</label><div><input id="x-handle" bind:value={xHandle} maxlength="16" placeholder="@yourhandle" /><button type="button" disabled={fetchingXAvatar} onclick={importXAvatar}>{fetchingXAvatar ? 'Looking up…' : 'Load X avatar'}</button></div><small>Looks up the public profile image. Save your profile after loading it.</small></div>
        <section class="project-editor" aria-label="Profile projects"><div class="project-editor-heading"><div><h3>Projects</h3><p class="muted">Add a project name, icon or favicon, website, and GitHub repository.</p></div><button type="button" class="secondary-button" onclick={addProject}>Add project</button></div>
          {#each projects as project, index}
            <fieldset class="project-fields"><legend>Project {index + 1}</legend><button type="button" class="remove-project" aria-label={'Remove project ' + (index + 1)} onclick={() => removeProject(index)}>Remove</button>
              <label>Project name<input bind:value={project.name} maxlength="80" placeholder="Sonder" /></label>
              <label>Website URL<input bind:value={project.url} maxlength="2048" placeholder="https://…" /></label>
              <label>Icon or favicon URL<input bind:value={project.favicon_url} maxlength="2048" placeholder="https://…/favicon.ico" /></label>
              <label>GitHub repository<input bind:value={project.github_url} maxlength="2048" placeholder="https://github.com/owner/repository" /></label>
            </fieldset>
          {/each}
        </section>
        <button disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
      </form>
      {#if formMessage}<p class="form-message" role="status">{formMessage}</p>{/if}
      {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
    </section>
    <PostPreferences />
    <LikeSharingSettings />
  {/if}

  <section class="activity">
    <div class="section-heading"><div><p class="eyebrow">PUBLIC TIMELINE</p><h2>Contributions</h2></div><a href="/">Browse discussions →</a></div>
    <div class="profile-tabs" role="tablist" aria-label="Profile timeline tabs">
      <a role="tab" aria-selected={activeTab === 'posts'} aria-controls="profile-posts" class:active={activeTab === 'posts'} href="?tab=posts">Posts <span>{data.profile.post_count}</span></a>
      <a role="tab" aria-selected={activeTab === 'replies'} aria-controls="profile-replies" class:active={activeTab === 'replies'} href="?tab=replies">Replies <span>{data.profile.comment_count}</span></a>
      <a role="tab" aria-selected={activeTab === 'media'} aria-controls="profile-media" class:active={activeTab === 'media'} href="?tab=media">Media <span>{data.profile.media_count ?? '—'}</span></a>
    </div>

    {#if activeTab === 'posts'}
      <div id="profile-posts" role="tabpanel" aria-label="Posts">
        {#if posts.length}
          {#each posts as item}
            <article class="activity-item" class:pinned-post={item.pinned}>
              <div class="post-card-heading"><div><span class="badge">Post</span><span class="muted"> · {date(item.created_at)} · c/{item.community}</span></div>{#if item.pinned}<span class="pinned-badge">📌 Pinned</span>{/if}</div>
              <h3><a href="/post/{item.public_id}">{item.title}</a></h3>
              {#if item.body}<PostBody body={item.body} />{/if}
              {#if postAttachments(item).length}
                <div class="post-media" aria-label="Media attached to this post">
                  {#each postAttachments(item) as asset}
                    <div class="post-media-item">
                      {#if asset.kind === 'video'}
                        <!-- Profile timelines do not have caption tracks for attached video. -->
                        <!-- svelte-ignore a11y_media_has_caption -->
                        <video controls playsinline preload="metadata" loop={videoLoops[asset.src] === true} src={asset.src} poster={asset.poster || undefined} aria-label={asset.alt || 'Video shared in '+item.title}></video>
                        <VideoLoopToggle enabled={videoLoops[asset.src] === true} on:change={(event) => setVideoLoop(asset.src, event.detail.enabled)} />
                      {:else}
                        <a href={asset.src} target="_blank" rel="noopener noreferrer"><img src={asset.src} alt={asset.alt || item.title} loading="lazy" referrerpolicy="no-referrer" /></a>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
              <div class="timeline-meta"><span>{item.score ?? 0} points</span><span>{item.comment_count ?? 0} replies</span>{#if item.source?.media?.length}<span>{item.source.media.length} media</span>{/if}</div>
              {#if viewer?.handle === data.profile.handle}<button type="button" class="post-pin-button" class:active={item.pinned} disabled={postPinBusyId !== ''} aria-pressed={item.pinned === true} onclick={() => togglePostPin(item)}>{postPinBusyId === item.public_id ? 'Saving…' : item.pinned ? 'Unpin from profile' : 'Pin to profile'}</button>{/if}
            </article>
          {/each}
        {:else}<p class="muted empty-tab">No approved posts yet.</p>{/if}
        {#if postPinNotice}<p class="pin-feedback" role="status">{postPinNotice}</p>{/if}
        {#if postPinError}<p class="pin-error" role="alert">{postPinError}</p>{/if}
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
                    <video controls playsinline preload="metadata" loop={videoLoops[item.src] === true} src={item.src} poster={item.poster || undefined} aria-label={item.alt || 'Video shared in '+item.post.title}></video>
                  {:else}<a href={item.src} target="_blank" rel="noopener noreferrer"><img src={item.src} alt={item.alt || item.post.title} loading="lazy" referrerpolicy="no-referrer" /></a>{/if}
                </div>
              <div class="media-caption"><a href="/post/{item.post.public_id}">{item.post.title}</a>{#if item.post.pinned}<span class="pinned-badge">📌 Pinned on profile</span>{/if}<small>{date(item.post.created_at)} · c/{item.post.community}</small>{#if item.kind === 'video'}<div class="media-video-tools"><VideoLoopToggle enabled={videoLoops[item.src] === true} on:change={(event) => setVideoLoop(item.src, event.detail.enabled)} /><a href={item.src} target="_blank" rel="noopener noreferrer">Open video ↗</a></div>{/if}</div>
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
  .buddy-controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.buddy-controls button{padding:8px 12px;border:1px solid var(--border,#c7ccc3);border-radius:8px;background:var(--surface,#fff);color:var(--heading,#173d34);font:650 .8rem/1.1 inherit;cursor:pointer}.buddy-controls button:first-child{background:var(--heading,#173d34);border-color:var(--heading,#173d34);color:#fff}.buddy-controls button.pinned{background:var(--wash,#f0ece4);border-color:var(--accent,#9b5e38);color:var(--accent,#9b5e38)}.buddy-controls button:disabled{opacity:.6;cursor:wait}.buddy-sign-in{margin:16px 0 0;color:var(--muted,#66766c);font-size:.82rem}.buddy-sign-in a{color:var(--accent,#9b5e38);font-weight:700}
  .profile-editor{margin-top:20px}.profile-editor h2{margin-top:0}.profile-editor form{display:grid;gap:12px}.profile-editor textarea{resize:vertical}.profile-editor button{justify-self:start}.form-message,.form-error{font-size:.84rem;margin-bottom:0}
  .profile-projects{margin-top:24px}.profile-projects h2{font:600 1rem/1.2 inherit;margin:0 0 12px;color:var(--heading,#173d34)}.project-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.project-card{display:flex;align-items:center;gap:12px;min-width:0;padding:13px;border:1px solid var(--border,#dedfd7);border-radius:10px;background:var(--surface,#fff)}.project-icon{width:42px;height:42px;flex:0 0 42px;object-fit:contain;border-radius:9px;background:var(--subtle,#e8ece6)}.project-icon-fallback{display:grid;place-items:center;color:var(--heading,#173d34);font-weight:750}.project-copy{display:grid;gap:4px;min-width:0}.project-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.project-copy a{color:inherit;text-decoration:none}.project-copy strong a:hover,.project-github:hover{text-decoration:underline}.project-github{color:var(--muted,#66766c);font-size:.78rem}
  .x-avatar-import{display:grid;gap:6px}.x-avatar-import>label{font-size:.84rem;font-weight:650}.x-avatar-import>div{display:flex;gap:8px}.x-avatar-import>div input{flex:1}.x-avatar-import>div button,.secondary-button{border:1px solid var(--border,#c7ccc3);border-radius:8px;padding:9px 12px;background:var(--surface,#fff);color:var(--heading,#173d34);font-weight:650}.x-avatar-import>small{color:var(--muted,#77827d);font-size:.76rem}.project-editor{display:grid;gap:12px;margin-top:10px}.project-editor-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.project-editor-heading h3{margin:0;font-size:1rem;color:var(--heading,#173d34)}.project-editor-heading p{margin:4px 0 0;font-size:.8rem}.project-fields{position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0;padding:18px 12px 12px;border:1px solid var(--border,#dedfd7);border-radius:9px}.project-fields legend{padding:0 5px;font-size:.77rem;font-weight:700;color:var(--muted,#66766c)}.project-fields .remove-project{position:absolute;right:10px;top:8px;border:0;background:none;color:#9d3f35;font-size:.76rem}.project-fields label{font-size:.79rem}.project-fields input{margin-top:4px}
  .activity{margin-top:40px}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:16px;border-bottom:1px solid var(--border,#dedfd7);padding-bottom:12px}.section-heading h2{margin:0;font:500 1.7rem/1.1 Georgia,serif;color:var(--heading,#173d34)}.section-heading a{color:var(--accent,#9b5e38);font-weight:700;font-size:.84rem}
  .profile-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border,#dedfd7);margin-top:16px;overflow-x:auto}.profile-tabs a{position:relative;padding:13px 15px;color:var(--muted,#66766c);font:600 .82rem/1 inherit;white-space:nowrap;text-decoration:none}.profile-tabs a span{margin-left:4px;font-size:.72rem;opacity:.75}.profile-tabs a:hover{color:var(--heading,#173d34)}.profile-tabs a.active{color:var(--heading,#173d34)}.profile-tabs a.active::after{content:'';position:absolute;right:12px;bottom:-1px;left:12px;height:3px;border-radius:3px 3px 0 0;background:var(--accent,#9b5e38)}
  .activity-item{padding:17px 0;border-bottom:1px solid var(--border,#dedfd7)}.activity-item h3{margin:8px 0 0;font:600 1.1rem/1.25 Georgia,serif}.activity-item h3 a{color:var(--heading,#173d34)}.activity-item p{margin:10px 0;white-space:pre-wrap}.timeline-body{line-height:1.5}.timeline-meta{display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;color:var(--muted,#77827d);font-size:.76rem}.badge{display:inline-block;padding:3px 7px;border-radius:999px;background:var(--wash,#f0ece4);color:var(--muted,#66766c);font-size:.68rem;text-transform:uppercase;letter-spacing:.05em}.context-link{font-size:.8rem;color:var(--accent,#9b5e38);font-weight:700}.empty-tab{padding:28px 0;border-bottom:1px solid var(--border,#dedfd7)}
  .activity-item.pinned-post{padding-left:12px;border-left:3px solid var(--accent,#9b5e38)}.post-card-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.pinned-badge{color:var(--accent,#9b5e38);font-size:.72rem;font-weight:750;white-space:nowrap}.post-pin-button{margin-top:12px;padding:6px 10px;border:1px solid var(--border,#c7ccc3);border-radius:999px;background:var(--surface,#fff);color:var(--heading,#173d34);font:650 .74rem/1.2 ui-sans-serif,system-ui,sans-serif;cursor:pointer}.post-pin-button.active{border-color:var(--accent,#9b5e38);color:var(--accent,#9b5e38)}.post-pin-button:disabled{opacity:.6;cursor:wait}.pin-feedback,.pin-error{font-size:.82rem}.pin-feedback{color:var(--accent,#575d3d)}.pin-error{color:var(--error,#973c35)}
  .post-media{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px;margin-top:14px}.post-media-item{min-width:0;overflow:hidden;border:1px solid var(--border,#dedfd7);border-radius:10px;background:#151815}.post-media-item img,.post-media-item video{display:block;width:100%;max-height:480px;aspect-ratio:4/3;object-fit:contain}.post-media-item a{display:block}.post-media-item :global(button){margin:6px 8px}
  .media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding-top:18px}.media-card{overflow:hidden;border:1px solid var(--border,#dedfd7);border-radius:10px;background:var(--surface,#fff)}.media-preview{background:var(--subtle,#f0f3ec);aspect-ratio:1/1;display:grid;place-items:center}.media-preview img,.media-preview video{width:100%;height:100%;object-fit:cover;display:block}.media-caption{padding:10px 12px}.media-caption>a{display:block;color:var(--heading,#173d34);font-weight:700;font-size:.84rem;line-height:1.3;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.media-caption small{display:block;margin-top:5px;color:var(--muted,#77827d);font-size:.72rem}.media-video-tools{display:flex;align-items:center;gap:10px;margin-top:8px}.media-video-tools a{color:var(--accent,#9b5e38);font-size:.76rem;font-weight:700}
  @media(max-width:600px){.profile-page{padding-top:20px}.profile-card{padding:20px}.profile-card h1{font-size:1.6rem}.profile-stats{gap:18px}.section-heading{align-items:start;flex-direction:column;gap:8px}}
  @media(max-width:460px){.media-grid{grid-template-columns:1fr}.profile-tabs a{padding-inline:10px}.project-fields{grid-template-columns:1fr}.project-editor-heading{align-items:flex-start;flex-direction:column}.x-avatar-import>div{align-items:stretch;flex-direction:column}}
</style>
