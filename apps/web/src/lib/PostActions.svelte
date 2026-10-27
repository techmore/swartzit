<script>
  import BookmarkButton from '#lib/BookmarkButton.svelte';
  import Icon from '#lib/Icon.svelte';
  import { mediaShareUrl } from '#lib/media-share.js';
  import ShareButton from '#lib/ShareButton.svelte';
  import VoteButtons from '#lib/VoteButtons.svelte';

  export let post;
  $: shareUrl = mediaShareUrl(post?.source?.media);
</script>

<div class="post-actions" aria-label="Discussion actions">
  <VoteButtons id={post.id} score={post.score} yourVote={post.your_vote} />
  <a class="pill comment-action" href={'/post/' + post.public_id + '#comments'} aria-label={`${post.comment_count} comments`}><Icon name="comment" size={16} /><span>{post.comment_count}<span class="word">&nbsp;comments</span></span></a>
  <ShareButton id={post.public_id} title={post.title} url={shareUrl} media={Boolean(shareUrl)} />
  <BookmarkButton id={post.id} />
</div>

<style>
  .post-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; color: var(--muted); }
  .pill { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--muted); font-size: .8rem; font-weight: 600; white-space: nowrap; }
  .pill:hover { background: var(--hover); color: var(--heading); }
  @media (max-width: 460px) { .word { display: none; } .pill { padding: 0 12px; } }
</style>
