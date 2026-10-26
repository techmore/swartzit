// Older APIs return bookmark metadata only. Hydrate those rows through the
// normal public post endpoint, with a bounded pool and an error per saved row.
export async function loadBookmarkContent(items, {request, onPost, onError, concurrency = 4}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) throw new Error('Invalid concurrency');
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try {
        if (typeof item.body === 'string') {
          onPost(item.post_id, {...item, id: item.post_id});
        } else if (item.moderation_status !== 'pending') {
          const result = await request(`/api/posts/${encodeURIComponent(item.public_id)}`);
          if (!result?.post || result.post.id !== item.post_id) throw new Error('Could not load this saved post.');
          onPost(item.post_id, result.post);
        }
      } catch (error) { onError(item.post_id, error.message || 'Could not load this saved post.'); }
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, worker));
}
