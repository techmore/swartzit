import { writable, get } from 'svelte/store';

// One listening queue for the whole site. The player lives in the root layout,
// so audio keeps playing while the reader moves between pages.

const MAX_TRACKS = 200;
const POSITIONS_KEY = 'swartzit_audio_positions';
const MAX_POSITIONS = 60;
/** Only long recordings (sermons, lectures) resume where they stopped. */
export const RESUME_MIN_SECONDS = 600;

export function normalizeTrack(track) {
  if (!track || typeof track !== 'object') return null;
  const src = String(track.src ?? '').trim();
  if (!/^(https:\/\/|\/)/i.test(src)) return null;
  return {
    src,
    title: String(track.title ?? '').trim() || 'Untitled recording',
    subtitle: String(track.subtitle ?? '').trim(),
    href: typeof track.href === 'string' && track.href.startsWith('/') ? track.href : '',
    artwork: typeof track.artwork === 'string' && /^https:\/\//i.test(track.artwork) ? track.artwork : ''
  };
}

export function normalizeTracks(tracks) {
  return (Array.isArray(tracks) ? tracks : []).map(normalizeTrack).filter(Boolean).slice(0, MAX_TRACKS);
}

const isAudio = item => item && typeof item === 'object' && item.kind === 'audio' && typeof item.src === 'string';

/** Audio attachments of an imported post, as player tracks. */
export function tracksFromPost(post) {
  const source = post?.source;
  const media = Array.isArray(source?.media) ? source.media.filter(isAudio) : [];
  const author = source?.profile_display_name || source?.source_author || '';
  const href = post?.public_id ? `/post/${post.public_id}` : '';
  return normalizeTracks(media.map((item, index) => ({
    src: item.src,
    title: item.alt || (media.length > 1 ? `${post?.title || 'Recording'} · Part ${index + 1}` : post?.title),
    subtitle: author,
    href,
    artwork: item.poster || ''
  })));
}

export const hasAudio = post => Array.isArray(post?.source?.media) && post.source.media.some(isAudio);

export const queue = writable({ tracks: [], index: 0, requested: 0 });

/** Replace the queue and start playing at `index`. */
export function playTracks(tracks, index = 0) {
  const clean = normalizeTracks(tracks);
  if (!clean.length) return;
  const start = Math.min(Math.max(0, Number(index) || 0), clean.length - 1);
  queue.update(state => ({ tracks: clean, index: start, requested: state.requested + 1 }));
}

/** Add tracks after the current queue without interrupting playback. */
export function enqueueTracks(tracks) {
  const clean = normalizeTracks(tracks);
  if (!clean.length) return;
  queue.update(state => {
    if (!state.tracks.length) return { tracks: clean, index: 0, requested: state.requested + 1 };
    const known = new Set(state.tracks.map(track => track.src));
    return { ...state, tracks: [...state.tracks, ...clean.filter(track => !known.has(track.src))].slice(0, MAX_TRACKS) };
  });
}

export function step(delta) {
  const state = get(queue);
  const next = state.index + delta;
  if (next < 0 || next >= state.tracks.length) return false;
  queue.set({ ...state, index: next, requested: state.requested + 1 });
  return true;
}

export function jumpTo(index) {
  const state = get(queue);
  if (index < 0 || index >= state.tracks.length) return;
  queue.set({ ...state, index, requested: state.requested + 1 });
}

export function clearQueue() {
  queue.set({ tracks: [], index: 0, requested: get(queue).requested + 1 });
}

export const isCurrent = (state, src) => Boolean(src) && state.tracks[state.index]?.src === src;

// Resume points, kept per-browser only.
function readPositions(storage) {
  try {
    const value = JSON.parse(storage?.getItem(POSITIONS_KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function savedPosition(src, storage = globalThis.localStorage) {
  const seconds = Number(readPositions(storage)[src]?.t);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function savePosition(src, seconds, duration, storage = globalThis.localStorage) {
  if (!src || !storage) return;
  const positions = readPositions(storage);
  const finished = duration > 0 && seconds > duration - 30;
  if (!(duration >= RESUME_MIN_SECONDS) || finished || seconds < 15) delete positions[src];
  else positions[src] = { t: Math.floor(seconds), at: Date.now() };
  const trimmed = Object.entries(positions).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, MAX_POSITIONS);
  try { storage.setItem(POSITIONS_KEY, JSON.stringify(Object.fromEntries(trimmed))); } catch { /* Resume is a convenience only. */ }
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60), m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
