#!/usr/bin/env node
// A deliberately small X runner recipe for verifying source labeling and the
// content-rating handoff with two fixed public accounts. The worker performs
// the already-imported source check before a dry-run preview or publication.

import {collectCrossPosts} from './x-cross-post-runner.mjs';

export const DEMO_ACCOUNTS = ['beautyshowcase', 'Rawpkw'];
export const DEMO_DEFAULTS = {hours: 168, limit: 8, perSource: 50};

export function buildDemoOptions({hours = DEMO_DEFAULTS.hours, limit = DEMO_DEFAULTS.limit, perSource = DEMO_DEFAULTS.perSource} = {}) {
  return {accounts: [...DEMO_ACCOUNTS], hours: Number(hours), limit: Number(limit), perSource: Number(perSource)};
}

export function labelDemoPosts(posts) {
  return posts.map(post => ({
    ...post,
    provider: 'x',
    content_rating: post.content_rating ?? 'general',
    attribution: post.attribution || 'Imported from the Swartzit two-account X labeling demo.'
  }));
}

async function main() {
  const options = buildDemoOptions({
    hours: process.env.X_RUNNER_HOURS || DEMO_DEFAULTS.hours,
    limit: process.env.X_RUNNER_LIMIT || DEMO_DEFAULTS.limit,
    perSource: process.env.X_RUNNER_PER_SOURCE || DEMO_DEFAULTS.perSource
  });
  const posts = await collectCrossPosts({...options, candidateLimit: 100});
  process.stdout.write(`${JSON.stringify({posts: labelDemoPosts(posts), max_posts: options.limit})}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
