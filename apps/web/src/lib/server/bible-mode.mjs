import { apiUrl } from '#lib/server/api-url.mjs';

// Bible mode is a per-visitor choice. The admin decides whether it is
// available on this instance and which mode new visitors start in; each
// visitor's own choice is kept in the MODE_COOKIE cookie. Every page render
// needs the instance config, so keep a short-lived copy instead of asking the
// API on every request. An admin change shows up within CACHE_MS.
const CACHE_MS = 15_000;
export const MODE_COOKIE = 'swartzit_mode';
export const MODES = Object.freeze(['standard', 'bible']);
const DISABLED = Object.freeze({ available: false, defaultMode: 'standard', communities: [] });
let cached = { value: DISABLED, expires: 0 };
let pending = null;

export function parseBibleConfig(value) {
  if (!value || value.enabled !== true) return DISABLED;
  const communities = Array.isArray(value.communities)
    ? value.communities.filter(slug => typeof slug === 'string' && /^[a-z0-9_]{1,40}$/.test(slug))
    : [];
  // Servers from before per-visitor modes send no default: everyone was in Bible mode.
  const defaultMode = value.default_mode === 'standard' ? 'standard' : 'bible';
  return Object.freeze({ available: true, defaultMode, communities });
}

/** Only same-site paths, so the mode switch cannot be used as an open redirect. */
export function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value.slice(0, 2000);
}

/** One visitor's view of Bible mode. `enabled` means this visitor sees Bible mode. */
export function viewerMode(config, cookieValue) {
  if (!config?.available) return { available: false, enabled: false, mode: 'standard', defaultMode: 'standard', communities: [] };
  const mode = MODES.includes(cookieValue) ? cookieValue : config.defaultMode;
  return { available: true, enabled: mode === 'bible', mode, defaultMode: config.defaultMode, communities: [...config.communities] };
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
