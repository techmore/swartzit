import { error, redirect } from '@sveltejs/kit';
import { MODE_COOKIE, MODES, safeNext } from '#lib/server/bible-mode.mjs';

const ONE_YEAR = 60 * 60 * 24 * 365;

// Each visitor's own choice of Standard or Bible mode, from the header switch.
// The switch sends JSON and then reloads; without JavaScript it falls back to
// a plain form post and this redirects back to the page it came from.
export async function POST({ request, cookies, locals, url }) {
  if (!locals.bible?.available) error(404, 'Not found');
  const json = (request.headers.get('content-type') ?? '').startsWith('application/json');
  const input = json ? await request.json().catch(() => ({})) : Object.fromEntries(await request.formData());
  const mode = String(input?.mode ?? '');
  if (!MODES.includes(mode)) error(400, 'Mode must be standard or bible');
  cookies.set(MODE_COOKIE, mode, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax', httpOnly: true, secure: url.protocol === 'https:' });
  if (json) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  redirect(303, safeNext(String(input.next ?? '/')));
}
