import { env } from '$env/dynamic/private';

// One origin in both development and the standalone Node deployment.
// Never accept an upstream host from the request or forward browser cookies.
async function proxy({ request, params, url }) {
  const upstream = new URL(`/api/${params.path}`, env.API_URL || 'http://127.0.0.1:8080');
  upstream.search = url.search;
  const headers = new Headers();
  for (const name of ['content-type', 'authorization']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Caddy owns the public edge. Carry its client address through the trusted
  // local web-to-API hop so the API can hash it for security activity without
  // retaining a raw address.
  const clientAddress = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for');
  if (clientAddress) headers.set('x-forwarded-for', clientAddress);
  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      signal: AbortSignal.timeout(15000),
      redirect: 'error'
    });
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' }
    });
  } catch {
    return Response.json({ error: 'Swartzit is temporarily unavailable. Please try again.' }, { status: 503 });
  }
}
export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
