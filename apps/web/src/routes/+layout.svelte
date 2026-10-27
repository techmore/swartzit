<script>
  export let data;
  import '../app.css'; import '../admin.css';
  import AdSenseLoader from '#lib/AdSenseLoader.svelte';
  import SiteHeader from '#lib/SiteHeader.svelte';
  import MobileNav from '#lib/MobileNav.svelte';
  import PostComposer from '#lib/PostComposer.svelte';
  import { afterNavigate } from '$app/navigation';
afterNavigate(({ to }) => {
  if (to && !to.url.pathname.startsWith('/admin')) {
    fetch('/api/views', { method: 'POST' }).catch(() => {});
    window.dispatchEvent(new CustomEvent('project:page', {detail: to.url.pathname}));
  }
});
// Every page renders its own <main>, so the skip link resolves it at click
// time instead of relying on a shared id.
function skipToContent(event) {
  const main = document.querySelector('main');
  if (!main) return;
  event.preventDefault();
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus();
  main.scrollIntoView({ block: 'start' });
}
</script>
<svelte:head><script src="/project-analytics.js" defer></script></svelte:head>
<a class="skip-link" href="#main-content" onclick={skipToContent}>Skip to content</a>
<AdSenseLoader clientId={data.adsenseClientId} />
<SiteHeader />
<slot />
<PostComposer />
<MobileNav />
