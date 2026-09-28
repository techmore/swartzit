const restrictedAdPaths = ['/admin', '/login', '/signup', '/logout'];

export async function load({ fetch, url }) {
  const restricted = restrictedAdPaths.some(path =>
    url.pathname === path || url.pathname.startsWith(`${path}/`)
  );
  if (restricted) return { adsenseClientId: null };

  try {
    const response = await fetch('/api/adsense/config');
    if (!response.ok) return { adsenseClientId: null };
    const config = await response.json();
    return {
      adsenseClientId: config.enabled && typeof config.publisher_id === 'string'
        ? config.publisher_id
        : null
    };
  } catch {
    return { adsenseClientId: null };
  }
}
