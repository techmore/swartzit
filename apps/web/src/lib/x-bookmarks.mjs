const MAX_ARCHIVE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BOOKMARKS_PER_FILE = 10_000;
const TWEET_ID_KEYS = ['tweetId', 'tweet_id', 'tweetID', 'statusId', 'status_id'];

function payloadFromArchiveFile(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Choose the bookmarks file from your X archive.');
  }
  if (new TextEncoder().encode(value).byteLength > MAX_ARCHIVE_FILE_BYTES) {
    throw new Error('The bookmarks file is too large. Choose a single bookmarks file from the X archive.');
  }

  const source = value.trim();
  if (!source.startsWith('window.YTD.')) return source;
  const assignment = source.match(/^window\.YTD\.bookmarks\.part\d+\s*=\s*([\s\S]*?)\s*;?\s*$/);
  if (!assignment) throw new Error('Choose an X archive bookmarks file, not another archive file.');
  return assignment[1].trim().replace(/;\s*$/, '');
}

export function parseXBookmarkExport(value) {
  const payload = payloadFromArchiveFile(value);
  let archive;
  try {
    const exactTweetIds = payload.replace(
      /("(?:tweetId|tweet_id|tweetID|statusId|status_id)"\s*:\s*)(\d{1,24})(?=\s*[,}])/g,
      '$1"$2"'
    );
    archive = JSON.parse(exactTweetIds);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Choose ')) throw error;
    throw new Error('Could not read that X bookmarks file. Choose its .js or .json bookmarks file.');
  }

  const ids = new Set();
  const visit = node => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const record = node.bookmark && typeof node.bookmark === 'object' ? node.bookmark : node;
    for (const key of TWEET_ID_KEYS) {
      const rawId = record[key];
      const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
      if (/^\d{1,24}$/.test(id)) ids.add(id);
    }
    for (const child of Object.values(node)) {
      if (child && typeof child === 'object') visit(child);
    }
  };
  visit(archive);

  if (!ids.size) throw new Error('No X post IDs were found in that bookmarks file.');
  if (ids.size > MAX_BOOKMARKS_PER_FILE) {
    throw new Error(`This file has more than ${MAX_BOOKMARKS_PER_FILE.toLocaleString()} bookmarks. Import one archive part at a time.`);
  }
  return [...ids];
}
