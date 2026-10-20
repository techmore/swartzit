import { fail, redirect } from '@sveltejs/kit';
import { safeNextPath } from '#lib/auth-session.mjs';

export const actions = {
  default: async ({ request, fetch }) => {
    const fields = await request.formData();
    const handle = String(fields.get('username') ?? '').trim();
    const password = String(fields.get('password') ?? '');
    // Carry the post-sign-in destination through account creation.
    const next = safeNextPath(new URLSearchParams({ next: String(fields.get('next') ?? '') }).toString());
    try {
      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle, password })
      });
      const result = await response.json();
      if (!response.ok) return fail(response.status, { handle, error: result.error ?? 'Could not create account' });
    } catch { return fail(503, { handle, error: 'The server could not be reached. Please try again.' }); }
    redirect(303, next === '/' ? '/login?created=1' : `/login?created=1&next=${encodeURIComponent(next)}`);
  }
};
