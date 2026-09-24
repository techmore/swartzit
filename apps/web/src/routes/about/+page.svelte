<script>
  import SessionNav from '$lib/SessionNav.svelte';
  import Brand from '$lib/Brand.svelte';
</script>

<svelte:head><title>About Swartzit</title></svelte:head>

<header>
  <Brand />
  <span>Read freely. Participate under a pseudonym. Take your community with you.</span>
  <SessionNav />
</header>

<main class="about-page">
  <section class="about-hero">
    <p class="eyebrow">THE OPEN DISCUSSION NETWORK</p>
    <h1>Conversations that belong to their communities.</h1>
    <p class="lede">Public posts and comments stay readable without an account. Join when you’re ready to contribute.</p>
  </section>

  <section class="about-details" aria-label="About Swartzit">
    <div>
      <p class="eyebrow">A PUBLIC COMMONS</p>
      <h2>Read first. Join when it feels right.</h2>
    </div>
    <p>Swartzit keeps community conversations open to everyone. Browse discussions, follow the ideas that matter to you, and participate under a pseudonym when you’re ready.</p>
  </section>

  <a class="back-link" href="/">← Browse discussions</a>
</main>

<style>
  .about-page{max-width:1180px}
  .about-hero{max-width:760px;padding:58px 0 84px}
  .about-hero h1{font:500 clamp(2.8rem,7vw,5.8rem)/1.02 Georgia,serif;letter-spacing:-.055em;color:var(--heading,#173d34);margin:18px 0 24px}
  .eyebrow{font-size:.72rem;letter-spacing:.16em;color:var(--accent,#9b5e38);font-weight:700}
  .lede{font-size:1.2rem;line-height:1.6;color:var(--muted,#5c6b66);max-width:560px}
  .about-details{border-top:1px solid var(--border,#d8d5ca);border-bottom:1px solid var(--border,#d8d5ca);display:grid;grid-template-columns:1fr 1fr;gap:60px;padding:32px 0;margin-bottom:28px;max-width:900px}
  .about-details h2{font:500 1.8rem/1.15 Georgia,serif;color:var(--heading,#173d34);margin:12px 0 0;max-width:320px}
  .about-details p:last-child{color:var(--muted,#53615d);margin:0;max-width:460px}
  .back-link{color:var(--accent,#9b5e38);font-weight:700;font-size:.9rem}
  @media(max-width:700px){.about-page{padding:28px 18px 80px}.about-hero{padding:28px 0 54px}.about-hero h1{font-size:2.8rem}.lede{font-size:1.05rem}.about-details{display:block;padding:24px 0}.about-details h2{margin-bottom:22px}}
</style>
