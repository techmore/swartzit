import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {drawThingsArgs, drawThingsBody, drawThingsGeneration, parseDrawThingsProgress} from './draw-things-runner.mjs';
import {renderRunnerPrompt} from './runner-prompt.mjs';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({code, stdout, stderr}));
  });
}

test('builds a bounded Draw Things command and generation receipt', () => {
  const config = {model: 'flux_1_schnell_q5p.ckpt', width: 256, height: 256, steps: 2, cfg: 3.5, seed: 41, posts_per_run: 1, loras: []};
  const prompt = renderRunnerPrompt('A {weekday} study · {index}/{total}', {now: '2026-09-23T00:00:00.000Z', index: 1, total: 2});
  const args = drawThingsArgs(config, prompt, '/tmp/swartzit-test.png', 1);
  assert.deepEqual(args.slice(0, 7), ['generate', '--model', config.model, '--prompt', prompt, '--width', '256']);
  assert.deepEqual(args.slice(-2), ['--output', '/tmp/swartzit-test.png']);
  const generation = drawThingsGeneration(config, prompt, 42, 1);
  assert.match(drawThingsBody(generation), /Wednesday study/);
  assert.equal(generation.seed, 42);
});

test('leaves model guidance untouched when CFG is omitted', () => {
  const config = {model: 'flux_1_schnell_q5p.ckpt', width: 1024, height: 1024, steps: 4, seed: 42};
  const args = drawThingsArgs(config, 'lighthouse', '/tmp/lighthouse.png', 0);
  assert.equal(args.includes('--cfg'), false);
  const generation = drawThingsGeneration(config, 'lighthouse', 42, 0);
  assert.equal(generation.cfg, null);
  assert.match(drawThingsBody(generation), /CFG recommended/);
});

test('emits the Draw Things designer LoRA recipe as config JSON', () => {
  const config = {
    models_dir: '~/Library/Containers/com.liuliu.draw-things/Data/Documents/Models',
    model: 'flux_1_dev_q8p.ckpt',
    width: 1024,
    height: 1024,
    steps: 28,
    cfg: 3.5,
    seed: 123,
    loras: [{file: 'flux_alexandra_daddario_lora_f16.ckpt', version: 'flux1', weight: 0.8}]
  };
  const args = drawThingsArgs(config, 'designer test', '/tmp/designer.png', 0);
  assert.deepEqual(args.slice(0, 5), ['generate', '--models-dir', `${homedir()}/Library/Containers/com.liuliu.draw-things/Data/Documents/Models`, '--model', 'flux_1_dev_q8p.ckpt']);
  const configIndex = args.indexOf('--config-json');
  assert.ok(configIndex > 0);
  assert.deepEqual(JSON.parse(args[configIndex + 1]), {loras: config.loras});
  assert.deepEqual(args.slice(-2), ['--output', '/tmp/designer.png']);
});

test('parses Draw Things redraw progress and strips terminal control codes', () => {
  const progress = parseDrawThingsProgress('\u001b[1A\u001b[KSampling... 4 / 28 [█] 63  %');
  assert.deepEqual(progress, {
    percent: 63,
    phase: 'sampling',
    message: 'Sampling... 4 / 28 [█] 63 %',
    currentStep: 4,
    totalSteps: 28
  });
  assert.equal(parseDrawThingsProgress('Wrote: /tmp/image.png'), null);
});

test('runs the same argv contract through the deterministic Draw Things stub', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'swartzit-draw-things-'));
  const output = join(directory, 'generated.png');
  try {
    const prompt = renderRunnerPrompt('A {date} test image', {now: '2026-09-23T00:00:00.000Z'});
    const args = drawThingsArgs({model: 'test.ckpt', width: 256, height: 256, steps: 1, cfg: 1, seed: 7}, prompt, output, 0);
    const result = await run(process.execPath, ['scripts/draw-things-stub.mjs', ...args]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal((await stat(output)).isFile(), true);
    assert.deepEqual((await readFile(output)).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.match(result.stdout, /2026-09-23/);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
