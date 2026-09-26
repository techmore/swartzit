import { error } from '@sveltejs/kit';
export async function load({ fetch, url }) {
  const api = '';
  const params = new URLSearchParams();
  if (url.searchParams.get('community')) params.set('community', url.searchParams.get('community'));
  if (url.searchParams.get('q')) params.set('q', url.searchParams.get('q'));
  const requestedFeed = url.searchParams.get('feed');
  const hideR = ['true', '1'].includes(url.searchParams.get('hide_r'));
  // X-rated content is opt-in for the default feed. Keep accepting the old
  // `hide_x=false` form as an explicit opt-in for bookmarked/API-style links.
  const showX = ['true', '1'].includes(url.searchParams.get('show_x')) || ['false', '0'].includes(url.searchParams.get('hide_x'));
  const hideX = !showX;
  // Keep old mature-only links working as the R+X rated view.
  const matureOnly = ['true', '1'].includes(url.searchParams.get('mature'));
  const validRatings = ['r', 'x', 'rx'];
  const ratingsParam = url.searchParams.get('ratings');
  const ratings = validRatings.includes(ratingsParam) ? ratingsParam : 'rx';
  // Keep the homepage chronological while the recommendation feed is paused.
  // Normalize old links that still request `recommended` so they do not bring
  // the paused ranking back into the primary user path.
  const feedMode = requestedFeed === 'following'
    ? 'following'
    : requestedFeed === 'rated' || matureOnly ? 'rated' : 'timeline';
  const useRatings = feedMode === 'rated' || matureOnly || (requestedFeed === 'following' && validRatings.includes(ratingsParam));
  if (useRatings) {
    // Exact positive selection overrides hide-R / hide-X preferences, so an
    // R+X view really includes X-rated posts even though X is hidden by default.
    params.set('ratings', ratings);
  } else {
    if (hideR) params.set('hide_r', 'true');
    params.set('hide_x', String(hideX));
  }
  const requestedSort = url.searchParams.get('sort');
  params.set('sort', requestedSort === 'recommended' ? 'newest' : (requestedSort ?? 'newest'));
  if (url.searchParams.has('page')) params.set('page',url.searchParams.get('page'));
  let [postsResponse, communitiesResponse] = await Promise.all([
    fetch(`${api}/api/posts?${params}`), fetch(`${api}/api/communities`)
  ]);
  if (!postsResponse.ok || !communitiesResponse.ok) error(503, 'Discussions are temporarily unavailable. Please try again.');
  const result = await postsResponse.json();
  return { posts: result.posts, hasMore: result.has_more, communities: await communitiesResponse.json(), sort: params.get('sort'), q: params.get('q') ?? '', community: params.get('community') ?? '', page: Number(params.get('page') ?? 1), feed: feedMode, hideR: useRatings ? false : hideR, hideX: useRatings ? false : hideX, matureOnly: useRatings, ratings: useRatings ? ratings : null };
}
