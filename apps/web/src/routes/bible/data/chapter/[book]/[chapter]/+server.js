import { error, json } from '@sveltejs/kit';
import { findBook, chapterPayload } from '#lib/server/bible/app-data.mjs';
import { chapterText } from '#lib/server/bible/text.mjs';

export async function GET({ locals, params, fetch }) {
  if (!locals.bible?.available) error(404, 'Not found');
  const book = findBook(params.book);
  const chapter = Number(params.chapter);
  if (!book || book.slug !== params.book || !Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) error(404, 'No such chapter');
  const text = await chapterText(book, chapter, fetch);
  return json(chapterPayload(book, chapter, text), { headers: { 'cache-control': text ? 'public, max-age=86400' : 'no-store' } });
}
