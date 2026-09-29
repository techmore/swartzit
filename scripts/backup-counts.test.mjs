import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function compare(previous, current) {
  const directory = mkdtempSync(join(tmpdir(), 'swartzit-counts-'));
  try {
    const old = join(directory, 'previous.tsv'), next = join(directory, 'current.tsv');
    writeFileSync(old, previous); writeFileSync(next, current);
    return spawnSync('python3', [new URL('./compare-backup-counts.py', import.meta.url).pathname, old, next], { encoding: 'utf8' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('retained activity and user-owned collections may shrink while durable content stays intact', () => {
  const result = compare('posts\t100\nip_activity\t775\npost_view_visits\t29\nbookmarks\t10\n', 'posts\t101\nip_activity\t770\npost_view_visits\t1\nbookmarks\t9\n');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Normal expiry or user edit in ip_activity/);
});
test('content loss or missing tables still blocks backup publication', () => {
  assert.equal(compare('posts\t100\n', 'posts\t0\n').status, 1);
  assert.equal(compare('ip_activity\t3\nposts\t100\n', 'posts\t100\n').status, 1);
  assert.equal(compare('new_durable_table\t3\n', 'new_durable_table\t1\n').status, 1);
});
test('malformed or duplicate row counts cannot bypass checks', () => {
  for (const counts of ['', 'posts\t-1\n', 'posts\t2\nposts\t3\n', 'posts\t2\textra\n']) {
    assert.equal(compare('posts\t1\n', counts).status, 2);
  }
});
