import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

const recorder = path.join(import.meta.dirname, 'record-uptime-pulse.mjs');

function record(file, ...args) {
  const result = spawnSync(process.execPath, [recorder, '--file', file, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('records the latest pulse and preserves a bounded recent history', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swartzit-pulse-'));
  const file = path.join(directory, 'uptime-pulse.json');
  try {
    record(file, '--url', 'https://example.test/', '--status', 'up', '--http-status', '200', '--latency-ms', '42', '--interval-seconds', '300');
    record(file, '--url', 'https://example.test/', '--status', 'down', '--http-status', '503', '--latency-ms', '81', '--interval-seconds', '300', '--error', 'HTTP 503');
    const pulse = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(pulse.status, 'down');
    assert.equal(pulse.interval_seconds, 300);
    assert.equal(pulse.http_status, 503);
    assert.equal(pulse.consecutive_failures, 1);
    assert.equal(pulse.recent.length, 2);
    assert.equal(pulse.recent[0].status, 'up');
    assert.equal(pulse.recent[1].error, 'HTTP 503');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('resets history when the monitored URL changes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swartzit-pulse-'));
  const file = path.join(directory, 'uptime-pulse.json');
  try {
    record(file, '--url', 'https://old.example/', '--status', 'down');
    record(file, '--url', 'https://new.example/', '--status', 'up');
    const pulse = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(pulse.url, 'https://new.example/');
    assert.equal(pulse.consecutive_failures, 0);
    assert.equal(pulse.recent.length, 1);
    assert.equal(pulse.recent[0].url, 'https://new.example/');
    assert.equal(pulse.last_down_at, null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
