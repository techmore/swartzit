#!/usr/bin/env node
// Read one unseen public X status from the signed-in For You/Recommended
// timeline through a dedicated Ego Lite session. This is intentionally
// read-only: it never likes, reposts, follows, messages, or opens compose.

import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {parseXStatusUrl, resolveXPost} from '../apps/web/src/lib/x-source.mjs';
import {runBrowserScript} from './x-ego-session-runner.mjs';

export const RECOMMENDED_DEFAULTS = {
  candidateLimit: 20,
  scrolls: 5,
  delayMs: 900,
  seenLimit: 1000
};

export function recommendedOptions({candidateLimit = RECOMMENDED_DEFAULTS.candidateLimit, scrolls = RECOMMENDED_DEFAULTS.scrolls, delayMs = RECOMMENDED_DEFAULTS.delayMs, seenLimit = RECOMMENDED_DEFAULTS.seenLimit} = {}) {
  const options = {
    candidateLimit: Number(candidateLimit),
    scrolls: Number(scrolls),
    delayMs: Number(delayMs),
    seenLimit: Number(seenLimit)
  };
  if (!Number.isInteger(options.candidateLimit) || options.candidateLimit < 1 || options.candidateLimit > 50) throw Error('Recommended X candidate limit must be an integer from 1 to 50');
  if (!Number.isInteger(options.scrolls) || options.scrolls < 0 || options.scrolls > 12) throw Error('Recommended X scrolls must be an integer from 0 to 12');
  if (!Number.isInteger(options.delayMs) || options.delayMs < 500 || options.delayMs > 5000) throw Error('Recommended X delay must be between 500 and 5000 milliseconds');
  if (!Number.isInteger(options.seenLimit) || options.seenLimit < 10 || options.seenLimit > 10000) throw Error('Recommended X seen limit must be an integer from 10 to 10000');
  return options;
}

export function canonicalStatusUrl(raw) {
  try { return parseXStatusUrl(String(raw || '').trim()).source_url; } catch { return null; }
}

function stateSlug(value) {
  return String(value || 'recommended').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'recommended';
}

export function recommendedStatePath({runnerName = process.env.SWARTZIT_RUNNER_NAME, cwd = process.cwd()} = {}) {
  return join(cwd, '.local', 'x-recommended', `${stateSlug(runnerName)}.json`);
}

export async function loadSeen(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    const values = Array.isArray(parsed) ? parsed : parsed?.seen_source_urls;
    return Array.isArray(values) ? values.map(canonicalStatusUrl).filter(Boolean) : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function saveSeen(path, urls, limit) {
  await mkdir(dirname(path), {recursive: true});
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({seen_source_urls: urls.slice(-limit), updated_at: new Date().toISOString()}) + '\n', {mode: 0o600});
  await rename(temporary, path);
}

