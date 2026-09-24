import test from 'node:test';
import assert from 'node:assert/strict';
import {workerPaths} from './worker-runtime.mjs';

test('derives stable script, root, and state paths without depending on cwd', () => {
  const paths = workerPaths({
    SWARTZIT_WORKER_ROOT: '/srv/swartzit',
    SWARTZIT_WORKER_STATE_DIR: '/var/lib/swartzit-state'
  }, '/srv/swartzit/scripts/worker-runtime.mjs');
  assert.equal(paths.scriptDir, '/srv/swartzit/scripts');
  assert.equal(paths.root, '/srv/swartzit');
  assert.equal(paths.stateDir, '/var/lib/swartzit-state');
  assert.equal(paths.script('scheduled-imports.mjs'), '/srv/swartzit/scripts/scheduled-imports.mjs');
  assert.equal(paths.state('worker-batches', 'job.json'), '/var/lib/swartzit-state/worker-batches/job.json');
  assert.equal(paths.resolveRoot('../packs/story'), '/srv/packs/story');
});

test('falls back through state/data directories before the checkout local directory', () => {
  const scriptFile = '/opt/homebrew/opt/swartzit/libexec/worker-runtime.mjs';
  assert.equal(workerPaths({SWARTZIT_STATE_DIR: '/tmp/state'}, scriptFile).stateDir, '/tmp/state');
  assert.equal(workerPaths({SWARTZIT_DATA_DIR: '/tmp/data'}, scriptFile).stateDir, '/tmp/data');
  assert.equal(workerPaths({}, scriptFile).stateDir, '/opt/homebrew/opt/swartzit/.local');
});
