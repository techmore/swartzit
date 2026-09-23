// Discover public X posts about biblical and Protestant Christianity.
// The runner only uses the official X API through collectX; it does not scrape
// feeds, inspect private content, or infer missing source metadata.
import { readFile, writeFile } from 'node:fs/promises';
import { collectReddit, collectX } from './crawler-adapters.mjs';

export const FAITH_QUERIES = [
  {
    name: 'protestant',
    weight: 5,
    query: '(Presbyterian OR Presbyterianism OR Reformed OR Calvinist OR "Westminster Confession" OR "sola scriptura" OR "sola fide" OR PCA OR OPC) -is:retweet -is:reply lang:en',
  },
  {
    name: 'biblical',
    weight: 3,
    query: '(biblical OR "Bible study" OR expository OR theology OR catechism OR gospel OR justification) -is:retweet -is:reply lang:en',
  },
  {
    name: 'christian',
    weight: 1,
    query: '(Christian OR Christianity OR Jesus OR church) -is:retweet -is:reply lang:en',
  },
];

export const REDDIT_FAITH_QUERIES = [
  { name: 'protestant', weight: 5, query: '(Presbyterian OR Reformed OR Calvinist OR "Westminster Confession" OR "sola scriptura" OR "sola fide")' },
  { name: 'biblical', weight: 3, query: '(biblical OR "Bible study" OR expository OR theology OR catechism OR gospel OR justification)' },
  { name: 'christian', weight: 1, query: '(Christian OR Christianity OR Jesus OR church)' },
];

const normalize = value => String(value ?? '').toLocaleLowerCase('en-US');
const terms = [
  ['presbyterian', 8], ['presbyterianism', 8], ['reformed', 7], ['calvinist', 7],
  ['westminster confession', 8], ['sola scriptura', 8], ['sola fide', 8],
  ['pca', 5], ['opc', 5], ['arp', 4], ['confessional', 4], ['catechism', 4],
  ['expository', 4], ['biblical', 3], ['bible study', 3], ['theology', 2],
  ['gospel', 2], ['justification', 3], ['christian', 1], ['christianity', 1],
  ['jesus', 1], ['church', 1],
];

export function scoreFaithPost(post, queryWeight = 0) {
  const text = normalize(`${post.title}\n${post.body}`);
  const keywordScore = terms.reduce((score, [term, weight]) => score + (text.includes(term) ? weight : 0), 0);
  const engagement = Math.log10(1 + (post.source_likes ?? 0) + (post.source_reposts ?? 0) * 2 + (post.source_replies ?? 0));
  return queryWeight + keywordScore + engagement;
}

export function selectFaithPosts(posts, limit = 10) {
  const unique = new Map();
  for (const candidate of posts) {
    const key = candidate.source_url.match(/\/status\/(\d+)/)?.[1] ?? candidate.source_url;
    const score = scoreFaithPost(candidate, candidate._queryWeight ?? 0);
    const current = unique.get(key);
    if (!current || score > current._faithScore) unique.set(key, { ...candidate, _faithScore: score });
  }
  return [...unique.values()]
    .sort((a, b) => b._faithScore - a._faithScore || Date.parse(b.published_at ?? 0) - Date.parse(a.published_at ?? 0))
    .slice(0, limit)
    .map(({ _faithScore, _queryWeight, ...post }) => post);
}

const arg = (args, name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

export async function discoverFaithPosts({ community = 'x_imports', limit = 10, perQuery = 20 } = {}) {
  const collected = [];
  for (const query of FAITH_QUERIES) {
    const xPosts = await collectX({
      community,
      source: `search:${query.query}`,
      max_items: Math.max(10, Math.min(Number(perQuery), 100)),
    });
    collected.push(...xPosts.map(post => ({ ...post, _queryWeight: query.weight })));
    const redditQuery = REDDIT_FAITH_QUERIES.find(item => item.name === query.name);
    const redditPosts = await collectReddit({
      community,
      source: `search:${redditQuery.query}`,
      max_items: Math.max(10, Math.min(Number(perQuery), 100)),
    });
    collected.push(...redditPosts.map(post => ({ ...post, _queryWeight: redditQuery.weight })));
  }
  return selectFaithPosts(collected, limit);
}

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(arg(args, '--limit', 10));
  const perQuery = Number(arg(args, '--per-query', 20));
  const community = arg(args, '--community', 'x_imports');
  const output = arg(args, '--output');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(perQuery) || perQuery < 10 || perQuery > 100) {
    throw Error('Use --limit 1..100 --per-query 10..100 [--community SLUG] [--output FILE]');
  }
  const posts = await discoverFaithPosts({ community, limit, perQuery });
  const serialized = JSON.stringify(posts, null, 2);
  if (output) await writeFile(output, serialized + '\n', { mode: 0o600 });
  else process.stdout.write(serialized + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
