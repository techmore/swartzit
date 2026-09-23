#!/usr/bin/env node
// A tiny Draw Things-compatible executable used by contract tests. It keeps
// CI and developer checks deterministic while the real CLI is exercised
// separately when a local model is available.
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

const args = process.argv.slice(2);
const value = name => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

if (args[0] !== 'generate' || !value('--model') || !value('--prompt') || !value('--output')) {
  console.error('stub expects: generate --model MODEL --prompt PROMPT --output FILE');
  process.exit(2);
}

const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const output = value('--output');
await mkdir(dirname(output), {recursive: true});
await writeFile(output, onePixelPng);
process.stdout.write(`${JSON.stringify({status: 'ok', model: value('--model'), prompt: value('--prompt'), output})}\n`);
