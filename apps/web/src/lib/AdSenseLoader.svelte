<script>
  export let clientId = null;

  function syncScript() {
    if (typeof document === 'undefined') return;
    const existing = document.querySelector('script[data-swartzit-adsense]');
    if (!clientId) {
      existing?.remove();
      return;
    }
    if (existing?.dataset.publisherId === clientId) return;
    existing?.remove();

    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.swartzitAdsense = 'true';
    script.dataset.publisherId = clientId;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
    document.head.append(script);
  }

  $: syncScript();
</script>
