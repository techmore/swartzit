import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';

const homePrefix = value => {
  const text = String(value ?? '');
  if (text === '~') return homedir();
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2));
  return text;
};

export function workerPaths(env = process.env, scriptFile = fileURLToPath(import.meta.url)) {
  const scriptDir = dirname(scriptFile);
  const defaultRoot = resolve(scriptDir, '..');
  const root = resolve(homePrefix(env.SWARTZIT_WORKER_ROOT || defaultRoot));
  const stateDir = resolve(homePrefix(
    env.SWARTZIT_WORKER_STATE_DIR ||
    env.SWARTZIT_STATE_DIR ||
    env.SWARTZIT_DATA_DIR ||
    join(root, '.local'),
  ));

  return {
    scriptDir,
    root,
    stateDir,
    script: name => join(scriptDir, name),
    state: (...parts) => join(stateDir, ...parts),
    resolveRoot: value => {
      const normalized = homePrefix(value);
      return isAbsolute(normalized) ? normalized : resolve(root, normalized);
    },
  };
}

export const currentWorkerPaths = workerPaths();
