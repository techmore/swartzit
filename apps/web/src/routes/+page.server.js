import { error } from '@sveltejs/kit';
export async function load({ fetch, url }) {
  const api = '';
  const params = new URLSearchParams();
  if (url.searchParams.get('community')) params.set('community', url.searchParams.get('community'));
  if (url.searchParams.get('q')) params.set('q', url.searchParams.get('q'));
  const [postsResponse, communitiesResponse] = await Promise.all([
    fetch(`${api}/api/posts?${params}`), fetch(`${api}/api/communities`)
  ]);
  if (!postsResponse.ok || !communitiesResponse.ok) error(503, 'Discussions are temporarily unavailable. Please try again.');
  return { posts: (await postsResponse.json()).posts, communities: await communitiesResponse.json() };
}
