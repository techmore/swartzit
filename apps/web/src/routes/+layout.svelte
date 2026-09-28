<script>
  export let data;
  import '../app.css'; import '../forms.css'; import '../admin.css';
  import AdSenseLoader from '$lib/AdSenseLoader.svelte';
  import MobileNav from '$lib/MobileNav.svelte';
import { afterNavigate } from '$app/navigation';
afterNavigate(({ to }) => { if (to && !to.url.pathname.startsWith('/admin')) fetch('/api/views', { method: 'POST' }).catch(() => {}); });
</script><AdSenseLoader clientId={data.adsenseClientId} /><slot /><MobileNav />
