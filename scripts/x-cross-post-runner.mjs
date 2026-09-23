#!/usr/bin/env node
// Collect public X posts for a scheduled cross-post runner. This adapter uses
// the official X API through crawler-adapters.mjs; it never scrapes a browser
// session. The worker owns the destination author/community and decides
// whether the JSON receipt is a dry run or a real publication.

import {collectX} from './crawler-adapters.mjs';

const optionValues = (args, name) => {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1] !== undefined) values.push(args[index + 1]);
  }
  return values;
};

const firstOption = (args, name, fallback) => optionValues(args, name)[0] ?? fallback;

export function parseDelimitedList(values, label) {
  const result = [];
  for (const value of values.filter(item => item !== undefined && item !== null)) {
    const raw = String(value).trim();
    if (!raw) continue;
    if (raw.startsWith('[')) {
      let parsed;
      try { parsed = JSON.parse(raw); } catch { throw Error(`${label} must be comma-separated or a JSON array`); }
      if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) throw Error(`${label} JSON value must be an array of strings`);
      result.push(...parsed);
    } else {
      result.push(...raw.split(/[\n,]+/));
    }
  }
  return [...new Set(result.map(item => item.trim()).filter(Boolean))];
}

function normalizeAccount(value) {
  const handle = String(value).trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(?:www\.)?x\.com\//i, '')
    .split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw Error(`Invalid X account: ${value}`);
  return handle;
}

function queryTerm(value) {
  const term = String(value).trim();
  if (!term) throw Error('X topics cannot be empty');
  if (term.length > 240) throw Error('Each X topic must be 240 characters or fewer');
  if (/^[\w#-]+$/.test(term) || /^\(.+\)$/.test(term) || /^(from|lang|is|has|url|place|to):/i.test(term)) return term;
  return `"${term.replaceAll('"', '\\"')}"`;
}

export function buildXSearchQuery({accounts = [], topics = [], includeReplies = false, includeRetweets = false} = {}) {
  const accountClause = accounts.length === 1
    ? `from:${accounts[0]}`
    : accounts.length > 1
      ? `(${accounts.map(account => `from:${account}`).join(' OR ')})`
      : '';
  const topicClause = topics.length ? `(${topics.map(queryTerm).join(' OR ')})` : '';
  const exclusions = [
    includeRetweets ? '' : '-is:retweet',
    includeReplies ? '' : '-is:reply',
    'lang:en'
  ].filter(Boolean);
  return [accountClause, topicClause, ...exclusions].filter(Boolean).join(' ');
}

export function buildXJobs({accounts = [], topics = [], queries = [], includeReplies = false, includeRetweets = false} = {}) {
  const jobs = [];
  const normalizedAccounts = accounts.map(normalizeAccount);
  const normalizedTopics = topics.map(topic => String(topic).trim()).filter(Boolean);
  if (normalizedAccounts.length && normalizedTopics.length) {
    jobs.push({label: 'accounts + topics', source: `search:${buildXSearchQuery({accounts: normalizedAccounts, topics: normalizedTopics, includeReplies, includeRetweets})}`});
  } else if (normalizedTopics.length) {
    jobs.push({label: 'topics', source: `search:${buildXSearchQuery({topics: normalizedTopics, includeReplies, includeRetweets})}`});
  } else {
    jobs.push(...normalizedAccounts.map(account => ({label: `@${account}`, source: `@${account}`})));
  }
  for (const query of queries.map(item => String(item).trim()).filter(Boolean)) {
    if (query.length > 512) throw Error('X queries must be 512 characters or fewer');
    jobs.push({label: `query: ${query.slice(0, 80)}`, source: `search:${query}`});
  }
  if (!jobs.length) throw Error('Add at least one X account, topic, or query');
  return jobs;
}

function asDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Error(`${label} must be an ISO-8601 timestamp`);
  return date;
}

export function normalizeXWindow({startTime, endTime, hours = 24, now = new Date()} = {}) {
  const current = asDate(now, 'X window reference time');
  const durationHours = Number(hours);
  if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 168) throw Error('X hours must be between 1 and 168');
  const end = endTime ? asDate(endTime, 'X end-time') : current;
  const start = startTime ? asDate(startTime, 'X start-time') : new Date(end.getTime() - durationHours * 60 * 60 * 1000);
  if (start >= end) throw Error('X start-time must be earlier than end-time');
  return {start_time: start.toISOString(), end_time: end.toISOString()};
}

