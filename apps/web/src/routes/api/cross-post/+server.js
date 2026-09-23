import { env } from '$env/dynamic/private';
import { parseXStatusUrl, resolveXPost } from '$lib/x-source.mjs';

const api = (env.API_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const json = (body, status = 200) => Response.json(body, { status });

export async function POST({ request }) {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [a-f\d]{64}$/i.test(authorization)) return json({ error: 'Sign in to share a source post.' }, 401);
  if (Number(request.headers.get('content-length') || 0) > 8192) return json({ error: 'Request is too large.' }, 413);

  let input;
  try { input = await request.json(); } catch { return json({ error: 'Send a link and choose a community.' }, 400); }
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const community = typeof input.community === 'string' ? input.community.trim().toLowerCase() : '';
  if (!/^[a-z0-9_]{1,40}$/.test(community)) return json({ error: 'Choose a valid community.' }, 400);
  try { parseXStatusUrl(url); } catch (error) { return json({ error: error.message }, 400); }

  try {
    const session = await fetch(`${api}/api/me`, { headers: { authorization }, signal: AbortSignal.timeout(5000) });
    if (!session.ok) return json({ error: 'Your session has expired. Sign in again.' }, 401);
  } catch {
    return json({ error: 'Swartzit is temporarily unavailable. Please try again.' }, 503);
  }

  let post;
  try { post = await resolveXPost(url); }
  catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return json({ error: timedOut ? 'X took too long to respond. Try again shortly.' : error.message || 'Could not read that public X post.' }, timedOut ? 504 : 502);
  }

  try {
    const response = await fetch(`${api}/api/posts/cross-post`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ ...post, community }),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({ error: 'Could not publish this post.' }));
    return json(result, response.status);
  } catch {
    return json({ error: 'Swartzit is temporarily unavailable. Please try again.' }, 503);
  }
}
