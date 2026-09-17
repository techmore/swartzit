import { error } from '@sveltejs/kit';
export async function load({ fetch, params }) { const api = import.meta.env.VITE_API_URL ?? ''; const response = await fetch(`${api}/api/posts/${encodeURIComponent(params.id)}`); if (response.status === 404) error(404, 'Discussion not found'); if (!response.ok) error(503, 'Discussions are temporarily unavailable'); return await response.json(); }
