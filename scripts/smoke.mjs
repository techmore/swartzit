import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Run only against a development instance: creates a dedicated test account
// and community whose data remain available for inspection.
const origin = process.env.SWARTZIT_URL || 'http://127.0.0.1:4173';
const suffix = randomBytes(5).toString('hex');
const handle = `smoke_${suffix}`;
const password = randomBytes(24).toString('hex');
let token;
async function api(path, method = 'GET', body, authenticated = false) {
  const response = await fetch(`${origin}/api${path}`, {
    method, headers: {
      'content-type': 'application/json',
      ...(authenticated ? { authorization: `Bearer ${token}` } : {})
    }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}
assert.equal((await fetch(origin)).status, 200);
assert.equal((await api('/accounts', 'POST', { handle, password })).status, 201);
const login = await api('/sessions', 'POST', { handle, password });
assert.equal(login.status, 200);
token = login.data.token;
assert.equal((await api('/me', 'GET', undefined, true)).data.handle, handle);
assert.notEqual((await api('/sessions', 'POST', { handle: 'river', password })).status, 503);
assert.equal((await api('/communities', 'POST', { slug: handle, name: 'Local smoke test' }, true)).status, 201);
assert.equal((await api('/posts', 'POST', { community: handle, title: 'Anonymous write', body: '' })).status, 400);
const created = await api('/posts', 'POST', { community: handle, title: 'Smoke discussion', body: 'Local end-to-end check' }, true);
assert.equal(created.status, 201);
const id = created.data.id;
const comment = await api(`/posts/${id}/comments`, 'POST', { body: 'Parent' }, true);
assert.equal(comment.status, 201);
assert.equal((await api(`/posts/${id}/comments`, 'POST', { body: 'Reply', parent_id: comment.data.id }, true)).status, 201);
assert.equal((await api(`/posts/${id}/vote`, 'POST', { value: 1 }, true)).data.score, 1);
assert.equal((await api(`/posts/${id}/vote`, 'POST', { value: 1 }, true)).data.score, 1);
assert.equal((await api(`/posts/${id}/vote`, 'POST', { value: -1 }, true)).data.score, -1);
assert.equal((await api(`/posts/${id}/vote`, 'POST', { value: 0 }, true)).data.score, 0);
assert.equal((await api(`/communities/${handle}/subscription`, 'POST', undefined, true)).status, 200);
assert.ok((await api('/home', 'GET', undefined, true)).data.posts.some(post => post.id === id));
const html = await (await fetch(`${origin}/post/${id}`)).text();
assert.ok(html.includes('Smoke discussion') && html.includes('Parent') && html.includes('Reply'), 'Public HTML contains discussions without JavaScript');
assert.equal((await api('/sessions', 'DELETE', undefined, true)).status, 204);
assert.equal((await api('/me', 'GET', undefined, true)).status, 400);
console.log('PASS: public SSR, signup, login, community, post, nested comments, vote replacement, subscriptions, logout/revocation.');
