import { bibleMode, viewerMode, MODE_COOKIE } from '#lib/server/bible-mode.mjs';

export async function handle({ event, resolve }) {
  // API proxy and media routes do not render HTML.
  if (event.url.pathname.startsWith('/api/')) return resolve(event);
  const bible = viewerMode(await bibleMode(), event.cookies.get(MODE_COOKIE));
  event.locals.bible = bible;
  if (!bible.enabled) return resolve(event);
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('<html lang="en">', '<html lang="en" data-mode="reformed">')
  });
}
