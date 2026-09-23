#!/usr/bin/env node
// Small, dependency-free HTTP smoke benchmark for release comparisons.
const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const base = String(value('--url', process.env.API_URL || 'http://127.0.0.1:18080')).replace(/\/$/, '');
const path = String(value('--path', '/health'));
const requests = Number(value('--requests', '100'));
const concurrency = Number(value('--concurrency', '4'));
if (!Number.isInteger(requests) || requests < 1 || !Number.isInteger(concurrency) || concurrency < 1) throw new Error('requests and concurrency must be positive integers');

const durations = [], errors = [];
let next = 0;
async function worker() {
  while (true) {
    const index = next++;
    if (index >= requests) return;
    const started = performance.now();
    try {
      const response = await fetch(base + path, { signal: AbortSignal.timeout(15_000) });
      const body = await response.arrayBuffer();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      durations.push({ ms: performance.now() - started, bytes: body.byteLength });
    } catch (error) { errors.push(String(error?.message ?? error)); }
  }
}
const started = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
durations.sort((a, b) => a.ms - b.ms);
const percentile = p => durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * p))]?.ms ?? null;
console.log(JSON.stringify({ url: base + path, requests, concurrency, completed: durations.length, errors: errors.length, elapsed_ms: performance.now() - started, p50_ms: percentile(.5), p95_ms: percentile(.95), max_ms: durations.at(-1)?.ms ?? null, average_bytes: durations.length ? durations.reduce((sum, item) => sum + item.bytes, 0) / durations.length : null, error_samples: errors.slice(0, 3) }, null, 2));
if (errors.length) process.exitCode = 1;
