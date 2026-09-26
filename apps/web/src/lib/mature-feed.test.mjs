import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoFile = relative =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const server = repoFile('../../../../crates/server/src/main.rs');
const adminServer = repoFile('../../../../crates/server/src/admin.rs');
const pageServer = repoFile('../routes/+page.server.js');
const page = repoFile('../routes/+page.svelte');
const adminPage = repoFile('../routes/admin/+page.svelte');

test('the rated feed selects exactly R, X, or both ratings', () => {
  // Exact positive selection prevents the default X-hidden preference from
  // accidentally making R+X empty when X posts exist.
  assert.match(server, /ratings: Option<String>/);
  assert.match(server, /matches!\(ratings, "r" \| "x" \| "rx"\)/);
  assert.match(server, /\$7 = 'r'.*\$7 = 'x'.*\$7 = 'rx'/);
  assert.match(server, /\$8 = 'r'.*\$8 = 'x'.*\$8 = 'rx'/);
  assert.match(server, /let hide_x = ratings\.is_none\(\) && !mature_only && query\.hide_x\(\)/);
  // Older mature-only links remain a positive R+X request.
  assert.match(server, /mature_only: Option<bool>/);
  assert.match(server, /fn mature_only\(&self\) -> bool/);
});

test('the shared feed cache keys on the exact rating selection', () => {
  assert.match(server, /"posts:\{}:\{}:\{}:\{}:\{}"/);
  assert.match(server, /hide_x,\s*mature_only,\s*ratings\.unwrap_or\("all"\)/);
});

test('rated content remains opt-in and exact selection is visible in the UI', () => {
  assert.match(server, /self\.mature_only\.unwrap_or\(false\)/);
  assert.match(pageServer, /requestedFeed === 'rated'/);
  assert.match(pageServer, /params\.set\('ratings', ratings\)/);
  assert.match(page, /feedHref\('rated'\)/);
  assert.match(page, /option value="rx">R and X/);
  assert.match(page, /option value="r">R only/);
  assert.match(page, /option value="x">X only/);
});

test('rated selection is preserved during pagination and sorting', () => {
  assert.match(page, /params\.set\('ratings', data\.ratings \|\| 'rx'\)/);
  assert.match(page, /name="ratings" value=\{data\.ratings\}/);
});

test('an admin can correct a rating from the post page', () => {
  const control = repoFile('./ContentRatingControl.svelte');
  // Gated on the server's own is_admin, and the control renders nothing at all
  // for anyone else rather than only hiding the control.
  assert.match(control, /\/api\/me/);
  assert.match(control, /is_admin === true/);
  assert.match(control, /\{#if isAdmin\}/);
  assert.match(control, /\/api\/admin\/posts\/\$\{postId\}\/content-rating/);
  for (const value of ['general', 'r', 'x']) {
    assert.match(control, new RegExp(`value: '${value}'`));
  }
  assert.match(control, /dispatch\('update', \{ content_rating: result\.content_rating \}\)/);
  const postPage = repoFile('../routes/post/[id]/+page.svelte');
  assert.match(postPage, /<ContentRatingControl /);
});

test('admins can see rating provenance and change a rating from the content list', () => {
  assert.match(adminServer, /p\.content_rating,p\.content_rating_source,p\.content_rating_updated_at/);
  assert.match(adminPage, /Current rating \/ source/);
  assert.match(adminPage, /contentRatingSourceLabel\(item\.content_rating_source\)/);
  assert.match(adminPage, /api\(`posts\/\$\{item\.id\}\/content-rating`, 'POST'/);
  assert.match(adminPage, /Rating confirmed as/);
});
