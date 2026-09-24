#!/usr/bin/env node
// Read one unseen public X status from the signed-in For You/Recommended
// timeline through a dedicated Playwright Chromium profile. This is a
// server-side alternative to the Mac-only Ego Lite bridge and is intentionally
// read-only: it never likes, reposts, follows, messages, or opens compose.

import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {parseXStatusUrl, resolveXPost} from '../apps/web/src/lib/x-source.mjs';
import {canonicalStatusUrl, loadSeen, recommendedOptions, recommendedStatePath, saveSeen} from './x-recommended-session-runner.mjs';

const require = createRequire(import.meta.url);

function expandHome(value) {
  const text = String(value || '').trim();
  if (text === '~') return homedir();
  if (text.startsWith('~/')) return join(homedir(), text.slice(2));
  return text;
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function playwrightRecommendedOptions(options = {}) {
  return recommendedOptions({
    candidateLimit: options.candidateLimit ?? envNumber('X_PLAYWRIGHT_CANDIDATE_LIMIT', undefined),
    scrolls: options.scrolls ?? envNumber('X_PLAYWRIGHT_SCROLLS', undefined),
    delayMs: options.delayMs ?? envNumber('X_PLAYWRIGHT_DELAY_MS', undefined),
    seenLimit: options.seenLimit ?? envNumber('X_PLAYWRIGHT_SEEN_LIMIT', undefined)
  });
}

export function playwrightProfilePath({cwd = process.cwd(), env = process.env} = {}) {
  const configured = expandHome(env.X_PLAYWRIGHT_USER_DATA_DIR);
  if (configured) return configured;
  const stateDir = expandHome(
    env.SWARTZIT_WORKER_STATE_DIR || env.SWARTZIT_STATE_DIR || join(cwd, '.local')
  );
  return join(stateDir, 'x-playwright-profile');
}

export function playwrightHeadless({env = process.env} = {}) {
  const value = String(env.X_PLAYWRIGHT_HEADLESS ?? '').trim().toLowerCase();
  if (!value) return true;
  return !['0', 'false', 'off', 'no'].includes(value);
}

export async function launchPlaywrightContext({
  userDataDir = playwrightProfilePath(),
  headless = playwrightHeadless(),
  executablePath = process.env.X_PLAYWRIGHT_EXECUTABLE_PATH || '',
  moduleName = process.env.SWARTZIT_PLAYWRIGHT_MODULE || 'playwright'
} = {}) {
  let resolved;
  try {
    resolved = moduleName.startsWith('/') ? moduleName : require.resolve(moduleName);
  } catch (error) {
    throw new Error(
      `Playwright is not installed for the Swartzit worker; run npm ci and npx playwright install --with-deps chromium (${error.message})`
    );
  }
  const {chromium} = await import(resolved.startsWith('file:') ? resolved : pathToFileURL(resolved).href);
  await mkdir(expandHome(userDataDir), {recursive: true});
  return chromium.launchPersistentContext(expandHome(userDataDir), {
    headless,
    ...(executablePath.trim() ? {executablePath: expandHome(executablePath)} : {}),
    viewport: {width: 1280, height: 900},
    locale: 'en-US'
  });
}

async function waitForTimeline(page) {
  try {
    await page.waitForSelector('article[data-testid="tweet"]', {state: 'visible', timeout: 20000});
  } catch (error) {
    const pageText = await page.locator('body').innerText().catch(() => '');
    if (/sign\s*in|log\s*in/i.test(pageText)) {
      throw new Error('The dedicated Playwright X profile is not signed in; log into X once in that profile and retry');
    }
    throw error;
  }
}

async function selectRecommendedTab(page) {
  const changed = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[role="tab"], a')];
    const candidate = nodes.find(node => {
      const text = node.textContent || '';
      return /\bfor you\b|\brecommended\b/i.test(text) && !/\bfollowing\b/i.test(text);
    });
    if (!candidate || candidate.getAttribute('aria-selected') === 'true') return false;
    candidate.click();
    return true;
  });
  if (changed) {
    await page.waitForTimeout(1000);
    await waitForTimeline(page);
  }
}

