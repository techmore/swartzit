// Publish Biblical-mode content into Swartzit through the admin import API.
//
//   node scripts/bible-feed.mjs --job reading            # today's reading plan post
//   node scripts/bible-feed.mjs --job book --book titus  # next chapter of a book (add --all for every chapter)
//   node scripts/bible-feed.mjs --job sermons            # newest sermons and teaching from configured feeds
//   node scripts/bible-feed.mjs --job catechism          # next Westminster Shorter Catechism question
//   node scripts/bible-feed.mjs --job daily              # reading + sermons + catechism (for a timer)
//
// Add --dry-run to print the records without publishing. Credentials come from
// SCHEDULER_HANDLE / SCHEDULER_PASSWORD or .local/import-scheduler.env, the same
// admin account the other scheduled imports use. Everything is idempotent:
// each post has a stable source URL, so a rerun updates rather than duplicates.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBook, chapterLabel, chapterSourceUrl } from '../apps/web/src/lib/bible/books.mjs';
import { chapterTrack } from '../apps/web/src/lib/bible/audio.mjs';
import { readingFor, parseDay, isoDate } from '../apps/web/src/lib/bible/reading.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'swartzit-bible-feed/1.0';
const KJV_CREDIT = 'Scripture: King James Version (public domain). Audio: LibriVox recordings (public domain), streamed from the Internet Archive.';

// ---------------------------------------------------------------- RSS parsing

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };

export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const unwrap = value => String(value ?? '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');

/** Turn feed HTML into readable plain paragraphs. */
export function htmlToText(html) {
  const text = decodeEntities(unwrap(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ''));
  return text.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? decodeEntities(unwrap(match[1])).trim() : '';
}

