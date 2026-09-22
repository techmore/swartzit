import { env } from '$env/dynamic/private';

export async function GET({ params }) {
  if (!/^\d+$/.test(params.id)) return new Response('Not found', { status: 404 });
  try {
    const response = await fetch(`${env.API_URL || 'http://127.0.0.1:8080'}/profile-images/${params.id}`, {
      signal: AbortSignal.timeout(10000),
      redirect: 'error'
    });
    if (!response.ok) return new Response('Not found', { status: 404 });
    return new Response(response.body, {
      status: 200,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'public, max-age=86400'
      }
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
