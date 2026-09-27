/**
 * Vote toggle rules, kept out of the component so they can be tested directly.
 *
 * A person has at most one vote per post. `post_votes` is keyed on
 * (post_id, author_id), so the database already replaces one direction with the
 * other rather than accumulating both. These helpers express the same rule for
 * the client: clicking the direction you already hold clears the vote, and
 * clicking the other direction moves it.
 */

/** The value to send for a click on `direction` given the vote already held. */
export function nextVote(currentVote, direction) {
  return currentVote === direction ? 0 : direction;
}

/**
 * The score to show before the server replies.
 *
 * Clearing a vote (-0) removes whatever was held, so it subtracts that value.
 * Otherwise the score moves by the difference between the new and old votes,
 * which is what makes flipping from a downvote to an upvote a net +2.
 */
export function optimisticScore(currentScore, currentVote, next) {
  const held = currentVote ?? 0;
  return currentScore + (next === 0 ? -held : next - held);
}
