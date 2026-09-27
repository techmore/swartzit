import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoFile = relative =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const preflight = repoFile('preflight-release.sh');
const updater = repoFile('swartzit-release-update.sh');

test('the rehearsal server is stopped on the success path', () => {
  // The bug this guards: TEST_PID was cleared immediately after the health
  // check, so on a passing rehearsal cleanup() had nothing to kill. The server
  // outlived the script, was reparented to init, and went on holding the
  // updater's release-lock descriptor -- which made every subsequent deploy
  // fail with "Another Swartzit release update is already running".
  const afterLaunch = preflight.slice(preflight.indexOf('TEST_PID=$!'));
  const successBranch = afterLaunch.slice(afterLaunch.indexOf('    0)'));
  assert.doesNotMatch(
    successBranch.slice(0, successBranch.indexOf(';;')),
    /TEST_PID=''/,
    'the passing branch must leave TEST_PID set so cleanup() can stop the server'
  );
  // cleanup() is what actually kills it, and it runs from the EXIT trap.
  assert.match(preflight, /trap cleanup EXIT/);
  assert.match(preflight, /kill "\$TEST_PID"/);
});

test('a lost port race does not leak the rehearsal server', () => {
  // `continue` skips the EXIT trap entirely, so the retry path has to stop the
  // server itself. Without this, a port collision leaked a process per retry.
  const raceBranch = preflight.slice(preflight.indexOf('Address already in use'));
  const branch = raceBranch.slice(0, raceBranch.indexOf('continue'));
  assert.match(branch, /kill "\$TEST_PID"/, 'the retry path must stop the server before continuing');
  assert.match(branch, /TEST_PID=''/, 'and clear the PID so cleanup does not signal a reused one');
});

test('the rehearsal server cannot inherit the release lock', () => {
  // Defence in depth. Even with clean teardown, a server that inherited fd 9
  // would keep the updater's lock held for its whole lifetime.
  // Anchor on the background launch, not the earlier `install` of the same path.
  const launch = preflight.slice(preflight.indexOf('"$STAGED_BINARY" 9>&-') - 80);
  assert.match(launch.slice(0, 160), /9>&- > "\$LOG" 2>&1 &/, 'the server must be started with fd 9 closed');
  // And the updater really does hold its lock on fd 9, which is why it matters.
  assert.match(updater, /exec 9>"\$BACKUP_DIR\/\.release\.lock"/);
  assert.match(updater, /flock -n 9/);
});

test('the preflight script is still valid shell', async () => {
  // Guard against the edits above leaving the script unparseable.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const result = await run('bash', ['-n', fileURLToPath(new URL('preflight-release.sh', import.meta.url))])
    .then(() => null)
    .catch(error => error);
  assert.equal(result, null, `bash -n rejected the script: ${result?.stderr ?? result?.message}`);
});
