// Return the stable public original URL for a locally stored media item.
// External source URLs intentionally fall back to sharing the discussion.
export function mediaShareUrl(media) {
  for (const item of Array.isArray(media) ? media : []) {
    const raw = typeof item === 'string' ? item : item?.original_src || item?.src;
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    const match = value.match(/^(https?:\/\/[^/]+)?(\/media\/\d+)(?:\/(?:original|thumbnail))?(\?.*)?$/i);
    if (match) return `${match[1] || ''}${match[2]}/original${match[3] || ''}`;
  }
  return '';
}
