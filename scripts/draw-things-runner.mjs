import {homedir} from 'node:os';
import {extname, isAbsolute, resolve} from 'node:path';

export const expandHome = value => value === '~' ? homedir() : value.startsWith('~/') ? `${homedir()}/${value.slice(2)}` : value;

export function runnerOutputPath(template, claimId, index, total, startedAt) {
  const raw = String(template || `.local/draw-things/${claimId}-${startedAt}-${index + 1}.png`);
  let output = expandHome(raw)
    .replaceAll('{runner_id}', String(claimId))
    .replaceAll('{index}', String(index + 1))
    .replaceAll('{timestamp}', String(startedAt));
  if (total > 1 && index > 0 && !raw.includes('{index}')) {
    const extension = extname(output);
    output = `${output.slice(0, output.length - extension.length)}-${index + 1}${extension}`;
  }
  return isAbsolute(output) ? output : resolve(process.cwd(), output);
}

export function drawThingsArgs(config, prompt, output, index) {
  const args = ['generate'];
  if (config.models_dir) args.push('--models-dir', expandHome(String(config.models_dir)));
  args.push('--model', String(config.model), '--prompt', prompt);
  for (const [key, flag] of [['width', '--width'], ['height', '--height'], ['steps', '--steps'], ['cfg', '--cfg']]) {
    if (config[key] !== undefined && config[key] !== null && config[key] !== '') args.push(flag, String(config[key]));
  }
  if (config.seed !== undefined && config.seed !== null && config.seed !== '') args.push('--seed', String(Number(config.seed) + index));
  if (Array.isArray(config.loras) && config.loras.length) args.push('--config-json', JSON.stringify({loras: config.loras}));
  args.push('--output', output);
  return args;
}

// Draw Things redraws a small progress line in place and includes terminal
// cursor-control sequences. Keep this parser deliberately conservative: the
// runner reports only the phase and percentage that the CLI explicitly emits.
export function parseDrawThingsProgress(line) {
  const clean = String(line || '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const match = clean.match(/^(Starting|Processing|Sampling|Finishing|Generated)(?:\.\.\.)?\s+.*?(\d+)\s*%/i);
  if (!match) return null;
  const sampling = clean.match(/^Sampling(?:\.\.\.)?\s+(\d+)\s*\/\s*(\d+)/i);
  return {
    percent: Math.min(100, Math.max(0, Number(match[2]))),
    phase: match[1].toLowerCase(),
    message: clean.slice(0, 300),
    currentStep: sampling ? Number(sampling[1]) : null,
    totalSteps: sampling ? Number(sampling[2]) : null
  };
}

export function drawThingsGeneration(config, prompt, seed, index) {
  return {
    provider: 'draw_things',
    prompt,
    model: config.model,
    models_dir: config.models_dir || null,
    loras: Array.isArray(config.loras) ? config.loras : [],
    width: Number(config.width ?? 1024),
    height: Number(config.height ?? 1024),
    steps: Number(config.steps ?? 4),
    // A missing CFG is intentional: Draw Things should use the model's
    // recommended guidance instead of Swartzit inventing a value.
    cfg: config.cfg === undefined || config.cfg === null || config.cfg === '' ? null : Number(config.cfg),
    seed: seed ?? null,
    variant: index + 1
  };
}

export function drawThingsBody(generation) {
  const loras = generation.loras.length
    ? generation.loras.map(lora => `${lora.file} (${lora.version}, weight ${lora.weight})`).join(', ')
    : 'None';
  return [
    'Generated with Draw Things via Swartzit.',
    '',
    `Prompt: ${generation.prompt}`,
    '',
    `Model: ${generation.model}`,
    `LoRAs: ${loras}`,
    `Settings: ${generation.width}×${generation.height} · ${generation.steps} steps · CFG ${generation.cfg ?? 'recommended'} · seed ${generation.seed ?? 'automatic'}`
  ].join('\n');
}
