// Render small, deterministic placeholders in runner prompts. Keeping this
// separate from the worker makes prompt recipes easy to test without needing
// an API session or a model installed on the host.

const tokenPattern = /\{([a-z_]+)\}/gi;

function dateParts(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new Error('Runner prompt context contains an invalid date');
  const iso = date.toISOString();
  return {
    iso,
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
    weekday: new Intl.DateTimeFormat('en-US', {weekday: 'long', timeZone: 'UTC'}).format(date)
  };
}

export const RUNNER_PROMPT_TOKENS = [
  '{date}', '{time}', '{weekday}', '{iso}', '{runner}', '{community}',
  '{author}', '{run_id}', '{seed}', '{index}', '{total}', '{dry_run}'
];

export function renderRunnerPrompt(template, context = {}) {
  const parts = dateParts(context.now);
  const values = {
    ...parts,
    runner: context.runner ?? '',
    community: context.community ?? '',
    author: context.author ?? '',
    run_id: context.runId ?? context.run_id ?? '',
    seed: context.seed == null ? 'automatic' : context.seed,
    index: context.index == null ? '' : context.index,
    total: context.total == null ? '' : context.total,
    dry_run: context.dryRun ?? context.dry_run ?? false
  };
  return String(template ?? '').replace(tokenPattern, (match, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  ));
}
