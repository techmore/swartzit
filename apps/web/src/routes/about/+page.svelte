<svelte:head><title>About Swartzit</title></svelte:head>

<main id="main-content" class="about-page">
  <section class="about-hero">
    <p class="eyebrow">The open discussion network</p>
    <h1>Conversations that belong to their communities.</h1>
    <p class="lede">Public posts and comments stay readable without an account. Join when you’re ready to contribute.</p>
    <div class="actions"><a class="btn" href="/">Browse discussions</a><a class="btn btn-secondary" href="/signup">Create account</a></div>
  </section>

  <section class="pillars" aria-label="Principles">
    <div class="card"><h2>Read freely</h2><p>No login wall stands between a reader and a public conversation. Open a link, read the discussion, follow an idea.</p></div>
    <div class="card"><h2>Participate under a pseudonym</h2><p>Choose a handle for your conversations. No real name or external identity provider is required.</p></div>
    <div class="card"><h2>Take your community with you</h2><p>Public data can be exported at any time, so communities are never locked in. Migration is a design goal.</p></div>
  </section>
</main>

<style>
  .about-hero { max-width: 760px; padding: 40px 0 56px; }
  .about-hero h1 { font: 600 clamp(2.4rem, 6vw, 4.2rem)/1.05 var(--font-serif); letter-spacing: -.03em; margin: 8px 0 20px; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
  .pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .pillars h2 { margin: 0 0 8px; font-size: 1.1rem; }
  .pillars p { margin: 0; color: var(--muted); }
  @media (max-width: 800px) { .pillars { grid-template-columns: 1fr; } .about-hero { padding: 16px 0 32px; } }
</style>
