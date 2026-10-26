import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4']);
function validSource(raw) {
  if (!raw || raw.length > 2048) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ['pbs.twimg.com', 'video.twimg.com'].includes(url.hostname) && !url.username && !url.password && !url.port;
  } catch { return false; }
}
function rangeFor(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return null; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1), partial: true };
}
export async function GET({ url, request }) {
  const source = url.searchParams.get('src');
  if (!validSource(source)) return new Response('Not found', { status: 404 });
  const root = process.env.SWARTZIT_ARCHIVE_ROOT || path.resolve('state/bookmark-media-archive');
  const key = createHash('sha256').update(source).digest('hex');
  let metadata, file, fileStat;
  try {
    metadata = JSON.parse(await readFile(path.join(root, 'index', `${key}.json`), 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(metadata.sha256) || !types.has(metadata.mime) || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) throw new Error('Invalid archive metadata');
    file = path.join(root, 'objects', metadata.sha256); fileStat = await stat(file);
    if (!fileStat.isFile() || fileStat.size !== metadata.size) throw new Error('Archive object is missing or incomplete');
  } catch {
    return new Response(null, { status: 302, headers: { location: source, 'cache-control': 'no-store' } });
  }
  const range = rangeFor(request.headers.get('range'), metadata.size);
  if (!range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${metadata.size}`, 'accept-ranges': 'bytes' } });
  const headers = { 'content-type': metadata.mime, 'content-length': String(range.end - range.start + 1), 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=31536000, immutable', etag: `"${metadata.sha256}"`, 'x-content-type-options': 'nosniff' };
  if (range.partial) headers['content-range'] = `bytes ${range.start}-${range.end}/${metadata.size}`;
  return new Response(Readable.toWeb(createReadStream(file, { start: range.start, end: range.end })), { status: range.partial ? 206 : 200, headers });
}
