import { chapterLabel } from '#lib/bible/books.mjs';

// Public-domain King James text from bible-api.com, cached in memory. Pages
// still render (with audio and a link out) if the text service is down.
const MAX_ENTRIES = 400;
const TTL_MS = 7 * 24 * 3600 * 1000;
const cache = new Map();

export function parseChapter(json, book, chapter) {
  const verses = Array.isArray(json?.verses) ? json.verses : [];
  const clean = verses
    .filter(v => Number(v?.chapter) === chapter && Number.isInteger(Number(v?.verse)) && typeof v?.text === 'string')
    .map(v => ({ verse: Number(v.verse), text: v.text.replace(/\s+/g, ' ').trim() }))
    .filter(v => v.text);
  if (!clean.length) return null;
  return { reference: chapterLabel(book, chapter), translation: 'King James Version', verses: clean };
}

export async function chapterText(book, chapter, fetchImpl = fetch) {
  const key = `${book.code}.${chapter}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const url = `https://bible-api.com/${encodeURIComponent(`${book.name} ${chapter}`)}?translation=kjv`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json', 'user-agent': 'swartzit-bible/1.0' } });
    if (!response.ok) return hit?.value ?? null;
    const value = parseChapter(await response.json(), book, chapter);
    if (value) {
      cache.set(key, { value, expires: Date.now() + TTL_MS });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    }
    return value;
  } catch {
    return hit?.value ?? null;
  }
}

