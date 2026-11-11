import { error } from '@sveltejs/kit';

// The Bible reader is part of Biblical mode and is hidden when the mode is off.
export function load({ locals }) {
  if (!locals.bible?.enabled) error(404, 'Not found');
  return {};
}
