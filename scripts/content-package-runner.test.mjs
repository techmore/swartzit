import test from 'node:test';
import assert from 'node:assert/strict';
import {contentPackageArgv, contentPackageWorkingDirectory, packageFrameCheckpoint, parseContentPackageFrame, validateContentPackageManifest} from './content-package-runner.mjs';

test('parses machine frames while ignoring human adapter logs', () => {
  assert.equal(parseContentPackageFrame('loading Gemma…'), null);
  const frame = parseContentPackageFrame('{"type":"checkpoint","checkpoint":{"day":2}}');
  assert.equal(frame.type, 'checkpoint');
  assert.deepEqual(packageFrameCheckpoint(frame), {day: 2});
});

test('validates a bounded content package manifest', () => {
  const manifest = validateContentPackageManifest({
    format: 'content-package.v1',
    title: 'Ash and Bone',
    units: [{id: 'day-1', kind: 'article', body: '…'}]
  });
  assert.equal(manifest.title, 'Ash and Bone');
  assert.deepEqual(contentPackageArgv({argv: ['python3', 'adapter.py']}), ['python3', 'adapter.py']);
  assert.equal(contentPackageWorkingDirectory({}, '/tmp/default'), '/tmp/default');
});

test('rejects missing units and oversized argv definitions', () => {
  assert.throws(() => validateContentPackageManifest({title: 'No units', units: []}), /units/);
  assert.throws(() => contentPackageArgv({argv: []}), /argv/);
});
