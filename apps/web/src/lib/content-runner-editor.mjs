const MAX_RUNNER_NAME_LENGTH = 80;

function normalizedNames(names) {
  return new Set((Array.isArray(names) ? names : []).map(name => String(name ?? '').trim().toLocaleLowerCase()));
}

/**
 * Return a server-valid name for a copied runner without silently colliding
 * with an existing definition. The API enforces an 80-byte name limit and a
 * unique name, so the editor should do the same before the user saves.
 */
export function nextRunnerCopyName(name, existingNames = []) {
  const source = String(name ?? '').trim() || 'Runner';
  const taken = normalizedNames(existingNames);
  const candidate = suffix => {
    const available = MAX_RUNNER_NAME_LENGTH - suffix.length;
    return `${source.slice(0, available).trimEnd()}${suffix}`;
  };

  let copy = candidate(' copy');
  if (!taken.has(copy.toLocaleLowerCase())) return copy;
  for (let number = 2; number <= 999; number += 1) {
    copy = candidate(` copy ${number}`);
    if (!taken.has(copy.toLocaleLowerCase())) return copy;
  }
  return candidate(` copy ${Date.now()}`).slice(0, MAX_RUNNER_NAME_LENGTH);
}

export function isFailedRunnerRun(status) {
  return ['failed', 'timeout', 'error'].includes(String(status ?? '').toLowerCase());
}

/**
 * Turn common host/transport failures into an operator hint. The original
 * error remains visible beside this hint; this is only the next useful action.
 */
export function runnerFailureHint(error) {
  const message = String(error ?? '').trim();
  if (!message) return '';
  if (/\b413\b|payload too large|request entity too large/i.test(message)) {
    return 'The image was generated, but an HTTP layer rejected the upload as too large. Run the worker against the private API URL (for example http://127.0.0.1:18080), or lower the image dimensions/file size.';
  }
  if (/ENOENT|not found|no such file/i.test(message) && /draw|model|executable|\.ckpt|\.safetensors/i.test(message)) {
    return 'Check the Draw Things executable, models directory, and model filename on the machine running the worker.';
  }
  if (/did not create/i.test(message)) {
    return 'Draw Things exited without writing the configured output path. Check the output directory and the CLI permissions.';
  }
  if (/ECONNREFUSED|timed out|temporarily unavailable|fetch failed/i.test(message)) {
    return 'Check that the worker can reach the configured API URL and that Swartzit is running before retrying.';
  }
  return '';
}
