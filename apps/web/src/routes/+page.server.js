import { error } from '@sveltejs/kit';
export async function load({ fetch, url }) {
  const api = '';
  const params = new URLSearchParams();
  if (url.searchParams.get('community')) params.set('community', url.searchParams.get('community'));
  if (url.searchParams.get('q')) params.set('q', url.searchParams.get('q'));
  const hideR = ['true', '1'].includes(url.searchParams.get('hide_r'));
  const hideX = ['true', '1'].includes(url.searchParams.get('hide_x'));
  if (hideR) params.set('hide_r', 'true');
  if (hideX) params.set('hide_x', 'true');
  // Keep the homepage chronological while the recommendation feed is paused.
  // Normalize old links that still request `recommended` so they do not bring
  // the paused ranking back into the primary user path.
  const feedMode = url.searchParams.get('feed') === 'following' ? 'following' : 'timeline';
  const requestedSort = url.searchParams.get('sort');
  params.set('sort', requestedSort === 'recommended' ? 'newest' : (requestedSort ?? 'newest'));
  if (url.searchParams.has('page')) params.set('page',url.searchParams.get('page'));
  let [postsResponse, communitiesResponse] = await Promise.all([
    fetch(`${api}/api/posts?${params}`), fetch(`${api}/api/communities`)
  ]);
  if (!postsResponse.ok || !communitiesResponse.ok) error(503, 'Discussions are temporarily unavailable. Please try again.');
  const result = await postsResponse.json();
  return { posts: result.posts, hasMore: result.has_more, communities: await communitiesResponse.json(), sort: params.get('sort'), q: params.get('q') ?? '', community: params.get('community') ?? '', page: Number(params.get('page') ?? 1), feed: feedMode, hideR, hideX };
}
