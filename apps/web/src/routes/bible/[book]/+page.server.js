import { error } from '@sveltejs/kit';
import { findBook, BOOKS, chapterLabel } from '#lib/bible/books.mjs';
import { bookTracks, segmentFor } from '#lib/bible/audio.mjs';

export function load({ params }) {
  const book = findBook(params.book);
  if (!book || book.slug !== params.book) error(404, 'No such book');
  const index = BOOKS.indexOf(book);
  const tracks = bookTracks(book);
  return {
    book: { ...book },
    chapters: Array.from({ length: book.chapters }, (_, i) => {
      const segment = segmentFor(book, i + 1);
      return { number: i + 1, label: chapterLabel(book, i + 1), trackIndex: segment ? tracks.findIndex(t => t.src === segment.url) : -1 };
    }),
    tracks,
    previous: index > 0 ? { slug: BOOKS[index - 1].slug, name: BOOKS[index - 1].name } : null,
    next: index < BOOKS.length - 1 ? { slug: BOOKS[index + 1].slug, name: BOOKS[index + 1].name } : null
  };
}
