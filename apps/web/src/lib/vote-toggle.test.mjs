import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { nextVote, optimisticScore } from './vote-toggle.mjs';

const repoFile = relative =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('clicking the direction you already hold clears the vote', () => {
  assert.equal(nextVote(1, 1), 0, 'a second upvote removes it');
  assert.equal(nextVote(-1, -1), 0, 'a second downvote removes it');
});

test('clicking the opposite direction replaces the vote rather than adding one', () => {
  assert.equal(nextVote(1, -1), -1);
  assert.equal(nextVote(-1, 1), 1);
});

test('the first click on either direction records that vote', () => {
  assert.equal(nextVote(null, 1), 1);
  assert.equal(nextVote(null, -1), -1);
  assert.equal(nextVote(undefined, 1), 1);
});

test('a click can never yield two votes at once', () => {
  // Whatever the starting state, one click leaves exactly one settled outcome:
  // up, down, or nothing.
  for (const held of [null, 1, -1]) {
    for (const direction of [1, -1]) {
      const result = nextVote(held, direction);
      assert.ok([0, 1, -1].includes(result), `unexpected value ${result}`);
      if (result !== 0) {
        assert.equal(result, direction, 'the click wins, it is not cumulative');
      }
    }
  }
});

test('the optimistic score matches what the server will report', () => {
  // No vote held: +1 or -1.
  assert.equal(optimisticScore(10, null, 1), 11);
  assert.equal(optimisticScore(10, null, -1), 9);
  // Clearing an upvote gives back the point; clearing a downvote takes it back.
  assert.equal(optimisticScore(10, 1, 0), 9);
  assert.equal(optimisticScore(10, -1, 0), 11);
  // Flipping direction is a net swing of two, not one.
  assert.equal(optimisticScore(10, 1, -1), 8);
  assert.equal(optimisticScore(10, -1, 1), 12);
  // Re-clicking the held direction and clearing are the same outcome.
  assert.equal(optimisticScore(10, 1, nextVote(1, 1)), optimisticScore(10, 1, 0));
});

test('the database makes one vote per person per post a hard constraint', () => {
  // The client rules above are a convenience. This is the guarantee: the
  // primary key is what makes the directions mutually exclusive server-side, so
  // changing it would silently allow both at once.
  const schema = repoFile('../../../../crates/server/migrations/0004_votes.sql');
  assert.match(schema, /PRIMARY KEY \(post_id, author_id\)/);
  assert.match(schema, /CHECK \(value IN \(-1, 1\)\)/);
});

test('the component toggles through the tested rules and shows which vote is held', () => {
  const component = repoFile('./VoteButtons.svelte');
  assert.match(component, /from '\$lib\/vote-toggle\.mjs'/);
  assert.match(component, /nextVote\(currentVote, direction\)/);
  // The active direction is exposed to assistive technology, not just colour.
  assert.match(component, /aria-pressed=\{upvoted\}/);
  assert.match(component, /aria-pressed=\{downvoted\}/);
  // The old separate "clear" control is gone; the arrows toggle themselves.
  assert.doesNotMatch(component, /Clear vote/);
});

test('the downvote button uses the requested 24px outline thumb icon', () => {
  const component = repoFile('./VoteButtons.svelte');
  const downvote = component.split('class="vote-button icon-button downvote"')[1];
  const expectedPath = 'M7.498 15.25H4.372c-1.026 0-1.945-.694-2.054-1.715a12.137 12.137 0 0 1-.068-1.285c0-2.848.992-5.464 2.649-7.521C5.287 4.247 5.886 4 6.504 4h4.016a4.5 4.5 0 0 1 1.423.23l3.114 1.04a4.5 4.5 0 0 0 1.423.23h1.294M7.498 15.25c.618 0 .991.724.725 1.282A7.471 7.471 0 0 0 7.5 19.75 2.25 2.25 0 0 0 9.75 22a.75.75 0 0 0 .75-.75v-.633c0-.573.11-1.14.322-1.672.304-.76.93-1.33 1.653-1.715a9.04 9.04 0 0 0 2.86-2.4c.498-.634 1.226-1.08 2.032-1.08h.384m-10.253 1.5H9.7m8.075-9.75c.01.05.027.1.05.148.593 1.2.925 2.55.925 3.977 0 1.487-.36 2.89-.999 4.125m.023-8.25c-.076-.365.183-.75.575-.75h.908c.889 0 1.713.518 1.972 1.368.339 1.11.521 2.287.521 3.507 0 1.553-.295 3.036-.831 4.398-.306.774-1.086 1.227-1.918 1.227h-1.053c-.472 0-.745-.556-.5-.96a8.95 8.95 0 0 0 .303-.54';
  assert.ok(downvote, 'downvote button exists');
  assert.match(downvote, /<svg[^>]*viewBox="0 0 24 24"[^>]*stroke-width="1\.5"[^>]*class="size-6"/);
  assert.ok(downvote.includes(`d="${expectedPath}"`), 'downvote path matches the supplied outline icon');
});

test('both vote surfaces use the one component', () => {
  // A second, divergent copy of the controls is how these drift apart.
  const detail = repoFile('../routes/post/[id]/+page.svelte');
  assert.match(detail, /<PostActions post=\{data\.post\}/);
  assert.doesNotMatch(detail, /\/vote`/);
  const actions = repoFile('./PostActions.svelte');
  assert.match(actions, /<VoteButtons [^>]*yourVote=\{post\.your_vote\}/);
  assert.match(actions, /<ShareButton /);
  assert.match(actions, /<BookmarkButton /);
});
