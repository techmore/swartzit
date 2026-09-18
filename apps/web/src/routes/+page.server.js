import { error } from '@sveltejs/kit';
export async function load({ fetch, url }) {
  const api = '';
  const params = new URLSearchParams();
  if (url.searchParams.get('community')) params.set('community', url.searchParams.get('community'));
  if (url.searchParams.get('q')) params.set('q', url.searchParams.get('q'));
  for (const key of ['sort','page']) if (url.searchParams.has(key)) params.set(key,url.searchParams.get(key));
  const [postsResponse, communitiesResponse] = await Promise.all([
    fetch(`${api}/api/posts?${params}`), fetch(`${api}/api/communities`)
  ]);
  if (!postsResponse.ok || !communitiesResponse.ok) error(503, 'Discussions are temporarily unavailable. Please try again.');
  const feed = await postsResponse.json();
  return { posts: feed.posts, hasMore: feed.has_more, communities: await communitiesResponse.json(), sort: params.get('sort') ?? 'newest', q: params.get('q') ?? '', community: params.get('community') ?? '', page: Number(params.get('page') ?? 1) };
}
