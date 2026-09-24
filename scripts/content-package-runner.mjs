// Small, dependency-free contract helpers for optional long-form adapters.
// The adapter is an external process; this module only describes the argv and
// JSONL frames that the Swartzit worker understands.

export const CONTENT_PACKAGE_FORMAT = 'content-package.v1';

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function contentPackageArgv(config) {
  const argv = Array.isArray(config?.argv) ? config.argv.map(String) : [];
  if (!argv.length || argv.length > 32) throw Error('Content package argv must contain 1-32 values');
  return argv;
}

export function contentPackageWorkingDirectory(config, fallback) {
  const value = String(config?.working_dir || '').trim();
  return value || fallback;
}

export function contentPackageEnvironment(config) {
  return config?.options && typeof config.options === 'object' && !Array.isArray(config.options)
    ? config.options
    : {};
}

/** Parse one JSONL protocol frame. Human-readable adapter logs are ignored. */
export function parseContentPackageFrame(line) {
  const clean = String(line ?? '').replace(ANSI, '').trim();
  if (!clean.startsWith('{')) return null;
  let frame;
  try { frame = JSON.parse(clean); } catch { return null; }
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  if (frame.type === 'progress' || frame.type === 'checkpoint' || frame.type === 'package' || frame.type === 'cancelled' || frame.type === 'error') return frame;
  if (frame.package && typeof frame.package === 'object') return {...frame, type: 'package'};
  return null;
}

export function packageFramePercent(frame) {
  const value = Number(frame?.percent);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;
}

export function packageFrameCheckpoint(frame) {
  if (frame?.checkpoint && typeof frame.checkpoint === 'object' && !Array.isArray(frame.checkpoint)) return frame.checkpoint;
  return null;
}

export function validateContentPackageManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Content package frame must contain an object');
  const format = String(value.format || CONTENT_PACKAGE_FORMAT);
  if (format !== CONTENT_PACKAGE_FORMAT) throw Error(`Unsupported content package format: ${format}`);
  if (!String(value.title || '').trim()) throw Error('Content package is missing a title');
  if (!Array.isArray(value.units) || value.units.length < 1 || value.units.length > 64) throw Error('Content package units must contain 1-64 items');
  const serialized = JSON.stringify(value);
  if (serialized.length > 8 * 1024 * 1024) throw Error('Content package manifest is larger than 8 MB');
  return value;
}
