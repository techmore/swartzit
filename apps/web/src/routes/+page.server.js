export async function load({ fetch, url }) {
  const api = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8080';
  const params = new URLSearchParams();
  if (url.searchParams.get('community')) params.set('community', url.searchParams.get('community'));
  if (url.searchParams.get('q')) params.set('q', url.searchParams.get('q'));
  const [postsResponse, communitiesResponse] = await Promise.all([
    fetch(`${api}/api/posts?${params}`), fetch(`${api}/api/communities`)
  ]);
  return { posts: postsResponse.ok ? (await postsResponse.json()).posts : [], communities: communitiesResponse.ok ? await communitiesResponse.json() : [] };
}
