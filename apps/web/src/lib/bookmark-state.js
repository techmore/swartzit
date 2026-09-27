// Feed pages render many bookmark controls. Coalesce their initial status
// checks into one request per signed-in session instead of one request per post.
const statusCache = new Map();
const batches = new Map();
const foldersCache = new Map();

function cacheKey(token, id) {
  return `${token}:${id}`;
}

function flush(token, batch) {
  batches.delete(token);
  const ids = [...batch.ids];
  const url = `/api/bookmarks/status?post_ids=${encodeURIComponent(ids.join(','))}`;
  fetch(url, { headers: { authorization: `Bearer ${token}` } })
    .then(async response => {
      const result = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load bookmark status.');
      return result.items || {};
    })
    .then(items => {
      for (const id of ids) {
        const value = items[String(id)] || { saved: false, folder_id: null };
        statusCache.set(cacheKey(token, id), value);
        // Each entry is a {resolve, reject} pair, so the waiter object is what
        // gets called. Iterating and calling the entries themselves throws
        // "resolve is not a function" and fails every bookmark on the page.
        for (const waiter of batch.waiters.get(id) || []) waiter.resolve(value);
      }
    })
    .catch(error => {
      for (const waiters of batch.waiters.values()) {
        for (const waiter of waiters) waiter.reject(error);
      }
    });
}

export function getBookmarkStatus(token, id) {
  const key = cacheKey(token, id);
  if (statusCache.has(key)) return Promise.resolve(statusCache.get(key));
  let batch = batches.get(token);
  if (!batch) {
    batch = { ids: new Set(), waiters: new Map() };
    batches.set(token, batch);
  }
  batch.ids.add(Number(id));
  let waiters = batch.waiters.get(Number(id));
  if (!waiters) {
    waiters = [];
    batch.waiters.set(Number(id), waiters);
  }
  const promise = new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  if (!batch.scheduled) {
    batch.scheduled = true;
    queueMicrotask(() => flush(token, batch));
  }
  return promise;
}

export function setBookmarkStatus(token, id, value) {
  statusCache.set(cacheKey(token, id), value);
}

export function getBookmarkFolders(token) {
  if (!foldersCache.has(token)) {
    foldersCache.set(token, fetch('/api/bookmark-folders', {
      headers: { authorization: `Bearer ${token}` }
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load bookmark folders.');
      return result;
    }));
  }
  return foldersCache.get(token);
}
