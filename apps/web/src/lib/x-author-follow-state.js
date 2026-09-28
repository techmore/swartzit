import { get, writable } from 'svelte/store';
import { normalizeXAuthorHandle } from './x-author-follow.mjs';

export const xAuthorFollowState = writable({});

let activeToken = '';
let loadPromise = null;

export function loadXAuthorFollowState(token) {
  if (!token) {
    activeToken = '';
    loadPromise = null;
    xAuthorFollowState.set({});
    return Promise.resolve({});
  }
  if (activeToken === token && loadPromise) return loadPromise;

  activeToken = token;
  xAuthorFollowState.set({});
  loadPromise = fetch('/api/x-author-subscriptions', {
    headers: { authorization: `Bearer ${token}` }
  }).then(async response => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load followed people.');
    if (!Array.isArray(result)) throw new Error('The followed people list was invalid.');
    const followed = Object.fromEntries(result
      .map(normalizeXAuthorHandle)
      .filter(Boolean)
      .map(handle => [handle, true]));
    if (activeToken === token) xAuthorFollowState.set(followed);
    return followed;
  }).catch(error => {
    if (activeToken === token) {
      activeToken = '';
      loadPromise = null;
    }
    throw error;
  });
  return loadPromise;
}

export async function setXAuthorFollow(token, handle, following) {
  const normalized = normalizeXAuthorHandle(handle);
  if (!normalized) throw new Error('Use a valid X handle.');

  const response = await fetch('/api/x-author-subscriptions', {
    method: following ? 'POST' : 'DELETE',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ handle: normalized })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not update followed people.');

  if (activeToken !== token) {
    activeToken = token;
    loadPromise = Promise.resolve({});
  }
  const next = { ...get(xAuthorFollowState) };
  if (following) next[normalized] = true;
  else delete next[normalized];
  xAuthorFollowState.set(next);
  return result;
}
