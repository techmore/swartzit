import { error } from '@sveltejs/kit';
export async function load({ fetch, url }) {
  const api = '';
  const params = new URLSearchParams();
  if (url.searchParams.get('community')) params.set('community', url.searchParams.get('community'));
  if (url.searchParams.get('q')) params.set('q', url.searchParams.get('q'));
  const feedMode = url.searchParams.get('feed') === 'following' ? 'following' : 'recommended';
  params.set('sort', url.searchParams.get('sort') ?? (feedMode === 'following' ? 'newest' : 'recommended'));
  if (url.searchParams.has('page')) params.set('page',url.searchParams.get('page'));
  let [postsResponse, communitiesResponse] = await Promise.all([
    fetch(`${api}/api/posts?${params}`), fetch(`${api}/api/communities`)
  ]);
  // Keep the feed available when an older server does not recognize the
  // recommended sort added by a newer web build.
  if (!postsResponse.ok && params.get('sort') === 'recommended') {
    const failure = await postsResponse.clone().json().catch(() => ({}));
    if (postsResponse.status === 400 && failure.error === 'Unknown sort order') {
      params.set('sort', 'newest');
      postsResponse = await fetch(`${api}/api/posts?${params}`);
    }
  }
  if (!postsResponse.ok || !communitiesResponse.ok) error(503, 'Discussions are temporarily unavailable. Please try again.');
  const result = await postsResponse.json();
  return { posts: result.posts, hasMore: result.has_more, communities: await communitiesResponse.json(), sort: params.get('sort'), q: params.get('q') ?? '', community: params.get('community') ?? '', page: Number(params.get('page') ?? 1), feed: feedMode };
}
