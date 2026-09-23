#!/usr/bin/env node
// Read public X profile timelines through a dedicated Ego Lite browser session.
// This is intentionally separate from the official-API runner: it is a
// Mac-local, read-only test path that never opens X compose or performs an
// account action. The worker must allow-list EGO_BROWSER_SPACE_ID and, when
// needed, EGO_BROWSER_CLI for this command.

import {spawn} from 'node:child_process';
import {resolveXPost} from '../apps/web/src/lib/x-source.mjs';

export const BROWSER_DEMO_ACCOUNTS = ['beautyshowcase', 'Rawpkw'];
export const BROWSER_DEMO_DEFAULTS = {hours: 168, limit: 8, perSource: 20, delayMs: 2000};

export function browserDemoOptions({hours = BROWSER_DEMO_DEFAULTS.hours, limit = BROWSER_DEMO_DEFAULTS.limit, perSource = BROWSER_DEMO_DEFAULTS.perSource, delayMs = BROWSER_DEMO_DEFAULTS.delayMs} = {}) {
  const options = {accounts: [...BROWSER_DEMO_ACCOUNTS], hours: Number(hours), limit: Number(limit), perSource: Number(perSource), delayMs: Number(delayMs)};
  if (!Number.isInteger(options.hours) || options.hours < 1 || options.hours > 168) throw Error('Browser X hours must be an integer from 1 to 168');
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 8) throw Error('Browser X limit must be an integer from 1 to 8');
  if (!Number.isInteger(options.perSource) || options.perSource < 1 || options.perSource > 50) throw Error('Browser X per-source limit must be an integer from 1 to 50');
  if (!Number.isInteger(options.delayMs) || options.delayMs < 1000 || options.delayMs > 30000) throw Error('Browser X delay must be between 1000 and 30000 milliseconds');
  return options;
}

export function browserScript(options, spaceId) {
  const config = JSON.stringify({...options, spaceId});
  return `
const CONFIG = ${config};
const task = await taskSpace(CONFIG.spaceId);
const page = task.page('p1');
const end = new Date();
const start = new Date(end.getTime() - CONFIG.hours * 60 * 60 * 1000);

const extractPosts = ({account, startMs, endMs, limit}) => {
  const parseMetric = (labels, name) => {
    const label = labels.find(value => new RegExp('^\\\\d[\\\\d,.]*\\\\s+' + name + '\\\\b', 'i').test(value));
    if (!label) return null;
    const match = label.match(/^[\\d,.]+/);
    if (!match) return null;
    const value = Number(match[0].replaceAll(',', ''));
    return Number.isSafeInteger(value) ? value : null;
  };

  return [...document.querySelectorAll('article[data-testid="tweet"]')]
  .map(article => {
    const links = [...article.querySelectorAll('a[href*="/status/"]')]
      .map(link => link.href)
      .filter(href => /\\/status\\/\\d+/.test(href));
    const sourceUrl = links.find(href => {
      try { return new URL(href).pathname.split('/').filter(Boolean)[0]?.toLowerCase() === account.toLowerCase(); } catch { return false; }
    }) || links[0];
    const publishedAt = article.querySelector('time')?.getAttribute('datetime') || '';
    const body = article.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || '';
    const labels = [...article.querySelectorAll('button[aria-label]')].map(button => button.getAttribute('aria-label')).filter(Boolean);
    const socialContext = article.querySelector('[data-testid="socialContext"]')?.innerText || '';
    const text = article.innerText || '';
    const imageMedia = [...article.querySelectorAll('[data-testid="tweetPhoto"] img[src]')].map(image => ({kind: 'image', src: image.src, alt: image.alt || null}));
    const videoMedia = [...article.querySelectorAll('video[src]')]
      .map(video => ({kind: 'video', src: video.currentSrc || video.src, poster: video.getAttribute('poster') || null, alt: null}))
      .filter(media => /^https:\\/\\/video\\.twimg\\.com\\/.+\\.mp4(?:[?#].*)?$/i.test(media.src)
        && (!media.poster || /^https:\\/\\/pbs\\.twimg\\.com\\//i.test(media.poster)));
    return {sourceUrl, publishedAt, body, labels, socialContext, text, media: [...imageMedia, ...videoMedia]};
  })
  .filter(post => {
    const publishedMs = Date.parse(post.publishedAt);
    if (!post.sourceUrl || !Number.isFinite(publishedMs) || publishedMs < startMs || publishedMs > endMs || !post.body) return false;
    if (/\\breposted\\b|\\bquoted\\b/i.test(post.socialContext) || /\\breposted\\b/i.test(post.text.slice(0, 160))) return false;
    return true;
  })
  .slice(0, limit)
  .map(post => {
    const url = new URL(post.sourceUrl);
    const author = url.pathname.split('/').filter(Boolean)[0] || account;
    return {
      provider: 'x',
      source_url: post.sourceUrl,
      source_author: '@' + author,
      title: (post.body.split(/\\r?\\n/, 1)[0] || 'Post by @' + author).slice(0, 300),
      body: post.body,
      content_rating: 'general',
      published_at: new Date(post.publishedAt).toISOString(),
      observed_at: new Date().toISOString(),
      source_views: parseMetric(post.labels, 'views'),
      source_likes: parseMetric(post.labels, 'Likes'),
      source_reposts: parseMetric(post.labels, 'reposts'),
      source_replies: parseMetric(post.labels, 'Replies'),
      media: post.media,
      source_comments: [],
      profile_url: 'https://x.com/' + author,
      attribution: 'Collected from a dedicated read-only Ego Lite X session; source: ' + post.sourceUrl
    };
  });
};

const collected = [];
for (let index = 0; index < CONFIG.accounts.length; index += 1) {
  const account = CONFIG.accounts[index];
  await page.goto('https://x.com/' + account);
  await page.waitForSelector('article[data-testid="tweet"]', {state: 'visible', timeout: 20000});
  await page.waitForTimeout(1000);
  const pageText = await page.evaluate(() => document.body?.innerText || '');
  if (/sign in|log in/i.test(pageText) && !/posts?\\s*$/im.test(pageText)) throw Error('The dedicated Ego Lite X session is not signed in');
  collected.push(...await page.evaluate(extractPosts, {account, startMs: start.getTime(), endMs: end.getTime(), limit: CONFIG.perSource}));
  if (index + 1 < CONFIG.accounts.length) await page.waitForTimeout(CONFIG.delayMs);
}

const unique = new Map();
for (const post of collected) {
  const current = unique.get(post.source_url);
  if (!current || (post.source_likes || 0) > (current.source_likes || 0)) unique.set(post.source_url, post);
}
const posts = [...unique.values()]
  .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
  .slice(0, CONFIG.limit);
process.stdout.write(JSON.stringify({posts}) + '\\n');
`;
}

