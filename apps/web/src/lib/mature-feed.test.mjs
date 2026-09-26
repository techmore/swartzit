import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoFile = relative =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const server = repoFile('../../../../crates/server/src/main.rs');
const pageServer = repoFile('../routes/+page.server.js');
const page = repoFile('../routes/+page.svelte');

test('the feed can be asked for only R and X-rated posts', () => {
  // A positive filter, not an exclusion: it asks for the mature posts.
  assert.match(server, /mature_only: Option<bool>/);
  assert.match(server, /fn mature_only\(&self\) -> bool/);
  // Applied to both the public feed and the following feed, so switching feeds
  // does not quietly drop the filter.
  const applied = server.match(/content_rating IN \('r', 'x'\)/g) ?? [];
  assert.equal(applied.length, 2, 'both the public and following feeds must filter');
  // It is a conjunction with the existing hides, so `mature_only` plus
  // `hide_r` narrows to X alone rather than conflicting.
  assert.match(server, /NOT \$6 OR p\.content_rating IN \('r', 'x'\)/);
  assert.match(server, /NOT \$7 OR p\.content_rating IN \('r', 'x'\)/);
});

test('the shared feed cache keys on the mature filter', () => {
  // The public feed is cached and served to every reader. A key that omitted
  // the mature flag would hand the general feed to a reader who asked for the
  // mature one, or the reverse.
  assert.match(server, /"posts:\{}:\{}:\{}:\{\}"/);
  assert.match(server, /hide_x,\s*mature_only,\s*\)/);
});

test('the mature filter is opt-in and defaults to off', () => {
  // It must never be on by default: a general reader should not be shown
  // mature content by a missing or malformed parameter.
  assert.match(server, /self\.mature_only\.unwrap_or\(false\)/);
  // The page only forwards it when explicitly requested.
  assert.match(pageServer, /\['true', '1'\]\.includes\(url\.searchParams\.get\('mature'\)\)/);
  assert.match(pageServer, /if \(matureOnly\) params\.set\('mature_only', 'true'\)/);
});

test('every link and form keeps the mature view', () => {
  // Dropping the flag on navigation would silently return the reader to the
  // general feed without saying so.
  const carriers = page.match(/data\.matureOnly/g) ?? [];
  assert.ok(carriers.length >= 7, `expected the flag to be carried widely, saw ${carriers.length}`);
  // The reader can see which view they are in and get back out of it.
  assert.match(page, /Mature only/);
  assert.match(page, /name="mature" value="true" checked=\{data\.matureOnly\}/);
});

test('an admin can correct a rating from the post page', () => {
  const control = repoFile('./ContentRatingControl.svelte');
  // Gated on the server's own is_admin, and the control renders nothing at all
  // for anyone else rather than only hiding the control.
  assert.match(control, /\/api\/me/);
  assert.match(control, /is_admin === true/);
  assert.match(control, /\{#if isAdmin\}/);
  // It posts to the audited admin endpoint.
  assert.match(control, /\/api\/admin\/posts\/\$\{postId\}\/content-rating/);
  // All three ratings an admin may set.
  for (const value of ['general', 'r', 'x']) {
    assert.match(control, new RegExp(`value: '${value}'`));
  }
  // The badge updates from the server's answer, not the local guess.
  assert.match(control, /dispatch\('update', \{ content_rating: result\.content_rating \}\)/);
  // The control belongs on the post being corrected, not the home feed.
  const postPage = repoFile('../routes/post/[id]/+page.svelte');
  assert.match(postPage, /<ContentRatingControl /);
});
