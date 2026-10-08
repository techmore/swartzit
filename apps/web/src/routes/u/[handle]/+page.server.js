import { error } from '@sveltejs/kit';
import { apiUrl } from '#lib/server/api-url.mjs';

export async function load({ fetch, params, url }) {
  const api = apiUrl('');
  const candidate = url.searchParams.get('tab');
  const requestedTab = ['posts', 'replies', 'media', 'activity'].includes(candidate) ? candidate : 'posts';
  const response = await fetch(`${api}/api/users/${encodeURIComponent(params.handle)}?tab=${requestedTab}`);
  if (response.status === 404) error(404, 'Profile not found');
  if (!response.ok) error(503, 'Profiles are temporarily unavailable');
  return {...await response.json(), tab: requestedTab};
}