export function browserScript(options, spaceId, seenUrls = []) {
  const config = JSON.stringify({...options, spaceId, seenUrls});
  return `
const CONFIG = ${config};
const task = await taskSpace(CONFIG.spaceId);
const page = task.page('p1');

const canonicalStatusUrl = raw => {
  try {
    const url = new URL(raw);
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const statusIndex = parts.findIndex(part => part === 'status');
    const id = statusIndex >= 0 ? parts[statusIndex + 1] : null;
    return /^\\d{1,24}$/.test(id || '') ? 'https://x.com/i/status/' + id : null;
  } catch { return null; }
};

await page.goto('https://x.com/home');
await page.waitForSelector('article[data-testid="tweet"]', {state: 'visible', timeout: 20000});
await page.waitForTimeout(1000);

// X normally opens /home on For You. If the session remembers Following,
// select the visible For You tab before collecting anything.
const changedTimeline = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('[role="tab"], a')];
  const forYou = tabs.find(node => /\\bfor you\\b|\\brecommended\\b/i.test(node.textContent || '') && !/\\bfollowing\\b/i.test(node.textContent || ''));
  if (!forYou || forYou.getAttribute('aria-selected') === 'true') return false;
  forYou.click();
  return true;
});
if (changedTimeline) {
  await page.waitForTimeout(1000);
  await page.waitForSelector('article[data-testid="tweet"]', {state: 'visible', timeout: 20000});
}

const extractCandidates = (seenSourceUrls, limit) => page.evaluate(({seenSourceUrls, limit}) => {
  const seen = new Set(seenSourceUrls);
  const found = new Set();
  return [...document.querySelectorAll('article[data-testid="tweet"]')].flatMap(article => {
    const text = article.innerText || '';
    if (/^\\s*(promoted|advertisement|ad)\\b/i.test(text)) return [];
    const context = article.querySelector('[data-testid="socialContext"]')?.innerText || '';
    if (/\\breposted\\b/i.test(context) || /\\breposted\\b/i.test(text.slice(0, 180))) return [];
    const sourceUrl = [...article.querySelectorAll('a[href*="/status/"]')]
      .map(link => link.href)
      .map(href => {
        try {
          const url = new URL(href);
          const parts = url.pathname.split('/').filter(Boolean);
          const statusIndex = parts.findIndex(part => part === 'status');
          const id = statusIndex >= 0 ? parts[statusIndex + 1] : null;
          return /^\\d{1,24}$/.test(id || '') ? 'https://x.com/i/status/' + id : null;
        } catch { return null; }
      })
      .find(Boolean);
    if (!sourceUrl || seen.has(sourceUrl) || found.has(sourceUrl)) return [];
    found.add(sourceUrl);
    return [sourceUrl];
  }).slice(0, limit);
}, {seenSourceUrls, limit});

const candidates = [];
for (let index = 0; index <= CONFIG.scrolls && candidates.length < CONFIG.candidateLimit; index += 1) {
  for (const candidate of await extractCandidates(candidates.concat(CONFIG.seenUrls), CONFIG.candidateLimit)) {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  if (candidates.length >= CONFIG.candidateLimit || index === CONFIG.scrolls) break;
  await page.evaluate(() => window.scrollBy(0, Math.max(650, Math.floor(window.innerHeight * 0.85))));
  await page.waitForTimeout(CONFIG.delayMs);
}

process.stdout.write(JSON.stringify({timeline: 'recommended', source_urls: candidates.slice(0, CONFIG.candidateLimit)}) + '\\n');
`;
}

export async function collectFromRecommendedSession(options = {}, {
  spaceId = process.env.EGO_BROWSER_SPACE_ID,
  cli = process.env.EGO_BROWSER_CLI || 'ego-browser',
  run = runBrowserScript,
  resolve = resolveXPost,
  statePath = recommendedStatePath(),
  load = loadSeen,
  save = saveSeen,
  dryRun = process.env.RUNNER_DRY_RUN === 'true'
} = {}) {
  const normalized = recommendedOptions(options);
  const id = Number(spaceId);
  if (!Number.isInteger(id) || id < 1) throw Error('EGO_BROWSER_SPACE_ID must identify the dedicated logged-in Ego Lite task space');
  const seen = new Set((await load(statePath)).map(canonicalStatusUrl).filter(Boolean));
  const receipt = await run(browserScript(normalized, id, [...seen]), cli);
  const rawCandidates = Array.isArray(receipt?.source_urls)
    ? receipt.source_urls
    : Array.isArray(receipt?.posts) ? receipt.posts.map(post => post?.source_url) : [];
  const candidates = [...new Set(rawCandidates.map(canonicalStatusUrl).filter(Boolean))]
    .filter(sourceUrl => !seen.has(sourceUrl));
  for (const sourceUrl of candidates) {
    try {
      const post = await resolve(sourceUrl);
      const canonical = canonicalStatusUrl(post?.source_url) || sourceUrl;
      if (seen.has(canonical)) continue;
      if (!dryRun) await save(statePath, [...seen, canonical], normalized.seenLimit);
      return [{...post, provider: 'x', source_url: canonical, content_rating: 'general', attribution: `Collected from the X Recommended timeline; source: ${canonical}`}];
    } catch (error) {
      console.error(`Could not resolve ${sourceUrl}: ${error.message}`);
    }
  }
  return [];
}

async function main() {
  const posts = await collectFromRecommendedSession();
  process.stdout.write(`${JSON.stringify({posts})}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
