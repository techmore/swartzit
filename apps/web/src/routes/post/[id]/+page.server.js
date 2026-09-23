import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function load({ fetch, params }) {
  // Use the configured server-side API for crawlers and link unfurlers. The
  // browser still uses the same-origin proxy after hydration.
  const api = env.API_URL ?? '';
  const response = await fetch(`${api}/api/posts/${encodeURIComponent(params.id)}`);
  if (response.status === 404) error(404, 'Discussion not found');
  if (!response.ok) error(503, 'Discussions are temporarily unavailable');
  const result = await response.json();
  let related_posts = [];
  if (result.post.comment_count >= 50) {
    const query = new URLSearchParams({ community: result.post.community, sort: 'newest' });
    const relatedResponse = await fetch(`${api}/api/posts?${query}`);
    if (relatedResponse.ok) {
      const related = await relatedResponse.json();
      related_posts = related.posts.filter(post => post.public_id !== result.post.public_id).slice(0, 4);
    }
  }
  return { ...result, related_posts };
}