async function extractCandidates(page, seenSourceUrls, limit) {
  return page.evaluate(({seenSourceUrls, limit}) => {
    const seen = new Set(seenSourceUrls);
    const found = new Set();
    const canonical = raw => {
      try {
        const url = new URL(raw);
        if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname.toLowerCase())) return null;
        const parts = url.pathname.split('/').filter(Boolean);
        const statusIndex = parts.findIndex(part => part === 'status');
        const id = statusIndex >= 0 ? parts[statusIndex + 1] : null;
        return /^\d{1,24}$/.test(id || '') ? 'https://x.com/i/status/' + id : null;
      } catch {
        return null;
      }
    };
    return [...document.querySelectorAll('article[data-testid="tweet"]')].flatMap(article => {
      const text = article.innerText || '';
      if (/^\s*(promoted|advertisement|ad)\b/i.test(text)) return [];
      const context = article.querySelector('[data-testid="socialContext"]')?.innerText || '';
      if (/\breposted\b/i.test(context) || /\breposted\b/i.test(text.slice(0, 180))) return [];
      const sourceUrl = [...article.querySelectorAll('a[href*="/status/"]')]
        .map(link => canonical(link.href))
        .find(Boolean);
      if (!sourceUrl || seen.has(sourceUrl) || found.has(sourceUrl)) return [];
      found.add(sourceUrl);
      return [sourceUrl];
    }).slice(0, limit);
  }, {seenSourceUrls, limit});
}

export async function collectSourceUrlsWithPlaywright(options = {}, {
  launch = launchPlaywrightContext,
  userDataDir = playwrightProfilePath(),
  headless = playwrightHeadless(),
  executablePath = process.env.X_PLAYWRIGHT_EXECUTABLE_PATH || ''
} = {}) {
  const normalized = playwrightRecommendedOptions(options);
  const context = await launch({userDataDir, headless, executablePath});
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://x.com/home', {waitUntil: 'domcontentloaded', timeout: 30000});
    await waitForTimeline(page);
    await selectRecommendedTab(page);

    const candidates = [];
    for (let index = 0; index <= normalized.scrolls && candidates.length < normalized.candidateLimit; index += 1) {
      const found = await extractCandidates(page, candidates, normalized.candidateLimit);
      for (const candidate of found) if (!candidates.includes(candidate)) candidates.push(candidate);
      if (candidates.length >= normalized.candidateLimit || index === normalized.scrolls) break;
      await page.evaluate(() => window.scrollBy(0, Math.max(650, Math.floor(window.innerHeight * 0.85))));
      await page.waitForTimeout(normalized.delayMs);
    }
    return {timeline: 'recommended', source_urls: candidates.slice(0, normalized.candidateLimit)};
  } finally {
    await context.close();
  }
}

export async function collectFromPlaywrightRecommended(options = {}, {
  resolve = resolveXPost,
  statePath = recommendedStatePath(),
  load = loadSeen,
  save = saveSeen,
  run = collectSourceUrlsWithPlaywright,
  dryRun = process.env.RUNNER_DRY_RUN === 'true'
} = {}) {
  const normalized = playwrightRecommendedOptions(options);
  const seen = new Set((await load(statePath)).map(canonicalStatusUrl).filter(Boolean));
  const receipt = await run(normalized);
  const rawCandidates = Array.isArray(receipt?.source_urls) ? receipt.source_urls : [];
  const candidates = [...new Set(rawCandidates.map(canonicalStatusUrl).filter(Boolean))]
    .filter(sourceUrl => !seen.has(sourceUrl));
  for (const sourceUrl of candidates) {
    try {
      const post = await resolve(sourceUrl);
      const canonical = canonicalStatusUrl(post?.source_url) || sourceUrl;
      if (seen.has(canonical)) continue;
      if (!dryRun) await save(statePath, [...seen, canonical], normalized.seenLimit);
      return [{
        ...post,
        provider: 'x',
        source_url: canonical,
        content_rating: 'general',
        attribution: `Collected from the X Recommended timeline through Playwright; source: ${canonical}`
      }];
    } catch (error) {
      console.error(`Could not resolve ${sourceUrl}: ${error.message}`);
    }
  }
  return [];
}

async function main() {
  const posts = await collectFromPlaywrightRecommended();
  process.stdout.write(`${JSON.stringify({posts})}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
