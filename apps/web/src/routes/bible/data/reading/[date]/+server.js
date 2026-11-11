import { error, json } from '@sveltejs/kit';
import { reading } from '#lib/server/bible/app-data.mjs';
import { parseDay } from '#lib/bible/reading.mjs';

export function GET({ locals, params }) {
  if (!locals.bible?.available) error(404, 'Not found');
  const date = parseDay(params.date);
  if (!date) error(400, 'Use a date like 2026-11-10');
  return json(reading(date), { headers: { 'cache-control': 'public, max-age=3600' } });
}