function attr(xml, name, attribute) {
  const match = xml.match(new RegExp(`<${name}\\s[^>]*?${attribute}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeEntities(match[2] ?? match[3]).trim() : '';
}

/** Parse an RSS 2.0 podcast feed into channel info and audio items. */
export function parseFeed(xml) {
  const channelXml = String(xml).replace(/<item[\s>][\s\S]*?<\/item>/gi, '');
  const channel = {
    title: htmlToText(tag(channelXml, 'title')),
    link: tag(channelXml, 'link'),
    author: htmlToText(tag(channelXml, 'itunes:author')),
    image: attr(channelXml, 'itunes:image', 'href') || tag(tag(channelXml, 'image'), 'url')
  };
  const items = [];
  for (const [, item] of String(xml).matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const enclosure = attr(item, 'enclosure', 'url');
    const type = attr(item, 'enclosure', 'type');
    if (!enclosure || (type && !type.startsWith('audio/'))) continue;
    const published = Date.parse(tag(item, 'pubDate'));
    items.push({
      title: htmlToText(tag(item, 'title')),
      link: tag(item, 'link'),
      guid: tag(item, 'guid'),
      description: htmlToText(tag(item, 'content:encoded') || tag(item, 'description') || tag(item, 'itunes:summary')),
      author: htmlToText(tag(item, 'itunes:author') || tag(item, 'dc:creator')),
      audio: enclosure,
      image: attr(item, 'itunes:image', 'href'),
      published_at: Number.isFinite(published) ? new Date(published).toISOString() : null
    });
  }
  return { channel, items };
}

/** A YouTube channel's Atom feed (https://www.youtube.com/feeds/videos.xml?channel_id=…). */
export function parseYouTubeFeed(xml) {
  const text = String(xml);
  const channelId = tag(text.replace(/<entry[\s>][\s\S]*?<\/entry>/gi, ''), 'yt:channelId');
  const entries = [];
  for (const [, entry] of text.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)) {
    const id = tag(entry, 'yt:videoId');
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
    const published = Date.parse(tag(entry, 'published'));
    entries.push({
      id,
      channel_id: tag(entry, 'yt:channelId') || channelId,
      title: htmlToText(tag(entry, 'title')),
      description: htmlToText(tag(entry, 'media:description')),
      published_at: Number.isFinite(published) ? new Date(published).toISOString() : null
    });
  }
  return { channel_id: channelId, entries };
}

// ------------------------------------------------------------ record builders

const isHttps = value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
// Streamable formats only: some church feeds also publish 1 GB WAV masters.
const AUDIO_PATH = /\.(mp3|m4a|aac|ogg|oga|opus)$/i;
const IMAGE_PATH = /\.(jpe?g|png|webp|gif)$/i;
const pathOf = value => { try { return new URL(value).pathname; } catch { return ''; } };
const clip = (text, max) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * Some feeds give every episode the same web page link. A shared link cannot
 * identify a post, so those items fall back to their (unique) audio URL.
 */
export function sharedLinksRemoved(items) {
  const counts = new Map();
  for (const item of items) if (item.link) counts.set(item.link, (counts.get(item.link) ?? 0) + 1);
  return items.map(item => (item.link && counts.get(item.link) > 1 ? { ...item, link: '' } : item));
}

export function sermonRecord(feed, item, observedAt = new Date()) {
  if (!item.title || !isHttps(item.audio) || !AUDIO_PATH.test(pathOf(item.audio))) return null;
  const source = [item.link, item.audio].find(url => isHttps(url) && !/[?#]/.test(new URL(url).search + new URL(url).hash)) || item.audio;
  const art = [item.image, feed.image].find(url => isHttps(url) && IMAGE_PATH.test(pathOf(url)));
  const speaker = item.author || feed.speaker || '';
  const body = [speaker && speaker !== feed.name ? `*${speaker}*` : '', clip(item.description || '', 1800)].filter(Boolean).join('\n\n');
  return {
    community: feed.community,
    provider: 'rss',
    source_url: source,
    source_author: feed.name,
    profile_display_name: feed.name,
    title: clip(item.title, 300),
    body,
    published_at: item.published_at,
    observed_at: observedAt.toISOString(),
    media: [{ kind: 'audio', src: item.audio, alt: clip(item.title, 300), ...(art ? { poster: art } : {}) }],
    attribution: `From ${feed.name}${feed.church ? ` (${feed.church})` : ''}. Audio streams from the publisher.`
  };
}

/** A YouTube video from an official channel, as an embed-only post. */
export function youtubeRecord(feed, entry, observedAt = new Date()) {
  if (!entry.title || !/^[A-Za-z0-9_-]{11}$/.test(entry.id ?? '')) return null;
  // Only the pinned official channel: look-alike channels never get in.
  if (feed.channel_id && entry.channel_id !== feed.channel_id) return null;
  if (feed.title_match && !new RegExp(feed.title_match, 'i').test(entry.title)) return null;
  return {
    community: feed.community,
    provider: 'youtube',
    source_url: `https://www.youtube.com/watch?v=${entry.id}`,
    source_author: feed.name,
    profile_display_name: feed.name,
    title: clip(entry.title, 300),
    body: clip(entry.description || '', 1800),
    published_at: entry.published_at,
    observed_at: observedAt.toISOString(),
    media: [],
    attribution: `From the official ${feed.name} YouTube channel.`
  };
}

export function chapterRecord(book, chapter, text, observedAt = new Date()) {
  const track = chapterTrack(book, chapter);
  const label = chapterLabel(book, chapter);
  return {
    community: 'scripture',
    provider: 'rss',
    source_url: chapterSourceUrl(book, chapter),
    source_author: 'King James Version',
    profile_display_name: 'The Holy Bible',
    title: label,
    body: text ? text.verses.map(v => `**${v.verse}** ${v.text}`).join('\n\n') : `Read and listen to ${label}.`,
    published_at: null,
    observed_at: observedAt.toISOString(),
    media: track ? [{ kind: 'audio', src: track.src, alt: track.title }] : [],
    attribution: KJV_CREDIT
  };
}

export function readingRecord(date, origin, observedAt = new Date()) {
  const reading = readingFor(date);
  const lines = reading.sections.map(section => `**${section.label}:** ${section.passages.map(p => `[${p.label}](${p.href})`).join(', ')}`);
  return {
    community: 'daily_reading',
    provider: 'rss',
    source_url: `${origin}/bible/reading/${reading.date}`,
    source_author: 'Daily Reading',
    profile_display_name: 'Daily Reading',
    title: `${new Date(`${reading.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })} · ${reading.summary}`.slice(0, 300),
    body: `${lines.join('\n\n')}\n\n*Day ${reading.day} of 365 — the Old Testament once through this year, with a psalm and a New Testament chapter every day.*`,
    published_at: `${reading.date}T05:00:00.000Z`,
    observed_at: observedAt.toISOString(),
    media: reading.tracks.slice(0, 8).map(track => ({ kind: 'audio', src: track.src, alt: track.title })),
    attribution: KJV_CREDIT
  };
}

export function catechismRecord(entry, origin, observedAt = new Date()) {
  const proofs = Array.isArray(entry.proofs) && entry.proofs.length ? `\n\n*Scripture proofs:* ${entry.proofs.join('; ')}` : '';
  return {
    community: 'deeper_dives',
    provider: 'rss',
    source_url: `${origin}/bible/catechism/${entry.number}`,
    source_author: 'Westminster Shorter Catechism',
    profile_display_name: 'Westminster Shorter Catechism',
    title: `Q. ${entry.number}. ${entry.question}`.slice(0, 300),
    body: `**Q. ${entry.number}. ${entry.question}**\n\nA. ${entry.answer}${proofs}`,
    published_at: null,
    observed_at: observedAt.toISOString(),
    media: [],
    attribution: 'The Westminster Shorter Catechism (1647), public domain.'
  };
}

// ------------------------------------------------------------------- running

function options(argv) {
  const out = { dryRun: argv.includes('--dry-run'), all: argv.includes('--all') };
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  return out;
}

async function loadJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(path + '.tmp', path);
}

async function credentials(envFile) {
  const creds = { handle: process.env.SCHEDULER_HANDLE, password: process.env.SCHEDULER_PASSWORD };
  if (creds.handle && creds.password) return creds;
  const text = await readFile(envFile, 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(SCHEDULER_HANDLE|SCHEDULER_PASSWORD)\s*=\s*(.+?)\s*$/);
    if (match) creds[match[1] === 'SCHEDULER_HANDLE' ? 'handle' : 'password'] = match[2].replace(/^['"]|['"]$/g, '');
  }
  if (!creds.handle || !creds.password) throw Error('Missing scheduler credentials (SCHEDULER_HANDLE / SCHEDULER_PASSWORD)');
  return creds;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function fetchChapter(book, chapter) {
  const url = `https://bible-api.com/${encodeURIComponent(`${book.name} ${chapter}`)}?translation=kjv`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (response.status === 429) { await new Promise(r => setTimeout(r, 5000 * (attempt + 1))); continue; }
    if (!response.ok) throw Error(`${book.name} ${chapter}: HTTP ${response.status}`);
    const json = await response.json();
    const verses = (json.verses ?? []).filter(v => v.chapter === chapter).map(v => ({ verse: v.verse, text: String(v.text).replace(/\s+/g, ' ').trim() }));
    if (!verses.length) throw Error(`${book.name} ${chapter}: no verses returned`);
    return { verses };
  }
  throw Error(`${book.name} ${chapter}: rate limited`);
}

