#!/usr/bin/env node
// Read the dedicated signed-in profile's Bookmarks page. Never replay private
// API requests or save headers/cookies. Captures stay outside the checkout.
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {launchPlaywrightContext} from './x-playwright-recommended-runner.mjs';
import {readXBookmarkCapture} from '../apps/web/src/lib/x-bookmark-capture.mjs';

export async function captureBookmarks({directory, maxScrolls = 1000, launch = launchPlaywrightContext}) {
  if (!directory || !Number.isInteger(maxScrolls) || maxScrolls < 1 || maxScrolls > 10000) {
    throw new Error('Choose an output directory and 1–10000 scrolls.');
  }
  const output = resolve(directory);
  // Refuse reuse: a stale termination marker must never establish completeness.
  await mkdir(output, {mode: 0o700});
  const context = await launch();
  const ids = new Set(), unavailable = new Set();
  let pages = 0, terminated = false, failure, queue = Promise.resolve();
  try {
    const page = await context.newPage();
    page.on('response', response => {
      if (!/\/graphql\/[^/]+\/Bookmarks(?:\?|$)/.test(response.url())) return;
      queue = queue.then(async () => {
        if (failure) return;
        if (!response.ok()) throw new Error(`Bookmarks response HTTP ${response.status()}`);
        const payload = await response.json();
        const capture = readXBookmarkCapture(payload, {observedAt: new Date().toISOString()});
        await writeFile(join(output, `bookmarks-${String(++pages).padStart(6, '0')}.json`), JSON.stringify(payload), {mode: 0o600, flag: 'wx'});
        for (const post of capture.posts) ids.add(post.source_url.split('/').at(-1));
        for (const item of capture.unavailable) unavailable.add(item.id);
        terminated ||= capture.terminated;
        if (pages % 10 === 0) console.log(JSON.stringify({pages, publicPosts: ids.size, terminated}));
      }).catch(error => { failure = error; });
    });
    await page.goto('https://x.com/i/bookmarks', {waitUntil: 'domcontentloaded', timeout: 30000});
    let idle = 0, previous = 0;
    for (let scroll = 0; scroll < maxScrolls; scroll++) {
      await page.waitForTimeout(1000);
      await queue;
      if (failure) throw failure;
      if (terminated) break;
      idle = pages === previous ? idle + 1 : 0;
      previous = pages;
      if (idle >= 20) break;
      // Move to the end of the currently loaded batch. X still decides when
      // to append the next page; the response listener records every page.
      await page.mouse.wheel(0, 6000);
    }
    await queue;
    if (failure) throw failure;
    if (!pages) throw new Error('No bookmark response was captured; check the dedicated X sign-in and page.');
    for (const id of ids) unavailable.delete(id);
    const receipt = {pages, publicPosts: ids.size, unavailable: unavailable.size, terminated, output};
    await writeFile(join(output, 'capture-receipt.json'), JSON.stringify(receipt, null, 2), {mode: 0o600});
    return receipt;
  } finally { await context.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const {values} = parseArgs({options: {output: {type: 'string'}, 'max-scrolls': {type: 'string', default: '1000'}}});
  try {
    const receipt = await captureBookmarks({directory: values.output, maxScrolls: Number(values['max-scrolls'])});
    console.log(JSON.stringify(receipt));
    if (!receipt.terminated) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
