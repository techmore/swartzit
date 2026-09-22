<script>
import '../app.css'; import '../forms.css'; import '../admin.css';
import ThemeToggle from '$lib/ThemeToggle.svelte';
import AutoplayToggle from '$lib/AutoplayToggle.svelte';
import MobileNav from '$lib/MobileNav.svelte';
import { afterNavigate } from '$app/navigation';
afterNavigate(({ to }) => { if (to && !to.url.pathname.startsWith('/admin')) fetch('/api/views', { method: 'POST' }).catch(() => {}); });
</script><slot /><AutoplayToggle /><ThemeToggle /><MobileNav />
