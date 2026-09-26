<script>
  import BookmarkButton from '$lib/BookmarkButton.svelte';
  import { mediaShareUrl } from '$lib/media-share.js';
  import ShareButton from '$lib/ShareButton.svelte';
  import VoteButtons from '$lib/VoteButtons.svelte';

  export let post;
  $: shareUrl = mediaShareUrl(post?.source?.media);
</script>

<div class="post-actions" aria-label="Discussion actions">
  <a class="comment-action" href={'/post/' + post.public_id}>{post.comment_count} comments</a>
  <VoteButtons id={post.id} score={post.score} yourVote={post.your_vote} />
  <ShareButton id={post.public_id} title={post.title} url={shareUrl} media={Boolean(shareUrl)} />
  <BookmarkButton id={post.id} />
</div>

<style>
  .post-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:14px 0;padding:12px 0;border-top:1px solid var(--border,#c7ccc3);border-bottom:1px solid var(--border,#c7ccc3);color:var(--muted,#66766c)}
  .comment-action{color:var(--heading,#292524);font-size:.82rem;font-weight:750;white-space:nowrap}
  .comment-action:hover{color:var(--accent,#575d3d);text-decoration:underline;text-underline-offset:3px}
  :global(.post-actions .vote-controls),:global(.post-actions .share-control),:global(.post-actions .bookmark-control){margin:0}
  :global(.post-actions .vote-controls){gap:6px}
  :global(.post-actions .vote-button.icon-button){width:34px;height:34px;padding:7px}
  :global(.post-actions .vote-score){min-width:20px;text-align:center;font-size:.82rem}
  :global(.post-actions .share-button){padding:6px 11px}
  :global(.post-actions .bookmark-control){gap:8px}
  @media(max-width:700px){.post-actions{gap:9px}.comment-action{font-size:.78rem}}
</style>
