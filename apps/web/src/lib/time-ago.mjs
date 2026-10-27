const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact relative time for feeds: "now", "5m", "3h", "2d", then a short date. */
export function timeAgo(value, now = Date.now()) {
  const then = Date.parse(value ?? '');
  if (!Number.isFinite(then)) return '';
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fullDate(value) {
  const then = Date.parse(value ?? '');
  return Number.isFinite(then) ? new Date(then).toLocaleString() : '';
}
