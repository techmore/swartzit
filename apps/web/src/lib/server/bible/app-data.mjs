import { BOOKS, findBook, chapterLabel, chapterSourceUrl } from '#lib/bible/books.mjs';
import { segmentsFor, chapterTrack, AUDIO_SOURCE } from '#lib/bible/audio.mjs';
import { readingFor } from '#lib/bible/reading.mjs';
import catechism from '#lib/bible/westminster-shorter-catechism.json' with { type: 'json' };

// JSON for native app clients. The app downloads the library once (books,
// every audio recording, the catechism) and asks for chapter text and the
// day's reading as needed, so the server stays the single source of content.

export const LIBRARY_VERSION = 1;

export function library() {
  return {
    version: LIBRARY_VERSION,
    translation: 'King James Version',
    audio_source: AUDIO_SOURCE,
    books: BOOKS.map(book => ({
      slug: book.slug,
      name: book.name,
      code: book.code,
      testament: book.testament,
      chapters: book.chapters,
      recordings: segmentsFor(book).map(s => ({ start: s.start, end: s.end, url: s.url, seconds: s.seconds ?? null, readers: s.readers ?? [] }))
    })),
    catechism: { title: catechism.title, year: catechism.year, source: catechism.source, questions: catechism.questions }
  };
}

const passage = ({ book, chapter }) => ({ book: book.slug, name: book.name, chapter, label: chapterLabel(book, chapter) });

export function reading(date) {
  const day = readingFor(date);
  return {
    date: day.date,
    day: day.day,
    summary: day.summary,
    passages: day.passages.map(passage),
    tracks: day.tracks.map(t => ({ url: t.src, title: t.title, subtitle: t.subtitle }))
  };
}

export function chapterPayload(book, chapter, text) {
  const track = chapterTrack(book, chapter);
  return {
    book: book.slug,
    name: book.name,
    chapter,
    label: chapterLabel(book, chapter),
    translation: 'King James Version',
    verses: text?.verses ?? [],
    text_available: Boolean(text?.verses?.length),
    source_url: chapterSourceUrl(book, chapter),
    recording: track ? { url: track.src, title: track.title, subtitle: track.subtitle } : null,
    previous: chapter > 1 ? { book: book.slug, chapter: chapter - 1 } : neighbour(book, -1),
    next: chapter < book.chapters ? { book: book.slug, chapter: chapter + 1 } : neighbour(book, 1)
  };
}

function neighbour(book, direction) {
  const target = BOOKS[BOOKS.indexOf(book) + direction];
  if (!target) return null;
  return { book: target.slug, chapter: direction < 0 ? target.chapters : 1 };
}

export { findBook };
