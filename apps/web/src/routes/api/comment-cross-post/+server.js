import { env } from '$env/dynamic/private';
import { parseXStatusUrl, resolveXPost } from '$lib/x-source.mjs';
import { parseRedditPostUrl, resolveRedditPost } from '$lib/reddit-source.mjs';
import { parseYouTubeUrl, resolveYouTubePost } from '$lib/youtube-source.mjs';

const api = (env.API_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const json = (body, status = 200) => Response.json(body, { status });

export async function POST({ request }) {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [a-f\d]{64}$/i.test(authorization)) return json({ error: 'Sign in to share an external post.' }, 401);
  if (Number(request.headers.get('content-length') || 0) > 8192) return json({ error: 'Request is too large.' }, 413);

  let input;
  try { input = await request.json(); } catch { return json({ error: 'Send an X post link.' }, 400); }
  const postId = Number(input.post_id);
  const parentId = input.parent_id == null ? null : Number(input.parent_id);
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!Number.isSafeInteger(postId) || postId < 1
      || (parentId !== null && (!Number.isSafeInteger(parentId) || parentId < 1))) {
    return json({ error: 'This discussion or reply is no longer available.' }, 400);
  }
  if (body.length > 10000) return json({ error: 'Comment must be 10000 characters or fewer.' }, 400);

  let provider = '';
  try { parseXStatusUrl(url); provider = 'x'; }
  catch {
    try { parseRedditPostUrl(url); provider = 'reddit'; }
    catch {
      try { parseYouTubeUrl(url); provider = 'youtube'; }
      catch { return json({ error: 'Paste a public X, Reddit, or YouTube video link.' }, 400); }
    }
  }

  try {
    const session = await fetch(`${api}/api/me`, { headers: { authorization }, signal: AbortSignal.timeout(5000) });
    if (!session.ok) return json({ error: 'Your session has expired. Sign in again.' }, 401);
  } catch {
    return json({ error: 'Swartzit is temporarily unavailable. Please try again.' }, 503);
  }

  let source;
  try {
    source = provider === 'x'
      ? await resolveXPost(url)
      : provider === 'reddit'
        ? await resolveRedditPost(url)
        : await resolveYouTubePost(url);
  }
  catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const sourceName = provider === 'reddit' ? 'Reddit' : provider === 'youtube' ? 'YouTube' : 'X';
    return json({ error: timedOut ? `${sourceName} took too long to respond. Try again shortly.` : error.message || `Could not read that public ${sourceName} post.` }, timedOut ? 504 : 502);
  }

  try {
    const response = await fetch(`${api}/api/posts/${postId}/comments`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ parent_id: parentId, body, source }),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({ error: 'Could not publish this comment.' }));
    return json(result, response.status);
  } catch {
    return json({ error: 'Swartzit is temporarily unavailable. Please try again.' }, 503);
  }
}
