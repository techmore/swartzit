import { videosForBook } from '#lib/bible/readings-video.mjs';
import { error } from '@sveltejs/kit';
import { findBook, BOOKS, chapterLabel, chapterSourceUrl } from '#lib/bible/books.mjs';
import { bookTracks, chapterTrack } from '#lib/bible/audio.mjs';
import { chapterText } from '#lib/server/bible/text.mjs';

function neighbour(book, chapter, delta) {
  let index = BOOKS.indexOf(book), next = chapter + delta;
  if (next < 1) { index -= 1; if (index < 0) return null; next = BOOKS[index].chapters; }
  else if (next > book.chapters) { index += 1; if (index >= BOOKS.length) return null; next = 1; }
  const target = BOOKS[index];
  return { href: `/bible/${target.slug}/${next}`, label: chapterLabel(target, next) };
}

export async function load({ params, fetch }) {
  const book = findBook(params.book);
  const chapter = Number(params.chapter);
  if (!book || book.slug !== params.book || !Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters || String(chapter) !== params.chapter) error(404, 'No such chapter');
  return {
    book: { ...book },
    videos: videosForBook(book.slug),
    chapter,
    label: chapterLabel(book, chapter),
    text: await chapterText(book, chapter, fetch),
    track: chapterTrack(book, chapter),
    restOfBook: bookTracks(book, chapter),
    externalUrl: chapterSourceUrl(book, chapter),
    previous: neighbour(book, chapter, -1),
    next: neighbour(book, chapter, 1)
  };
}
