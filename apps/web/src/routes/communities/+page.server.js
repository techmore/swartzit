import { error } from '@sveltejs/kit';
export async function load({ fetch, url }) {
  const q = (url.searchParams.get('q') ?? '').slice(0, 200);
  const page = Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get('page') ?? '1') || 1));
  const response = await fetch('/api/communities');
  if (!response.ok) error(503, 'Communities are temporarily unavailable.');
  const all = await response.json();
  const matches = all.filter(c => (c.slug + ' ' + c.name + ' ' + c.description).toLowerCase().includes(q.toLowerCase()));
  return { communities: matches.slice((page - 1) * 24, page * 24), total: matches.length, q, page };
}
