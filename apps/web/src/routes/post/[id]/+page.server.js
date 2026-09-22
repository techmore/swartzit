import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function load({ fetch, params }) {
  // Use the configured server-side API for crawlers and link unfurlers. The
  // browser still uses the same-origin proxy after hydration.
  const api = env.API_URL ?? '';
  const response = await fetch(`${api}/api/posts/${encodeURIComponent(params.id)}`);
  if (response.status === 404) error(404, 'Discussion not found');
  if (!response.ok) error(503, 'Discussions are temporarily unavailable');
  return await response.json();
}
