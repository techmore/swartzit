const hosts = new Set(['pbs.twimg.com', 'video.twimg.com']);
export function archivedXMedia(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && hosts.has(url.hostname) && !url.username && !url.password && !url.port) return `/archived-media?src=${encodeURIComponent(raw)}`;
  } catch { /* Keep the existing source for unsupported URLs. */ }
  return raw;
}