function originFrom(opts) {
  const origin = (opts.origin || process.env.SWARTZIT_ORIGIN || '').trim().replace(/\/+$/, '');
  if (!isHttps(origin)) throw Error('Set SWARTZIT_ORIGIN (or --origin) to this instance’s public https address, e.g. https://example.org');
  return new URL(origin).origin;
}

async function buildRecords(job, opts, state) {
  const now = new Date();
  if (job === 'reading') {
    const date = opts.date ? parseDay(opts.date) : new Date(`${isoDate(now)}T00:00:00Z`);
    if (!date) throw Error('--date must be YYYY-MM-DD');
    return [readingRecord(date, originFrom(opts), now)];
  }
  if (job === 'book') {
    const book = findBook(opts.book);
    if (!book) throw Error('--book must name a book of the Bible, e.g. --book titus');
    state.books ??= {};
    const start = opts.chapter ? Number(opts.chapter) : (state.books[book.slug] ?? 0) + 1;
    if (!Number.isInteger(start) || start < 1) throw Error('--chapter must be a positive whole number');
    if (start > book.chapters) return [];
    const end = opts.all ? book.chapters : start;
    const records = [];
    for (let chapter = start; chapter <= end; chapter++) {
      records.push({ record: chapterRecord(book, chapter, await fetchChapter(book, chapter), now), commit: () => { state.books[book.slug] = Math.max(state.books[book.slug] ?? 0, chapter); } });
      if (chapter < end) await new Promise(r => setTimeout(r, 2500)); // bible-api.com allows ~15 requests / 30 s
    }
    return records;
  }
  // `feeds` is the same job for any curated list of podcast and YouTube feeds.
  if (job === 'sermons' || job === 'feeds') {
    if (job === 'feeds' && !opts.config) throw Error('--job feeds needs --config <file>');
    const config = await loadJson(resolve(root, opts.config ?? 'scripts/bible/sermon-feeds.json'), null);
    if (!Array.isArray(config?.feeds)) throw Error('Sermon feed config must contain a "feeds" array');
    const perFeed = Math.min(Math.max(Number(opts['per-feed'] ?? 1), 1), 15);
    const records = [];
    for (const feed of config.feeds.filter(feed => feed.enabled !== false)) {
      try {
        if (feed.kind === 'youtube') {
          if (!/^UC[A-Za-z0-9_-]{22}$/.test(feed.channel_id ?? '')) throw Error('YouTube feeds need the official channel_id');
          const parsed = parseYouTubeFeed(await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${feed.channel_id}`));
          if (parsed.channel_id && parsed.channel_id !== feed.channel_id) throw Error('feed is for a different channel');
          records.push(...parsed.entries.map(entry => youtubeRecord(feed, entry, now)).filter(Boolean).slice(0, perFeed));
          continue;
        }
        const parsed = parseFeed(await fetchText(feed.url));
        const info = { ...feed, name: feed.name || parsed.channel.title, image: feed.image || parsed.channel.image };
        records.push(...sharedLinksRemoved(parsed.items).map(item => sermonRecord(info, item, now)).filter(Boolean).slice(0, perFeed));
      } catch (error) {
        console.error(`skip ${feed.name || feed.url}: ${error.message}`);
      }
    }
    return records;
  }
  if (job === 'catechism') {
    const catechism = await loadJson(resolve(root, 'apps/web/src/lib/bible/westminster-shorter-catechism.json'), null);
    const questions = Array.isArray(catechism?.questions) ? catechism.questions : [];
    if (!questions.length) throw Error('Catechism data is missing');
    const next = opts.question ? Number(opts.question) : ((state.catechism ?? 0) % questions.length) + 1;
    const entry = questions.find(q => q.number === next);
    if (!entry) throw Error(`No catechism question ${next}`);
    return [{ record: catechismRecord(entry, originFrom(opts), now), commit: () => { state.catechism = next; } }];
  }
  throw Error('Use --job reading|book|sermons|feeds|catechism|daily');
}

async function main() {
  const opts = options(process.argv.slice(2));
  const api = (process.env.API_URL ?? 'http://127.0.0.1:18080').replace(/\/+$/, '');
  const statePath = resolve(root, opts.state ?? '.local/bible-feed.json');
  const state = await loadJson(statePath, {});
  const JOBS = ['reading', 'book', 'sermons', 'feeds', 'catechism'];
  const jobs = opts.job === 'daily' ? ['reading', 'sermons', 'catechism'] : [opts.job];
  if (!jobs.every(job => JOBS.includes(job))) {
    console.error('Use --job reading|book|sermons|feeds|catechism|daily [--dry-run]');
    process.exitCode = 2;
    return;
  }
  const receipt = { started_at: new Date().toISOString(), jobs, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  let token = null;
  const call = async (path, method, body) => {
    const response = await fetch(api + path, { method, signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Error(`${path}: HTTP ${response.status}${data?.error ? ` ${data.error}` : ''}`);
    return data;
  };
  try {
    if (!opts.dryRun) token = (await call('/api/sessions', 'POST', await credentials(resolve(root, opts['env-file'] ?? '.local/import-scheduler.env')))).token;
    for (const job of jobs) {
      let built;
      try { built = await buildRecords(job, opts, state); } catch (error) { receipt.failed++; receipt.errors.push(`${job}: ${error.message}`); continue; }
      for (const entry of built) {
        const { record, commit } = entry.record ? entry : { record: entry, commit: null };
        if (opts.dryRun) { console.log(JSON.stringify(record, null, 2)); receipt.skipped++; continue; }
        try {
          const result = await call('/api/admin/imports', 'POST', record);
          receipt[result.created ? 'created' : result.updated ? 'updated' : 'skipped']++;
          commit?.();
          await saveJson(statePath, state);
        } catch (error) {
          receipt.failed++;
          receipt.errors.push(`${record.title}: ${error.message}`);
        }
      }
    }
  } finally {
    if (token) await call('/api/sessions', 'DELETE').catch(() => {});
  }
  receipt.finished_at = new Date().toISOString();
  console.log(JSON.stringify(receipt));
  if (receipt.failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
