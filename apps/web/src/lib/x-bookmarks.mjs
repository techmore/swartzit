const MAX_ARCHIVE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BOOKMARKS = 10_000;
const MAX_FOLDER_PATHS = 1_000;
const MAX_FOLDER_DEPTH = 12;
const TWEET_ID_KEYS = ['tweetId', 'tweet_id', 'tweetID', 'statusId', 'status_id'];

export const folderPathKey = path => JSON.stringify(path.map(name => name.toLowerCase()));

function normalizePath(path) {
  if (!Array.isArray(path) || path.length > MAX_FOLDER_DEPTH || path.some(name => typeof name !== 'string')) {
    throw new Error('Folder paths must be arrays of up to 12 folder names.');
  }
  const names = path.map(name => name.trim());
  if (names.some(name => !name || [...name].length > 80)) {
    throw new Error('Folder names must be 1–80 characters.');
  }
  return names;
}

function payloadFromArchiveFile(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Choose the bookmarks file from your X archive.');
  if (new TextEncoder().encode(value).byteLength > MAX_ARCHIVE_FILE_BYTES) {
    throw new Error('The bookmarks file is too large. Choose a single bookmarks file from the X archive.');
  }
  const source = value.trim();
  if (!source.startsWith('window.YTD.')) return source;
  const assignment = source.match(/^window\.YTD\.bookmarks\.part\d+\s*=\s*([\s\S]*?)\s*;?\s*$/);
  if (!assignment) throw new Error('Choose an X archive bookmarks file, not another archive file.');
  return assignment[1].trim().replace(/;\s*$/, '');
}

export function mergeXBookmarkImports(parts) {
  const bookmarks = new Map(), folderPaths = new Map();
  for (const part of parts) {
    for (const rawPath of part.folderPaths) {
      const path = normalizePath(rawPath);
      for (let depth = 1; depth <= path.length; depth++) {
        const prefix = path.slice(0, depth);
        folderPaths.set(folderPathKey(prefix), prefix);
      }
    }
    for (const item of part.bookmarks) {
      const path = normalizePath(item.folderPath);
      const previous = bookmarks.get(item.id);
      if (previous?.folderPath.length && path.length && folderPathKey(previous.folderPath) !== folderPathKey(path)) {
        throw new Error(`X post ${item.id} is assigned to different folders. Swartzit saves each bookmark in one folder; choose one path for this post.`);
      }
      if (!previous || (!previous.folderPath.length && path.length)) bookmarks.set(item.id, { id: item.id, folderPath: path });
    }
  }
  if (bookmarks.size > MAX_BOOKMARKS) throw new Error('Choose up to 10,000 X bookmarks per import.');
  if (folderPaths.size > MAX_FOLDER_PATHS) throw new Error('Choose up to 1,000 folders per import.');
  if (!bookmarks.size) throw new Error('No X post IDs were found in that bookmarks file.');
  return { bookmarks: [...bookmarks.values()], folderPaths: [...folderPaths.values()].sort((a, b) => a.length - b.length) };
}

export function parseXBookmarkImport(value) {
  const payload = payloadFromArchiveFile(value);
  let archive;
  try {
    // X IDs exceed JavaScript's integer precision. Quote integer ID tokens before parsing.
    const exactIds = payload.replace(/("(?:tweetId|tweet_id|tweetID|statusId|status_id)"\s*:\s*)(\d{1,24})(?=\s*[,}])/g, '$1"$2"');
    archive = JSON.parse(exactIds);
  } catch {
    throw new Error('Could not read that X bookmarks file. Choose its .js or .json bookmarks file.');
  }
  const bookmarks = [], folderPaths = [];
  const add = (record, path) => {
    for (const key of TWEET_ID_KEYS) {
      const rawId = record[key];
      const id = typeof rawId === 'string' ? rawId : Number.isSafeInteger(rawId) ? String(rawId) : '';
      if (/^\d{1,24}$/.test(id)) bookmarks.push({ id, folderPath: path });
    }
    if (path.length) folderPaths.push(path);
  };
  const visit = (node, path = [], depth = 0) => {
    if (depth > 64) throw new Error('The bookmarks file is nested too deeply.');
    if (Array.isArray(node)) { for (const item of node) visit(item, path, depth + 1); return; }
    if (!node || typeof node !== 'object') return;
    const record = node.bookmark && typeof node.bookmark === 'object' ? node.bookmark : node;
    const recordPath = normalizePath(record.folder_path ?? record.folderPath ?? path);
    if (record.folderId != null || record.folder_id != null) {
      if (!recordPath.length) throw new Error('This export has folder IDs without folder paths. Include a folder_path array for each bookmark to preserve its folder.');
    }
    add(record, recordPath);
    for (const [key, child] of Object.entries(node)) {
      if (['folder_path', 'folderPath'].includes(key)) continue;
      if (key === 'folders') throw new Error('For a folder tree, use the swartzit-x-bookmarks-v1 JSON format shown on the import screen.');
      if (child && typeof child === 'object') visit(child, recordPath, depth + 1);
    }
  };
  if (archive?.format === 'swartzit-x-bookmarks-v1') {
    visit(archive.bookmarks ?? []);
    const visitFolders = (nodes, parent = []) => {
      if (!Array.isArray(nodes)) throw new Error('Each folders field must contain an array of named folders.');
      for (const folder of nodes) {
        if (!folder || typeof folder.name !== 'string') throw new Error('Each imported folder needs a name.');
        const path = normalizePath([...parent, folder.name]);
        folderPaths.push(path);
        visit(folder.bookmarks ?? [], path);
        visitFolders(folder.folders ?? [], path);
      }
    };
    visitFolders(archive.folders ?? []);
  } else visit(archive);
  return mergeXBookmarkImports([{ bookmarks, folderPaths }]);
}

// Compatibility for flat archive callers.
export function parseXBookmarkExport(value) {
  return parseXBookmarkImport(value).bookmarks.map(item => item.id);
}
