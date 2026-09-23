#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readOption(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const file = readOption('--file');
const url = readOption('--url');
const status = readOption('--status');
const httpStatus = readOption('--http-status', '');
const latency = readOption('--latency-ms', '');
const interval = readOption('--interval-seconds', '');
const error = readOption('--error', '');

if (!file || !url || !['up', 'down'].includes(status)) {
  console.error('Usage: record-uptime-pulse.mjs --file PATH --url URL --status up|down [--http-status N] [--latency-ms N] [--interval-seconds N] [--error MESSAGE]');
  process.exit(2);
}

let previous = {};
try {
  previous = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  // The first check, a deleted state file, or a truncated file all start a
  // fresh pulse record. The next successful probe is still authoritative.
}

const changedUrl = previous.url && previous.url !== url;
const now = new Date().toISOString();
const up = status === 'up';
const numeric = value => /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
const recent = changedUrl || !Array.isArray(previous.recent) ? [] : previous.recent.slice(-119);
recent.push({
  checked_at: now,
  status,
  url,
  interval_seconds: numeric(interval),
  http_status: numeric(httpStatus),
  latency_ms: numeric(latency),
  ...(error ? { error } : {})
});

const next = {
  version: 1,
  status,
  url,
  interval_seconds: numeric(interval),
  http_status: numeric(httpStatus),
  latency_ms: numeric(latency),
  checked_at: now,
  last_up_at: up ? now : (changedUrl ? null : previous.last_up_at ?? null),
  last_down_at: up ? (changedUrl ? null : previous.last_down_at ?? null) : now,
  consecutive_failures: up ? 0 : (changedUrl ? 1 : Number(previous.consecutive_failures || 0) + 1),
  recent
};

if (error) next.error = error;

fs.mkdirSync(path.dirname(file), { recursive: true });
const temporary = `${file}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, file);
