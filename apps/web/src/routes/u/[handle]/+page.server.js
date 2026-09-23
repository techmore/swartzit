import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function load({ fetch, params }) {
  const api = env.API_URL ?? '';
  const response = await fetch(`${api}/api/users/${encodeURIComponent(params.handle)}`);
  if (response.status === 404) error(404, 'Profile not found');
  if (!response.ok) error(503, 'Profiles are temporarily unavailable');
  return await response.json();
}
