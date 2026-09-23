import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function load({ fetch, params, url }) {
  const api = env.API_URL ?? '';
  const candidate = url.searchParams.get('tab');
  const requestedTab = ['posts', 'replies', 'media', 'activity'].includes(candidate) ? candidate : 'posts';
  const response = await fetch(`${api}/api/users/${encodeURIComponent(params.handle)}?tab=${requestedTab}`);
  if (response.status === 404) error(404, 'Profile not found');
  if (!response.ok) error(503, 'Profiles are temporarily unavailable');
  return {...await response.json(), tab: requestedTab};
}
