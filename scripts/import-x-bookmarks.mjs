#!/usr/bin/env node
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { parseXBookmarkImport, mergeXBookmarkImports } from '../apps/web/src/lib/x-bookmarks.mjs';
import { createBookmarkRequest, runXBookmarkImport } from '../apps/web/src/lib/bookmark-import.mjs';

const { values } = parseArgs({ options: {
  file: { type: 'string', multiple: true }, account: { type: 'string' },
  'base-url': { type: 'string', default: 'https://stoverparc.org' },
  'session-file': { type: 'string' }, receipt: { type: 'string' },
  'folder-id': { type: 'string' }, rating: { type: 'string', default: 'general' },
  apply: { type: 'boolean', default: false }
} });
if (!values.file?.length || !/^[a-z0-9_]{3,32}$/i.test(values.account || '')) {
  throw new Error('Use --file FILE (repeatable) --account HANDLE [--apply --session-file FILE].');
}
const base = new URL(values['base-url']);
if (base.pathname !== '/' || base.search || base.hash || base.username || base.password
  || !(base.protocol === 'https:' || base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
  throw new Error('Use an HTTPS site origin or an HTTP localhost origin.');
}
const folderId = values['folder-id'] == null ? null : Number(values['folder-id']);
if (folderId != null && (!Number.isSafeInteger(folderId) || folderId < 1)) throw new Error('Invalid destination folder ID.');
if (!['general', 'r', 'x'].includes(values.rating)) throw new Error('Invalid rating.');
const parts = [], sources = new Map();
let bytes = 0;
for (const file of values.file) {
  bytes += (await stat(file)).size;
  if (bytes > 20 * 1024 * 1024) throw new Error('Input exceeds 20 MB.');
  const text = await readFile(file, 'utf8');
  parts.push(parseXBookmarkImport(text));
  try {
    const parsed = JSON.parse(text);
    for (const source of parsed.posts ?? []) {
      const id = source.source_url?.match(/^https:\/\/x\.com\/i\/status\/(\d{1,24})$/)?.[1];
      if (!id || source.provider !== 'x') throw new Error('Invalid captured source.');
      sources.set(id, source);
    }
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    // Ordinary X archives are JavaScript assignments; the parser already read them.
  }
}
const plan = mergeXBookmarkImports(parts);
const fingerprint = createHash('sha256').update(JSON.stringify({ account: values.account, origin: base.origin, folderId, rating: values.rating, plan })).digest('hex');
console.log(JSON.stringify({ account: values.account, bookmarks: plan.bookmarks.length, folderPaths: plan.folderPaths.length, capturedPosts: sources.size, apply: values.apply }));
if (!values.apply) process.exit(0);
if (!values['session-file']) throw new Error('--apply requires --session-file; never pass tokens in command arguments.');
const sessionPath = resolve(values['session-file']);
if ((await stat(sessionPath)).mode & 0o077) throw new Error('Session file must be private (chmod 600).');
const token = (await readFile(sessionPath, 'utf8')).trim();
const request = createBookmarkRequest({ token, baseUrl: base.origin,
  onRetry: ({ status, delay }) => console.error(`Retrying HTTP ${status} after ${delay} ms.`) });
const session = await request('/api/me');
if (session.handle !== values.account) throw new Error(`Expected u/${values.account}; signed in as u/${session.handle}.`);
const receiptPath = resolve(values.receipt || 'x-bookmarks-transfer-receipt.json');
let receipt;
try { receipt = JSON.parse(await readFile(receiptPath, 'utf8')); }
catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
receipt ??= { fingerprint, account: values.account, origin: base.origin, folderId, saved: {}, failures: [] };
if (receipt.fingerprint !== fingerprint) throw new Error('Receipt belongs to a different input/account/destination. Choose another receipt path.');
// Resumed receipts are evidence, not authorization: confirm saved rows still exist
// and still belong to the intended folder before skipping them.
const verified = new Set();
const saved = Object.entries(receipt.saved);
for (let i = 0; i < saved.length; i += 100) {
  const chunk = saved.slice(i, i + 100).filter(([, entry]) => Number.isSafeInteger(entry.postId));
  if (!chunk.length) continue;
  const status = await request('/api/bookmarks/status?post_ids=' + chunk.map(([, entry]) => entry.postId).join(','));
  for (const [id, entry] of chunk) {
    const current = status.items?.[entry.postId];
    if (current?.saved && current.folder_id === entry.folderId) verified.add(id);
  }
}
const remaining = { ...plan, bookmarks: plan.bookmarks.filter(item => !verified.has(item.id)) };
receipt.failures = [];
let persistence = Promise.resolve();
const persist = () => persistence = persistence.then(async () => {
  receipt.updatedAt = new Date().toISOString();
  await writeFile(receiptPath + '.tmp', JSON.stringify(receipt, null, 2), { mode: 0o600 });
  await rename(receiptPath + '.tmp', receiptPath);
});
if (remaining.bookmarks.length) {
  let lastReported = -1;
  const result = await runXBookmarkImport({ plan: remaining, expectedHandle: values.account, folderId, rating: values.rating, request,
    resolvePost: async (item, { url, rating }) => sources.has(item.id)
      ? request('/api/posts/cross-post', 'POST', { ...sources.get(item.id), community: 'x_imports' })
      : request('/api/cross-post', 'POST', { url, community: 'x_imports', content_rating: rating }),
    onSaved: async (item, entry) => { receipt.saved[item.id] = entry; await persist(); },
    onProgress: state => {
      if (state.completed !== lastReported && (state.completed % 10 === 0 || state.completed === state.total)) {
        lastReported = state.completed;
        console.log(JSON.stringify({ processed: state.completed, saved: state.saved, failed: state.failed, total: state.total }));
      }
    }
  });
  receipt.failures = result.failures;
}
await persist();
console.log(JSON.stringify({ account: receipt.account, total: plan.bookmarks.length, verifiedBeforeRun: verified.size, savedReceipts: Object.keys(receipt.saved).length, failures: receipt.failures.length, receipt: receiptPath }));
if (receipt.failures.length) process.exitCode = 1;
