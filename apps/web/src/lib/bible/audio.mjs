import { BOOKS, findBook, chapterLabel, chapterPath } from './books.mjs';
import map from './kjv-audio.json' with { type: 'json' };

// Public-domain LibriVox recordings of the King James Version, streamed from
// archive.org. Each recording ("segment") covers one or more consecutive
// chapters — Titus is a single seven-minute file for chapters 1–3 — so a
// chapter plays the recording that contains it. `kjv-audio.json` is checked
// in, so pages never depend on a search API at request time.

const segmentsByBook = new Map();
for (const entry of Array.isArray(map?.books) ? map.books : []) {
  const book = findBook(entry.book);
  if (!book || !Array.isArray(entry.segments)) continue;
  segmentsByBook.set(book.slug, entry.segments
    .filter(s => Number.isInteger(s.start) && Number.isInteger(s.end) && s.start <= s.end && typeof s.url === 'string' && s.url.startsWith('https://'))
    .sort((a, b) => a.start - b.start));
}

export const AUDIO_SOURCE = map?.source || 'LibriVox (public domain)';

export const segmentsFor = book => segmentsByBook.get(book.slug) ?? [];

export function segmentFor(book, chapter) {
  return segmentsFor(book).find(s => s.start <= chapter && chapter <= s.end) ?? null;
}

export function segmentLabel(book, segment) {
  if (segment.start === segment.end) return chapterLabel(book, segment.start);
  return `${book.name} ${segment.start}–${segment.end}`;
}

function segmentTrack(book, segment) {
  const readers = Array.isArray(segment.readers) && segment.readers.length ? ` · read by ${segment.readers.join(', ')}` : '';
  return { src: segment.url, title: segmentLabel(book, segment), subtitle: `King James Version${readers} (LibriVox)`, href: chapterPath(book, segment.start) };
}

/** The recording that contains a chapter, labelled with the chapters it covers. */
export function chapterTrack(book, chapter) {
  const segment = segmentFor(book, chapter);
  return segment ? segmentTrack(book, segment) : null;
}

/** Recordings for a whole book, or from the one containing `fromChapter` to the end. */
export function bookTracks(book, fromChapter = 1) {
  return segmentsFor(book).filter(s => s.end >= fromChapter).map(s => segmentTrack(book, s));
}

/** Recordings for a list of passages, in order, without repeats. */
export function passageTracks(passages) {
  const seen = new Set();
  const tracks = [];
  for (const { book, chapter } of passages) {
    const track = chapterTrack(book, chapter);
    if (track && !seen.has(track.src)) { seen.add(track.src); tracks.push(track); }
  }
  return tracks;
}

export function audioCoverage() {
  return BOOKS.map(book => {
    const covered = new Set(segmentsFor(book).flatMap(s => Array.from({ length: s.end - s.start + 1 }, (_, i) => s.start + i)));
    return { slug: book.slug, chapters: book.chapters, withAudio: [...covered].filter(c => c >= 1 && c <= book.chapters).length };
  });
}
