import { folderPathKey } from './x-bookmarks.mjs';

// Shared by the browser and the resumable operator CLI. Every write in this
// workflow is idempotent: folder paths, source URLs and saved bookmarks.
export async function runXBookmarkImport({ plan, request, expectedHandle, folderId = null,
  rating = 'general', concurrency = 3, resolvePost, onProgress = () => {},
  onSaved = () => {}, signal }) {
  if (!plan?.bookmarks?.length || !expectedHandle) throw new Error('Choose bookmarks and a destination account.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) throw new Error('Concurrency must be 1–6.');
  const state = { total: plan.bookmarks.length, completed: 0, saved: 0, failed: 0, pending: 0, preparing: true };
  const failures = [], destinationFolders = new Map();
  const emit = () => onProgress({ ...state }, [...failures]);
  const checkAbort = () => signal?.throwIfAborted();
  emit();
  checkAbort();
  const session = await request('/api/me');
  if (session.handle !== expectedHandle) throw new Error(`Expected u/${expectedHandle}; signed in as u/${session.handle}. Reload before importing.`);
  for (const path of plan.folderPaths) {
    checkAbort();
    const folder = await request('/api/bookmark-folders/import-path', 'POST', { path, parent_id: folderId });
    if (!Number.isSafeInteger(folder.id) || folder.id < 1) throw new Error('Swartzit did not return a folder ID.');
    destinationFolders.set(folderPathKey(path), folder.id);
  }
  state.preparing = false;
  emit();
  let next = 0;
  async function worker() {
    while (next < plan.bookmarks.length) {
      checkAbort();
      const item = plan.bookmarks[next++];
      const targetFolder = item.folderPath.length ? destinationFolders.get(folderPathKey(item.folderPath)) : folderId;
      try {
        if (item.folderPath.length && !Number.isSafeInteger(targetFolder)) throw new Error('Missing destination folder.');
        const url = `https://x.com/i/status/${item.id}`;
        const existing = await request('/api/bookmarks/import-x', 'POST', { source_url: url, folder_id: targetFolder });
        let status = existing.status, postId = existing.id;
        if (!existing.found) {
          const shared = resolvePost
            ? await resolvePost(item, { url, rating, request })
            : await request('/api/cross-post', 'POST', { url, community: 'x_imports', content_rating: rating });
          postId = Number(shared.id);
          if (!Number.isSafeInteger(postId) || postId < 1) throw new Error('Swartzit did not return a post ID.');
          await request(`/api/posts/${postId}/bookmark`, 'POST', { folder_id: targetFolder });
          status = shared.status;
        }
        // Persist a receipt only after the bookmark write completed.
        await onSaved(item, { postId, status, folderId: targetFolder });
        state.saved++;
        if (status === 'pending') state.pending++;
      } catch (cause) {
        if (signal?.aborted) throw cause;
        state.failed++;
        failures.push({ ...item, reason: cause.message || 'Could not import this X post.' });
      }
      state.completed++;
      emit();
    }
  }
  // Wait for every worker to settle before allowing another run or cleanup.
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(concurrency, state.total) }, worker));
  const rejected = outcomes.find(outcome => outcome.status === 'rejected');
  if (rejected) throw rejected.reason;
  return { ...state, failures };
}

export function createBookmarkRequest({ token, baseUrl = '', fetcher = fetch, signal,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onRetry = () => {} }) {
  if (!/^[a-f\d]{64}$/i.test(token || '')) throw new Error('A valid Swartzit session is required.');
  return async (path, method = 'GET', body) => {
    if (!path.startsWith('/api/') || path.includes('..')) throw new Error('Invalid API path.');
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(60000);
      const response = await fetcher(baseUrl.replace(/\/+$/, '') + path, {
        method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      });
      const result = response.status === 204 ? null : await response.json().catch(() => ({}));
      if (response.ok) return result;
      if (attempt < 2 && [429, 502, 503, 504].includes(response.status)) {
        const seconds = Number(response.headers?.get('retry-after'));
        const delay = Math.min(30000, Math.max(1000 * 2 ** attempt, Number.isFinite(seconds) ? seconds * 1000 : 0));
        onRetry({ path, status: response.status, delay });
        await sleep(delay);
        continue;
      }
      throw new Error(result?.error || `Swartzit request failed (HTTP ${response.status}).`);
    }
  };
}
