import { error } from '@sveltejs/kit';
import { parseDay, readingFor, isoDate } from '#lib/bible/reading.mjs';

export function load({ params }) {
  const date = parseDay(params.date);
  if (!date) error(404, 'No such day');
  const { passages: _passages, ...reading } = readingFor(date);
  const shift = days => isoDate(new Date(date.getTime() + days * 86_400_000));
  return { reading, previous: shift(-1), next: shift(1) };
}
