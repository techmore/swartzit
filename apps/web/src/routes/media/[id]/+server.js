import { apiUrl } from '#lib/server/api-url.mjs';

export async function GET({ params }) {
  if (!/^\d+$/.test(params.id)) return new Response('Not found', { status: 404 });
  try {
    const response = await fetch(`${apiUrl()}/media/${params.id}`, {
      signal: AbortSignal.timeout(10000),
      redirect: 'error'
    });
    if (!response.ok) return new Response('Not found', { status: 404 });
    const headers = {
      'content-type': response.headers.get('content-type') || 'application/octet-stream',
      'cache-control': response.headers.get('cache-control') || 'public, max-age=31536000, immutable'
    };
    const etag = response.headers.get('etag');
    if (etag) headers.etag = etag;
    return new Response(response.body, { status: 200, headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
