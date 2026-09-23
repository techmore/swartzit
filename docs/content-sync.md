# Recurring content sync

The local Codex thread heartbeat runs hourly. This is an agent-operated browser
collector, not a standalone X API daemon. It requires the Mac, Codex, Swartzit,
and an accessible signed-in Brave session. Browser login or user-control blocks
must be reported, never bypassed. Do not send to Signal or enable its old job.

## Each hourly run

1. Work from `/Users/seandolbec/Projects/modern-reddit`. Check the local API.
2. Independently run `node scripts/scheduled-imports.mjs --job ddario --limit 3 --due-hours 24`.
   This publishes up to three previously uncheckpointed Commons sources from the
   Daddario manifest per day. Recheck source credits/licenses. No private library
   ratings/comments are copied. Exhaustion means no unseen eligible library
   sources remain; report it rather than pretending fresh photos were found.
3. Read X using the supported browser tools in Brave, signed in as
   `@techmore_edu`. Read **Following** and **For You**, not the user's profile.
   Collect at most five eligible public posts per feed, ten total. Limit browsing
   to three scrolls per feed. Respect user takeover. Never read DMs, copy cookies,
   or reproduce protected posts. Do not infer that every visible post is public:
   skip protected-author indicators, restricted quotes and uncertain visibility.
4. Expand truncated post text. Capture the actual author and status URL; do not
   confuse the reposter or quoted author with the main author. Preserve text
   exactly, including source context. Use concise descriptive titles. Missing
   metrics and exact publication dates are null, never guessed. Capture exact
   counts from accessible labels where possible, not rounded display strings.
   The publisher automatically resolves public photos, MP4 videos and quoted
   attachments through X's public syndication metadata. Media lookup failures
   fail the batch instead of silently publishing a text-only replacement.
   Only use image URLs actually observed from the public source CDN; when media
   cannot be captured, say so in attribution and link to the original. Do not
   replace media-only posts with invented text. Skip content requiring additional
   publication approval and report that it was held, without blocking other posts.
5. Create `.local/import-previews/scheduled-x.json`, an array of normalized
   records documented in README. Set community `x_imports`, provider `x`, and
   observed_at to the actual capture time. Attribute the originating feed.
   Deduplicate status IDs within the batch. Never replace a failed collection
   with the old archive or refresh timestamps on stale content.
6. Run `node scripts/scheduled-imports.mjs --job x --batch .local/import-previews/scheduled-x.json --limit 10`.
   Verify returned post content through the public API. On zero candidates,
   report the collector outcome (no eligible posts vs login/collection failure).
7. The publisher stores the latest 100 run receipts in `.local/sync-x.json`
   and `.local/sync-ddario.json`. Successful photo sources are checkpointed after
   each post, so partial failures retry without advancing past failed items.
   Failures exit nonzero. Sessions are revoked on completion. Per-job PID locks
   prevent overlapping publishers; dead-process locks are recovered on next run.

The database deduplicates canonical source URLs and preserves local discussions
on refresh. Source metrics are snapshots; X reply text is not imported, while
Reddit cross-posts retain a bounded top-level comment snapshot for context.
Inline videos stream from video.twimg.com or v.redd.it with controls and no autoplay;
photos link to their full-size source. This is remote playback, not permanent
media hosting. Library posting draws from the existing manifest: it does
not discover new Daddario photos across the internet. No image files are hosted
or torrented by this runner.

For a larger Daddario candidate pool, use an authenticated official X API
crawler job with a reviewed query such as
`search:("Alexandra Daddario" OR Daddario) has:media -is:retweet -is:reply`.
The worker expands public author and media metadata, skips protected authors,
and keeps the source URL and snapshot metrics. A public X post still does not
prove that its photo is licensed for redistribution; review candidates and keep
the source link and attribution before enabling automatic publication.

For a service that runs without this Mac/Codex/browser, collection can instead
be delegated to a local Hermes process. Hermes should use an authorized browser
session or official API connector, write the fresh normalized array to an inbox,
and run `node scripts/hermes-content-sync.mjs --job feed --inbox
.local/hermes/inbox --limit 10`. The wrapper hands records to the same publisher
and leaves failed files for retry. Keep credentials and browser state in Hermes'
local environment; never copy cookies, read DMs, bypass visibility controls, or
fabricate metrics. This is still a local collector, not an independent hosted
Linux service. For unattended hosted collection, use the official X API through
`scripts/swartzit-worker.mjs` with `X_BEARER_TOKEN` instead.
