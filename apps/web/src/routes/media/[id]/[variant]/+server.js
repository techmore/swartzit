import { env } from '$env/dynamic/private';

export async function GET({ params }) {
  if (!/^\d+$/.test(params.id) || !/^(original|thumbnail)$/.test(params.variant)) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const response = await fetch(`${env.API_URL || 'http://127.0.0.1:8080'}/media/${params.id}/${params.variant}`, {
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
