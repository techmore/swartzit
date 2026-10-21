import test from 'node:test';
import assert from 'node:assert/strict';
import { loginHref, safeNextPath, signIn, storeSessionToken } from './auth-session.mjs';

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return body; }
});
const htmlResponse = status => ({
  ok: false,
  status,
  async json() { throw new SyntaxError('Unexpected token <'); }
});

test('sign-in returns the token on success and trims the handle', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, init }; return jsonResponse(200, { token: 'abc', expires_at: '2030-01-01T00:00:00Z' }); };
  const result = await signIn({ handle: '  Person ', password: 'correct horse battery staple' }, { fetch: fetchImpl });
  assert.deepEqual(result, { ok: true, token: 'abc', expiresAt: '2030-01-01T00:00:00Z' });
  assert.equal(sent.url, '/api/sessions');
  assert.equal(sent.init.method, 'POST');
  assert.deepEqual(JSON.parse(sent.init.body), { handle: 'Person', password: 'correct horse battery staple' });
});

test('sign-in surfaces the API error message', async () => {
  const result = await signIn({ handle: 'person', password: 'nope' }, { fetch: async () => jsonResponse(400, { error: 'Invalid handle or password' }) });
  assert.deepEqual(result, { ok: false, error: 'Invalid handle or password', status: 400 });
});

test('sign-in never throws on network failures or non-JSON gateway errors', async () => {
  const offline = await signIn({ handle: 'person', password: 'secret-password' }, { fetch: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(offline.ok, false);
  assert.match(offline.error, /Could not reach Swartzit/);

  const gateway = await signIn({ handle: 'person', password: 'secret-password' }, { fetch: async () => htmlResponse(502) });
  assert.equal(gateway.ok, false);
  assert.match(gateway.error, /temporarily unavailable/);
  assert.equal(gateway.status, 502);

  const malformed = await signIn({ handle: 'person', password: 'secret-password' }, { fetch: async () => jsonResponse(200, { nope: true }) });
  assert.equal(malformed.ok, false);
  assert.match(malformed.error, /unexpected response/);
});

test('sign-in rejects empty credentials before calling the API', async () => {
  let called = false;
  const result = await signIn({ handle: '   ', password: '' }, { fetch: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.match(result.error, /handle and password/);
});

test('next paths stay on this origin', () => {
  assert.equal(safeNextPath('?next=%2Fbookmarks'), '/bookmarks');
  assert.equal(safeNextPath('?next=/post/abc%3Fx%3D1'), '/post/abc?x=1');
  assert.equal(safeNextPath('?next=https://evil.example/'), '/');
  assert.equal(safeNextPath('?next=//evil.example'), '/');
  assert.equal(safeNextPath('?next=/\\evil.example'), '/');
  assert.equal(safeNextPath('?next=%2F%09%2Fevil.example'), '/');
  assert.equal(safeNextPath('?next=%2F%0A%2Fevil.example'), '/');
  assert.equal(safeNextPath('?next=/x%5C..%5C%5Cevil.example'), '/');
  assert.equal(safeNextPath(''), '/');
  assert.equal(safeNextPath(undefined, '/communities'), '/communities');
});

test('login links remember where the visitor was', () => {
  assert.equal(loginHref('/communities?q=rust'), '/login?next=%2Fcommunities%3Fq%3Drust');
  assert.equal(loginHref('/'), '/login');
  assert.equal(loginHref('/login?next=%2Fx'), '/login');
  assert.equal(loginHref('/logout'), '/login');
  assert.equal(loginHref('https://evil.example/u/person'), '/login?next=%2Fu%2Fperson');
});

test('storing the token reports storage failures instead of throwing', () => {
  const stored = {};
  assert.equal(storeSessionToken('abc', { setItem(key, value) { stored[key] = value; } }), true);
  assert.deepEqual(stored, { swartzit_session: 'abc' });
  assert.equal(storeSessionToken('abc', { setItem() { throw new Error('QuotaExceededError'); } }), false);
});
