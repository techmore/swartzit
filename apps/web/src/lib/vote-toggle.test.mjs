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

test('both vote surfaces use the one component', () => {
  // A second, divergent copy of the controls is how these drift apart.
  const detail = repoFile('../routes/post/[id]/+page.svelte');
  assert.match(detail, /<VoteButtons /);
  assert.doesNotMatch(detail, /\/vote`/);
  assert.match(repoFile('./PostActions.svelte'), /<VoteButtons [^>]*yourVote=\{post\.your_vote\}/);
});
