import { json } from '@sveltejs/kit';

export async function GET({ params, fetch }) {
  const handle = String(params.handle ?? '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return json({ error: 'Enter a valid X handle.' }, { status: 400 });
  }

  try {
    const response = await fetch(`https://api.fxtwitter.com/2/profile/${encodeURIComponent(handle)}`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return json({ error: 'X profile lookup failed. Check the handle and try again.' }, { status: 502 });
    const result = await response.json();
    const user = result.user ?? result;
    const avatar = new URL(user.avatar_url ?? '');
    if (avatar.protocol !== 'https:' || avatar.hostname !== 'pbs.twimg.com' || !avatar.pathname.includes('/profile_images/')) {
      return json({ error: 'X did not return a usable profile image.' }, { status: 404 });
    }
    return json({ avatar_url: avatar.toString(), screen_name: String(user.screen_name ?? handle).slice(0, 15) });
  } catch {
    return json({ error: 'Could not load the X profile image right now.' }, { status: 502 });
  }
}
