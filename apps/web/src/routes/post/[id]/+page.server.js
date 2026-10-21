import { error } from '@sveltejs/kit';
import { apiUrl } from '#lib/server/api-url.mjs';
import { canonicalPostUrl, publicOrigin } from '#lib/server/public-origin.mjs';

export async function load({ fetch, params, url }) {
  // Use the configured server-side API for crawlers and link unfurlers. The
  // browser still uses the same-origin proxy after hydration.
  const api = apiUrl('');
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
  // Canonical and social-preview links point at this instance (or the
  // operator-configured SWARTZIT_ORIGIN), never at a hard-coded domain.
  const canonical_url = canonicalPostUrl(publicOrigin(url), result.post.public_id);
  return { ...result, related_posts, canonical_url };
}
