export function normalizeXAuthorHandle(value) {
  const raw = String(value ?? '').trim();
  const handle = raw.startsWith('@') ? raw.slice(1) : raw;
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle.toLowerCase() : '';
}
