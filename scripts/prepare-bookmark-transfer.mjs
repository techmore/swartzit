#!/usr/bin/env node
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { readXBookmarkCapture } from '../apps/web/src/lib/x-bookmark-capture.mjs';

const { values } = parseArgs({ options: { 'capture-dir': { type: 'string' }, output: { type: 'string' } } });
if (!values['capture-dir'] || !values.output) throw new Error('Use --capture-dir DIR --output FILE.');
const directory = resolve(values['capture-dir']);
const files = await Promise.all((await readdir(directory)).filter(name => /^bookmarks-.+\.json$/.test(name)).map(async name => ({ name, metadata: await stat(join(directory, name)) })));
files.sort((a, b) => a.metadata.mtimeMs - b.metadata.mtimeMs);
if (!files.length) throw new Error('No bookmark responses were captured.');
const posts = new Map(), unavailable = new Map(), cursors = [];
let terminated = false;
for (const { name, metadata } of files) {
  const captured = readXBookmarkCapture(JSON.parse(await readFile(join(directory, name), 'utf8')), { observedAt: metadata.mtime.toISOString() });
  for (const post of captured.posts) posts.set(post.source_url.split('/').at(-1), post);
  for (const failure of captured.unavailable) unavailable.set(failure.id, failure);
  if (captured.bottomCursor) cursors.push(captured.bottomCursor);
  terminated ||= captured.terminated;
}
for (const id of posts.keys()) unavailable.delete(id);
const manifest = { format: 'swartzit-x-bookmarks-v1', bookmarks: [...posts.keys()].map(tweetId => ({ tweetId })), posts: [...posts.values()], capture: { pages: files.length, terminated, cursorCount: new Set(cursors).size }, unavailable: [...unavailable.values()] };
await writeFile(resolve(values.output), JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ publicPosts: posts.size, unavailable: unavailable.size, pages: files.length, terminated, output: resolve(values.output) }));
