import { apiUrl } from '#lib/server/api-url.mjs';

// Biblical mode is an instance-wide admin setting. Every page render needs it
// (theme, navigation), so keep a short-lived copy instead of asking the API
// on every request. A toggle in Admin shows up within CACHE_MS.
const CACHE_MS = 15_000;
const DISABLED = Object.freeze({ enabled: false, communities: [] });
let cached = { value: DISABLED, expires: 0 };
let pending = null;

export function parseBibleConfig(value) {
  if (!value || value.enabled !== true) return DISABLED;
  const communities = Array.isArray(value.communities)
    ? value.communities.filter(slug => typeof slug === 'string' && /^[a-z0-9_]{1,40}$/.test(slug))
    : [];
  return Object.freeze({ enabled: true, communities });
}

export async function bibleMode(fetchImpl = fetch, now = Date.now()) {
  if (now < cached.expires) return cached.value;
  pending ??= (async () => {
    try {
      const response = await fetchImpl(new URL('/api/bible/config', apiUrl()), { signal: AbortSignal.timeout(3000) });
      const value = response.ok ? parseBibleConfig(await response.json()) : cached.value;
      cached = { value, expires: Date.now() + CACHE_MS };
      return value;
    } catch {
      // Keep the last known mode while the API restarts.
      cached = { value: cached.value, expires: Date.now() + 2_000 };
      return cached.value;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function resetBibleModeCache() { cached = { value: DISABLED, expires: 0 }; pending = null; }
