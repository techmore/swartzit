import test from 'node:test';
import assert from 'node:assert/strict';
import {isFailedRunnerRun, nextRunnerCopyName, runnerFailureHint} from './content-runner-editor.mjs';

test('creates a unique bounded copy name', () => {
  assert.equal(nextRunnerCopyName('Draw Things lighthouse', []), 'Draw Things lighthouse copy');
  assert.equal(nextRunnerCopyName('Draw Things lighthouse', ['Draw Things lighthouse copy']), 'Draw Things lighthouse copy 2');
  const name = nextRunnerCopyName('x'.repeat(120), []);
  assert.ok(name.length <= 80);
  assert.match(name, / copy$/);
});

test('recognizes retryable runner failures', () => {
  assert.equal(isFailedRunnerRun('failed'), true);
  assert.equal(isFailedRunnerRun('timeout'), true);
  assert.equal(isFailedRunnerRun('success'), false);
});

test('explains an upload-size failure without hiding the original error', () => {
  assert.match(runnerFailureHint('/api/admin/content-runners/media: HTTP 413'), /private API URL/);
  assert.equal(runnerFailureHint('Draw Things exited with 1'), '');
});
