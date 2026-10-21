// Sign-in request handling shared by the login page.
//
// The API answers JSON, but the public edge (Caddy, Cloudflare, a cold
// deploy) can answer with an HTML error page or close the connection. Every
// failure mode must surface as a readable message instead of an unhandled
// promise rejection that leaves the form silently stuck.

export const SESSION_STORAGE_KEY = 'swartzit_session';

/**
 * Returns a safe same-origin path for the `next` query parameter, or `/`
 * when the parameter is missing or points somewhere else.
 */
export function safeNextPath(search, fallback = '/') {
  let next = '';
  try { next = new URLSearchParams(search ?? '').get('next') ?? ''; } catch { return fallback; }
  // Browsers drop tabs and newlines from URLs and treat `\` like `/`, so
  // `/\t/evil.example` would become the protocol-relative `//evil.example`.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}

/**
 * Builds the `/login?next=…` address that brings a visitor back to where
 * they were after signing in. Absolute addresses are reduced to their path so
 * the redirect can never leave this origin.
 */
export function loginHref(current = '/') {
  let path = String(current || '/');
  try { const parsed = new URL(path, 'http://swartzit.invalid'); path = parsed.pathname + parsed.search + parsed.hash; } catch { path = '/'; }
  if (path === '/' || path.startsWith('/login') || path.startsWith('/logout')) return '/login';
  return `/login?next=${encodeURIComponent(path)}`;
}

/**
 * Posts the credentials and normalizes the outcome to
 * `{ ok, token, expiresAt, error }`. Never throws.
 */
export async function signIn({ handle, password }, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const trimmedHandle = String(handle ?? '').trim();
  if (!trimmedHandle || !password) return { ok: false, error: 'Enter your handle and password.' };
  let response;
  try {
    response = await fetchImpl('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: trimmedHandle, password })
    });
  } catch {
    return { ok: false, error: 'Could not reach Swartzit. Check your connection and try again.' };
  }
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const message = typeof payload?.error === 'string' && payload.error
      ? payload.error
      : response.status >= 500 ? 'Swartzit is temporarily unavailable. Please try again.' : 'Could not sign in.';
    return { ok: false, error: message, status: response.status };
  }
  if (typeof payload?.token !== 'string' || !payload.token) {
    return { ok: false, error: 'Swartzit returned an unexpected response. Please try again.', status: response.status };
  }
  return { ok: true, token: payload.token, expiresAt: payload.expires_at ?? null };
}

/** Stores the session token; returns false when storage is unavailable. */
export function storeSessionToken(token, storage = globalThis.localStorage) {
  try { storage.setItem(SESSION_STORAGE_KEY, token); return true; } catch { return false; }
}
