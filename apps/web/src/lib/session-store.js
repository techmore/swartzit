// One shared view of "who is signed in" for the navigation components.
//
// The header, the mobile bottom bar, and other widgets used to each call
// `/api/me` on mount. Sharing one request per page load keeps them in
// agreement and avoids repeating the round trip for every component.
import { writable } from 'svelte/store';

export const SESSION_STORAGE_KEY = 'swartzit_session';

/** `undefined` until checked, `null` when signed out, otherwise the account. */
export const currentUser = writable(undefined);

let pending = null;

export function readSessionToken(storage = globalThis.localStorage) {
  try { return storage?.getItem(SESSION_STORAGE_KEY) ?? ''; } catch { return ''; }
}

/**
 * Resolves the signed-in account (or `null`) and publishes it to
 * `currentUser`. Concurrent callers share a single request.
 */
export function loadCurrentUser({ fetch: fetchImpl = globalThis.fetch, storage = globalThis.localStorage } = {}) {
  if (pending) return pending;
  const token = readSessionToken(storage);
  if (!token) {
    currentUser.set(null);
    pending = Promise.resolve(null);
    return pending;
  }
  pending = fetchImpl('/api/me', { headers: { authorization: `Bearer ${token}` } })
    .then(async response => {
      if (!response.ok) return null;
      const user = await response.json();
      return user && typeof user.handle === 'string' ? user : null;
    })
    .catch(() => null)
    .then(user => { currentUser.set(user); return user; });
  return pending;
}

/** Forgets the cached account, for sign-out and for tests. */
export function resetCurrentUser() {
  pending = null;
  currentUser.set(undefined);
}
