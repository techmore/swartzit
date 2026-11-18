import { error, json } from '@sveltejs/kit';
import { library } from '#lib/server/bible/app-data.mjs';

let cached;
export function GET({ locals }) {
  if (!locals.bible?.available) error(404, 'Not found');
  cached ??= library();
  return json(cached, { headers: { 'cache-control': 'public, max-age=3600' } });
}
