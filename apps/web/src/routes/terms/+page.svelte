<script>
  let { data } = $props();
</script>

<svelte:head><title>Terms of use · Swartzit</title></svelte:head>

<main id="main-content" class="legal">
  <p class="eyebrow">Policy</p>
  <h1 class="page-title">Terms of use</h1>
  <p class="lede">By using Swartzit on this server or in the Swartzit apps, you agree to these terms.</p>

  <h2>No tolerance for abuse</h2>
  <p>There is no tolerance for objectionable content or abusive users. You must not post or send anything that is:</p>
  <ul>
    <li>sexually explicit, or that sexualises anyone under 18;</li>
    <li>hateful, harassing, threatening, or that encourages violence or self-harm;</li>
    <li>illegal, or that infringes someone else’s rights;</li>
    <li>spam, scams, or impersonation.</li>
  </ul>

  <h2>Reporting and blocking</h2>
  <p>Every post and comment has a Report button, and in the apps you can block a person or a source so you no longer see them. The operator reviews reports within 24 hours, removes content that breaks these terms, and suspends or removes the accounts responsible.</p>

  <h2>Your content</h2>
  <p>You keep ownership of what you post, and you give this server permission to store and show it publicly. Public posts may be copied by feed readers, exports, and mirrors.</p>

  <h2>Content from elsewhere</h2>
  <p>Some posts link to or quote material from other sites, podcasts, and video services, which remains the property of its owners. Scripture text and LibriVox recordings are in the public domain.</p>

  <h2>Your account</h2>
  <p>Keep your password private. You can delete your account at any time; see <a href="/privacy">Privacy</a>. The operator may suspend accounts that break these terms.</p>

  <h2>No warranty</h2>
  <p>Swartzit is provided as is, without warranty. The operator may change these terms; continuing to use Swartzit after a change means you accept it.</p>

  <h2>Contact</h2>
  {#if data.contact}<p>Report a problem: <a href="mailto:{data.contact}">{data.contact}</a>.</p>
  {:else}<p>Report a problem with the Report button on any post, or through the <a href="/about">About</a> page.</p>{/if}
</main>

<style>
  .legal { max-width: 720px; }
  .legal h2 { margin: 28px 0 8px; font-size: 1.15rem; }
  .legal p, .legal li { line-height: 1.65; }
  .legal ul { padding-left: 20px; }
  .legal a { color: var(--link); text-decoration: underline; text-underline-offset: 3px; }
</style>
