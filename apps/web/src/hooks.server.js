import { bibleMode } from '#lib/server/bible-mode.mjs';

export async function handle({ event, resolve }) {
  // API proxy and media routes do not render HTML.
  if (event.url.pathname.startsWith('/api/')) return resolve(event);
  const bible = await bibleMode();
  event.locals.bible = bible;
  if (!bible.enabled) return resolve(event);
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('<html lang="en">', '<html lang="en" data-mode="reformed">')
  });
}
