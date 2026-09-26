<script>
  /**
   * One vote per person per post, and the two directions are mutually
   * exclusive: the unique key on `post_votes` means storing an upvote replaces
   * that person's downvote rather than adding to it. This component mirrors
   * that as a toggle, so a button that is already active clears the vote
   * instead of doing nothing.
   */
  import { onMount } from 'svelte';
  import { nextVote, optimisticScore } from '$lib/vote-toggle.mjs';
  export let id;
  export let score = 0;
  export let yourVote = null;

  let token = '';
  let busy = false;
  // Optimistic copy so the buttons respond immediately; reconciled with the
  // server's authoritative score and vote once the request settles.
  let currentScore = score;
  let currentVote = yourVote ?? null;

  onMount(() => {
    token = localStorage.getItem('swartzit_session') ?? '';
  });

  // The same post object can be re-rendered from a refreshed feed, so adopt
  // incoming state unless a request of ours is already in flight.
  $: if (!busy && score !== undefined) currentScore = score;
  $: if (!busy && yourVote !== currentVote) currentVote = yourVote ?? null;

  $: upvoted = currentVote === 1;
  $: downvoted = currentVote === -1;

  async function cast(direction) {
    if (!token || busy) return;
    const next = nextVote(currentVote, direction);
    const previousScore = currentScore;
    const previousVote = currentVote;

    busy = true;
    currentVote = next || null;
    currentScore = optimisticScore(previousScore, previousVote, next);
    try {
      const response = await fetch(`/api/posts/${id}/vote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ value: next })
      });
      if (!response.ok) {
        // The server rejected it, so undo the optimistic change rather than
        // leaving the UI claiming a vote that was not recorded.
        currentScore = previousScore;
        currentVote = previousVote;
        return;
      }
      const result = await response.json();
      currentScore = result.score;
      currentVote = result.your_vote ?? null;
    } catch {
      currentScore = previousScore;
      currentVote = previousVote;
    } finally {
      busy = false;
    }
  }
</script>

<div class="vote-controls" aria-label="Post voting">
  <button
    class="vote-button icon-button upvote"
    class:active={upvoted}
    disabled={busy || !token}
    aria-pressed={upvoted}
    aria-label={token ? (upvoted ? 'Remove your upvote' : 'Upvote') : 'Sign in to upvote'}
    title={token ? (upvoted ? 'Remove your upvote' : 'Upvote') : 'Sign in to upvote'}
    on:click={() => cast(1)}
  >
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 1-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 0 1-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 9.953 4.167 9.5 5 9.5h1.053c.472 0 .745.556.5.96a8.958 8.958 0 0 0-1.302 4.665c0 1.194.232 2.333.654 3.375Z" /></svg>
  </button>
  <span class="vote-score" aria-live="polite">{currentScore}</span>
  <button
    class="vote-button icon-button downvote"
    class:active={downvoted}
    disabled={busy || !token}
    aria-pressed={downvoted}
    aria-label={token ? (downvoted ? 'Remove your downvote' : 'Downvote') : 'Sign in to downvote'}
    title={token ? (downvoted ? 'Remove your downvote' : 'Downvote') : 'Sign in to downvote'}
    on:click={() => cast(-1)}
  >
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6.633 13.75c-.806 0-1.533.446-2.031 1.08a9.041 9.041 0 0 1-2.861 2.4c-.723.384-1.35.956-1.653 1.715a4.498 4.498 0 0 0-.322 1.672v1.933a.75.75 0 0 1-.75.75 2.25 2.25 0 0 1-2.25-2.25c0-1.152.26-2.243.723-3.218.266-.558-.107-1.282-.725-1.282m0 0H3.507c-1.026 0-1.945-.694-2.054-1.715a2.625 2.625 0 0 1-.068-1.285 11.95 11.95 0 0 1 2.649-7.521c.388-.482.987-.729 1.605-.729H10.52c.483 0 .964.078 1.423.23l3.114 1.04a4.501 4.501 0 0 0 1.423.23h1.456m-10.598 9.75H14.25M18.096 5.5c-.083.205-.173.405-.27.602-.197.4.078.898.523.898h.908c.889 0 1.713.518 1.972 1.368a12 12 0 0 1 .521 3.507c0 1.553-.295 3.036-.831 4.398-1.11 1.11-2.893 1.11-4.002 0-.111-.113-.212-.238-.3-.375H9.42c-.112 0-.224-.006-.336-.018a11.95 11.95 0 0 1-2.649-7.521c.388-.482.987-.729 1.605-.729H10.5c.483 0 .964.078 1.423.23l3.114 1.04c.383.127.78.188 1.17.188h1.871Z" /></svg>
  </button>
</div>
