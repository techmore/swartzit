#!/usr/bin/env node
// Local handoff for Hermes (or another trusted local collector).
// Hermes collects public records; scheduled-imports remains the only publisher.
import { readdir, mkdir, rename, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const has = (name) => args.includes(name);
const job = value('--job') ?? 'feed';
const limit = Number(value('--limit') ?? (job === 'ddario' ? 3 : 10));
const batch = value('--batch');
const inbox = value('--inbox');
const archive = value('--archive') ?? '.local/hermes/archive';
const receipts = value('--receipts') ?? '.local/hermes/receipts';

if (!['x', 'feed', 'ddario'].includes(job) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
  throw new Error('Usage: --job x|feed|ddario --limit 1..100 [--batch FILE | --inbox DIR]');
}
if (batch && inbox) throw new Error('Choose either --batch or --inbox, not both');
if (job !== 'ddario' && !batch && !inbox) throw new Error('Hermes input is required: --batch FILE or --inbox DIR');
if (job === 'ddario' && (batch || inbox)) throw new Error('--job ddario uses the Commons manifest; omit --batch/--inbox');

function publish(file) {
  return new Promise((resolvePromise, reject) => {
    const command = ['scripts/scheduled-imports.mjs', '--job', job, '--limit', String(limit)];
    if (file) command.push('--batch', file);
    for (const option of ['--due-hours', '--manifest', '--state', '--env-file']) {
      const supplied = value(option);
      if (supplied !== undefined) command.push(option, supplied);
    }
    const child = spawn(process.execPath, command, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      const lines = stdout.trim().split('\n').filter(Boolean);
      let receipt;
      try { receipt = JSON.parse(lines.at(-1)); } catch { receipt = { output: stdout.trim() }; }
      if (code !== 0) {
        const error = new Error(receipt.error ?? stderr.trim() ?? `publisher exited ${code}`);
        error.receipt = receipt;
        reject(error);
      } else resolvePromise(receipt);
    });
  });
}

async function publishInbox() {
  const inboxPath = resolve(root, inbox);
  const archivePath = resolve(root, archive);
  const receiptsPath = resolve(root, receipts);
  await mkdir(archivePath, { recursive: true });
  await mkdir(receiptsPath, { recursive: true });
  const files = (await readdir(inboxPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name).sort();
  const results = [];
  for (const name of files) {
    const source = resolve(inboxPath, name);
    try {
      // Read before publishing so a collector cannot replace the file mid-run.
      JSON.parse(await readFile(source, 'utf8'));
      const receipt = await publish(source);
      const destination = resolve(archivePath, `${Date.now()}-${basename(name)}`);
      await rename(source, destination);
      const result = { file: name, status: 'published', receipt };
      await writeFile(resolve(receiptsPath, `${Date.now()}-${basename(name)}`), JSON.stringify(result, null, 2), { mode: 0o600 });
      results.push(result);
    } catch (error) {
      results.push({ file: name, status: 'failed', error: error.message, receipt: error.receipt });
      // Leave failures in the inbox for inspection/retry.
    }
  }
  return { status: results.some((item) => item.status === 'failed') ? 'failed' : 'success', processed: results.length, results };
}

async function main() {
  if (job === 'ddario') {
    const receipt = await publish(undefined);
    return { status: 'published', receipt };
  }
  if (inbox) return publishInbox();
  return { status: 'published', receipt: await publish(resolve(root, batch)) };
}

try {
  console.log(JSON.stringify(await main()));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
