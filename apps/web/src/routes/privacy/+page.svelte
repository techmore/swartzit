<script>
  let { data } = $props();
</script>

<svelte:head><title>Privacy · Swartzit</title></svelte:head>

<main id="main-content" class="legal">
  <p class="eyebrow">Policy</p>
  <h1 class="page-title">Privacy</h1>
  <p class="lede">Swartzit is run by the people who host this server. This page explains what this server and the Swartzit apps keep about you.</p>

  <h2>Reading without an account</h2>
  <p>You can read, listen, and use the Bible reader without an account. The server keeps short-lived request logs (the page asked for, the time, and a one-way hash of your network address) to keep the site running and to block abuse. Your choice of Standard or Bible mode, light or dark, and playback speed are stored on your own device.</p>

  <h2>If you create an account</h2>
  <ul>
    <li>Your handle, an optional display name, bio, and picture, and a securely hashed password. We never see or store your password itself.</li>
    <li>What you post: posts, comments, and the votes, bookmarks, follows, and reports you make.</li>
    <li>A sign-in token on your device so you stay signed in.</li>
  </ul>
  <p>Posts and comments are public and may be copied by feed readers, exports, and mirrors.</p>

  <h2>What we do not do</h2>
  <p>We do not sell your information, show you targeted advertising, or track you across other apps and websites. The Swartzit apps contain no third-party analytics or advertising code.</p>

  <h2>Audio, video, and Scripture text</h2>
  <p>Recordings stream directly from their publishers (for example the Internet Archive for LibriVox readings, church podcast hosts for sermons, and YouTube for embedded videos), and Bible text is fetched from bible-api.com. Those services receive your network address when your device loads from them, under their own privacy policies.</p>

  <h2>Deleting your account</h2>
  <p>You can delete your account at any time from the app (Account → Delete account) or by asking the operator. Deletion removes your profile, password, sign-ins, votes, bookmarks, and follows, withdraws your posts, and blanks your comments. Copies already made by others (see above) cannot be recalled.</p>

  <h2>Contact</h2>
  {#if data.contact}<p>Questions or requests: <a href="mailto:{data.contact}">{data.contact}</a>.</p>
  {:else}<p>Questions or requests: use the Report button on any post, or the details on the <a href="/about">About</a> page.</p>{/if}
</main>

<style>
  .legal { max-width: 720px; }
  .legal h2 { margin: 28px 0 8px; font-size: 1.15rem; }
  .legal p, .legal li { line-height: 1.65; }
  .legal ul { padding-left: 20px; }
  .legal a { color: var(--link); text-decoration: underline; text-underline-offset: 3px; }
</style>