export function runBrowserScript(script, cli) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['nodejs', '-e', script], {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim();
        return reject(Error(detail || `Ego Lite exited with ${code ?? signal}`));
      }
      const lines = `${stdout}\n${stderr}`.trim().split('\n').reverse();
      for (const line of lines) {
        try {
          const receipt = JSON.parse(line);
          if (receipt && typeof receipt === 'object') return resolve(receipt);
        } catch {}
      }
      reject(Error('Ego Lite did not return a JSON runner receipt'));
    });
  });
}

export async function collectFromEgoSession(options = {}, {spaceId = process.env.EGO_BROWSER_SPACE_ID, cli = process.env.EGO_BROWSER_CLI || 'ego-browser', run = runBrowserScript, resolve = resolveXPost} = {}) {
  const normalized = browserDemoOptions(options);
  const id = Number(spaceId);
  if (!Number.isInteger(id) || id < 1) throw Error('EGO_BROWSER_SPACE_ID must identify the dedicated logged-in Ego Lite task space');
  const receipt = await run(browserScript(normalized, id), cli);
  if (!Array.isArray(receipt?.posts)) throw Error('Ego Lite runner receipt must contain a posts array');
  const resolved = [];
  for (const candidate of receipt.posts.slice(0, normalized.limit)) {
    if (!candidate || typeof candidate.source_url !== 'string' || !candidate.source_url.trim()) continue;
    const post = await resolve(candidate.source_url.trim());
    resolved.push({
      ...post,
      content_rating: 'general',
      attribution: `Collected from a dedicated read-only Ego Lite X session; source: ${post.source_url}`
    });
  }
  return [...new Map(resolved.map(post => [post.source_url, post])).values()].slice(0, normalized.limit);
}

async function main() {
  const posts = await collectFromEgoSession();
  process.stdout.write(`${JSON.stringify({posts})}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
