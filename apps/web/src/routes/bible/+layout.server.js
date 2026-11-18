import { error } from '@sveltejs/kit';

// The Bible reader is part of Bible mode and is hidden when an admin has not
// made the mode available. A visitor in Standard mode can still open it.
export function load({ locals }) {
  if (!locals.bible?.available) error(404, 'Not found');
  return {};
}
