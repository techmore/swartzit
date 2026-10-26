# Human rating review and training examples

Open **Admin → Rating review** (also available from the account menu). Qwen's
suggestion is displayed beside the current post rating and the full saved post.
Choose General, R or X and save the human rating. That action updates the post
with moderator provenance and appends a training-label history record.
Dismissed items and unreviewed model suggestions never become training labels.
Relabeling preserves history; exports contain only the latest human label for
each version of a post's content. A changed post cannot accept a stale review.

The current policy is `suggestive-r-explicit-x-v1`: suggestive photographs are R;
nudity and explicit material are X. A model error or incomplete media review is
shown for human review, rather than silently becoming General. Saving a label
means the reviewer has checked the full post, including attachments.

## Host worker

The worker runs on the Linux host, reads Swartzit through its normal HTTPS API,
and calls the existing Ollama service on host loopback. Default model:
`qwen3.5:2b`, context 4096, one request at a time. It queues at most ten items per
run and stops collecting when 100 reviews are pending. It never calls a rating
decision endpoint or writes a human training label.

Keep the existing scheduler credentials in a mode-600
`~/.local/share/swartzit-review/worker.env` file. Install the user service with:

```sh
bash scripts/install-host-rating-review.sh
systemctl --user start swartzit-rating-review.service
journalctl --user -u swartzit-rating-review.service --since today
```

The host's user manager must persist when logged out (`loginctl show-user`
reports `Linger=yes` on Ser8). The five-minute timer uses a process lock and the
server deduplicates by content hash, model digest and policy. The model sees
post content, not API credentials. Model weights stay outside Incus.

## Exporting training data

The queue's **Export human training labels** button downloads JSONL with the
reviewed input, human label, correction notes, model/policy provenance, and
image hashes. Download access requires an administrator session.

The host retains the actual 512-pixel JPEG inputs under its private
`training-images` directory, keyed by SHA256. For an export including those
pixels, load the existing private worker environment and run:

```sh
set -a
. "$HOME/.local/share/swartzit-review/worker.env"
set +a
python3 "$HOME/.local/share/swartzit-review/worker.py" \
  --export-training /path/to/new-private-dataset
```

The exporter checks every image checksum and includes only human labels.
Text-only examples remain usable for text classification. Video references are
preserved in the input manifest; full video/frame training data is a separate
step. The model examines at most two images per post, and any incomplete review
is explicitly flagged for the human reviewer. Cached images are retained for
later training; no automatic training or model replacement is performed.

## Bookmark content and organization

Bookmarks render saved post text, original author details, media and video
controls directly. The private list API supplies content in one page request;
older servers use a bounded post-detail fallback. Import and folder-management
forms are collapsed so saved posts appear first.

Newest bookmarked first is the default; the toolbar also offers oldest first.
A separate `sort_at` key can restore the original X history order after a
backfill without rewriting the actual saved timestamp. Moving a bookmark into
a folder does not move it to the top. Removing and saving it again does.

A bookmark has one private folder and up to twenty private tags. Tags can be
added on each card and used as a filter independently of its folder. Folder
and tag counts follow the same account and publication visibility rules as the
bookmark list. Training labels describe the complete post, so keep text with
its images when preparing a multimodal training set.