function postEngagement(post) {
  return (post.source_likes ?? 0) + (post.source_reposts ?? 0) * 2 + (post.source_replies ?? 0);
}

export async function collectCrossPosts({accounts = [], topics = [], queries = [], limit = 8, perSource = 50, hours = 24, startTime, endTime, includeReplies = false, includeRetweets = false} = {}, {collector = collectX, now = new Date()} = {}) {
  const maxPosts = Number(limit);
  const maxPerSource = Number(perSource);
  if (!Number.isInteger(maxPosts) || maxPosts < 1 || maxPosts > 8) throw Error('X runner limit must be an integer from 1 to 8');
  if (!Number.isInteger(maxPerSource) || maxPerSource < 5 || maxPerSource > 100) throw Error('X runner per-source limit must be an integer from 5 to 100');
  const window = normalizeXWindow({startTime, endTime, hours, now});
  const jobs = buildXJobs({accounts, topics, queries, includeReplies, includeRetweets});
  const collected = [];
  for (const job of jobs) {
    const posts = await collector({
      source: job.source,
      max_items: maxPerSource,
      start_time: window.start_time,
      end_time: window.end_time,
      exclude: [includeReplies ? '' : 'replies', includeRetweets ? '' : 'retweets'].filter(Boolean)
    });
    collected.push(...posts.map(post => ({...post, _runner_source: job.label})));
  }
  const startMs = Date.parse(window.start_time);
  const endMs = Date.parse(window.end_time);
  const unique = new Map();
  for (const post of collected) {
    const publishedMs = Date.parse(post.published_at ?? '');
    if (!Number.isFinite(publishedMs) || publishedMs < startMs || publishedMs > endMs) continue;
    const key = post.source_url || `${post.source_author}\n${post.published_at}\n${post.body}`;
    const current = unique.get(key);
    if (!current || postEngagement(post) > postEngagement(current)) unique.set(key, post);
  }
  return [...unique.values()]
    .sort((a, b) => postEngagement(b) - postEngagement(a) || Date.parse(b.published_at) - Date.parse(a.published_at))
    .slice(0, maxPosts)
    .map(({_runner_source, ...post}) => post);
}

function envList(name) {
  return process.env[name] ? [process.env[name]] : [];
}

async function main() {
  const args = process.argv.slice(2);
  const accounts = parseDelimitedList([
    ...optionValues(args, '--accounts'),
    ...envList(firstOption(args, '--accounts-env', 'X_RUNNER_ACCOUNTS'))
  ], 'X accounts');
  const topics = parseDelimitedList([
    ...optionValues(args, '--topics'),
    ...optionValues(args, '--topic'),
    ...envList(firstOption(args, '--topics-env', 'X_RUNNER_TOPICS'))
  ], 'X topics');
  const queries = parseDelimitedList([...optionValues(args, '--query'), ...envList(firstOption(args, '--queries-env', 'X_RUNNER_QUERIES'))], 'X queries');
  const includeReplies = args.includes('--include-replies');
  const includeRetweets = args.includes('--include-retweets');
  const startTime = firstOption(args, '--start-time', process.env.X_RUNNER_START_TIME);
  const endTime = firstOption(args, '--end-time', process.env.X_RUNNER_END_TIME);
  const hours = Number(firstOption(args, '--hours', process.env.X_RUNNER_HOURS || 24));
  const limit = Number(firstOption(args, '--limit', 8));
  const perSource = Number(firstOption(args, '--per-source', 50));
  const posts = await collectCrossPosts({accounts, topics, queries, limit, perSource, hours, startTime, endTime, includeReplies, includeRetweets});
  process.stdout.write(`${JSON.stringify({posts})}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
