import { apiUrl } from '#lib/server/api-url.mjs';

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const notFound = () => new Response('Not found', { status: 404 });

function trustedProfileImage(raw) {
  try {
    const image = new URL(raw);
    return image.protocol === 'https:'
      && image.hostname === 'pbs.twimg.com'
      && !image.username
      && !image.password
      && !image.port
      && image.pathname.includes('/profile_images/')
      ? image.href
      : null;
  } catch {
    return null;
  }
}

export async function GET({ params, url }) {
  if (!/^\d+$/.test(params.id)) return new Response('Not found', { status: 404 });
  let response;
  try {
    response = await fetch(`${apiUrl()}/profile-images/${params.id}`, {
      signal: AbortSignal.timeout(10000),
      redirect: 'error'
    });
  } catch {
    // Use the same-origin image proxy below if the local cache is unavailable.
  }

  if (!response?.ok) {
    const source = trustedProfileImage(url.searchParams.get('src'));
    if (!source) return notFound();
    try {
      response = await fetch(source, {
        headers: { accept: 'image/jpeg,image/png,image/webp,image/gif' },
        signal: AbortSignal.timeout(10000),
        redirect: 'error'
      });
    } catch {
      return notFound();
    }
  }

  if (!response.ok) return notFound();
  const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
  const declaredLength = Number(response.headers.get('content-length'));
  if (!imageTypes.has(contentType) || (Number.isFinite(declaredLength) && declaredLength > 1_048_576)) return notFound();

  const image = await response.arrayBuffer();
  if (image.byteLength > 1_048_576) return notFound();
  return new Response(image, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff'
    }
  });
}
