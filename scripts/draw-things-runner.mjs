import {homedir} from 'node:os';
import {extname, isAbsolute, resolve} from 'node:path';

export const MAX_PROMPT_PERMUTATIONS = 8;

export const expandHome = value => value === '~' ? homedir() : value.startsWith('~/') ? `${homedir()}/${value.slice(2)}` : value;

export function normalizePromptPermutations(value) {
  return (Array.isArray(value) ? value : []).map(item => ({
    key: String(item?.key ?? '').trim(),
    values: Array.isArray(item?.values) ? item.values.map(option => String(option ?? '')) : []
  }));
}

export function expandPromptPermutations(value, max = MAX_PROMPT_PERMUTATIONS) {
  const rows = normalizePromptPermutations(value);
  let combinations = [{}];
  for (const row of rows) {
    if (!row.key) throw new Error('Prompt permutation keys cannot be empty');
    if (!row.values.length || row.values.some(option => !option.trim())) {
      throw new Error(`Prompt permutation ${row.key} needs at least one non-empty value`);
    }
    const next = [];
    for (const combination of combinations) {
      for (const option of row.values) next.push({...combination, [row.key]: option});
    }
    if (next.length > max) throw new Error(`Prompt permutations produce ${next.length} combinations; the maximum is ${max}`);
    combinations = next;
  }
  return combinations;
}

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

export function drawThingsGeneration(config, prompt, seed, index, details = {}) {
  const promptRows = normalizePromptPermutations(config.prompt_permutations);
  const promptVariables = details.promptVariables && typeof details.promptVariables === 'object' ? details.promptVariables : {};
  return {
    provider: 'draw_things',
    executable: config.executable || null,
    prompt,
    prompt_template: details.promptTemplate ?? null,
    prompt_variables: promptVariables,
    prompt_permutations: promptRows,
    permutation: promptRows.length ? {
      index: Number(details.permutationIndex ?? index + 1),
      total: Number(details.permutationTotal ?? promptRows.length)
    } : null,
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
    variant: index + 1,
    posts_per_run: Number(config.posts_per_run ?? 1),
    output_path: config.output_path || null,
    title_prefix: config.title_prefix || null
  };
}

export function drawThingsBody(generation) {
  const loras = generation.loras.length
    ? generation.loras.map(lora => `${lora.file} (${lora.version}, weight ${lora.weight})`).join(', ')
    : 'None';
  const variables = Object.entries(generation.prompt_variables || {});
  const permutation = generation.permutation && variables.length
    ? `Permutation: ${generation.permutation.index}/${generation.permutation.total} · ${variables.map(([key, value]) => `${key}=${value}`).join(' · ')}`
    : null;
  return [
    'Generated with Draw Things via Swartzit.',
    '',
    `Prompt: ${generation.prompt}`,
    generation.prompt_template && generation.prompt_template !== generation.prompt ? `Prompt template: ${generation.prompt_template}` : null,
    permutation,
    '',
    `Model: ${generation.model}`,
    `LoRAs: ${loras}`,
    `Settings: ${generation.width}×${generation.height} · ${generation.steps} steps · CFG ${generation.cfg ?? 'recommended'} · seed ${generation.seed ?? 'automatic'}`
  ].filter(Boolean).join('\n');
}
