# Daddario library enhancement review

Reviewed the Hermes skill, `dd_scrape_commons.py`, `dd_library.py`, `dd_db.py`,
the live manifest, the supported DB stats command, and Swartzit preparation and
publishing scripts. This was a read-only investigation of the library; no
photos, feedback, schedules, or publication settings were changed.

## Current evidence

- Manifest and DB both contain 229 records; the images directory has 229 files.
- 213 manifest paths do not resolve using the library's current root-relative
  convention. All 213 have matching filenames in `images/`; this is path-format
  drift, not evidence of lost images. Examples use
  `media/alexandra-daddario/images/dd_0002.jpg` instead of `images/dd_0002.jpg`.
- 214 records lack width/height metadata. All records have perceptual hashes;
  none repeat exactly. Near-duplicate quality was not assessed visually.
- 19 records use upload.wikimedia.org; 210 use alexandra-daddario.com. The
  Swartzit adapter only accepts Commons candidates, subject to metadata checks.
- None of the manifest records stores a license field. Swartzit retrieves
  Commons credit/license metadata when preparing each eligible source.
- The supported DB stats command reports 1 liked/rated record, 228 unclassified,
  and no dislikes. There is too little feedback to substantiate personalized
  ranking quality.

## Priority 1: integrity and honest outcomes

1. Add a `doctor --dry-run` command. Resolve legacy paths, verify readable files,
   backfill dimensions, and report manifest/DB divergence. Provide a backed-up,
   explicit repair mode through the DB helper. Existing `import-manifest` only
   inserts missing rows, so rerunning it does not repair paths in existing rows.
2. Lock the complete load/allocate/write transaction. `save_manifest` uses an
   atomic rename, but concurrent writers can still overwrite each other's data,
   choose the same image filename, or race over the shared `.tmp` file.
3. Allocate IDs once per batch. `next_id_start(images_dir) + 1 + added` rescans
   the directory after each addition and also adds the running count, causing
   skipped numbers. Avoid tying identity to mutable directory contents.
4. Return structured results and failure exit codes. Download/decode failures
   currently print SKIP without increasing the skipped counter. DB sync catches
   exceptions and prints a message; Commons `--add` ignores child return codes.
   A scheduled job can therefore report success despite acquisition/indexing
   failures. Separate added, duplicate, rejected, failed, and retryable counts.
5. Preserve corrupt publisher state rather than overwriting it. The current
   Swartzit runner catches invalid state, then its finally block writes a new
   receipt into state anyway. A JSON parse failure can replace the checkpoint
   set with defaults. Keep the original file and write a separate failure receipt.

## Priority 2: replenish and track publication

1. Add bounded discovery before the daily publish step. The current heartbeat
   publishes existing manifest sources only. Commons search already paginates
   within a run, but restarts from the same query on each invocation. Persist
   discovery progress or a known-source index, and distinguish new discoveries
   from revisiting old candidates. Report exhaustion separately from API failure.
2. Store canonical source identity, original file page, photographer, license
   identifier/link, description, and metadata-check time with each candidate.
   The scraper currently requests URL/size/MIME and discards richer metadata.
   Keep local-library eligibility and Swartzit-publication eligibility separate.
   The 210 gallery records are not automatically publication-ready merely because
   their images were collected locally.
3. Move publication identity/checkpoints into the server database. Files in
   `.local` cannot coordinate multiple hosts or destinations and do not identify
   whether a source was already manually imported. Source URL dedup currently
   prevents duplicate posts, but a day's quota can be consumed by updates.
4. Add an admin queue: ready, published, duplicate, missing metadata, retrying,
   rejected, exhausted. Show last discovery, next due time, remaining candidates,
   source health, and recent failures. Allow community routing and per-source
   limits rather than hardcoding this person and a local Mac path throughout.

## Priority 3: better selection and reader experience

- Separate choosing a brief from acknowledging delivery. `brief` increments
  shown counters before anything is delivered, and its fallback can select
  disliked photos. Exclude dislikes by default and acknowledge after delivery.
- Add event/date/photographer metadata and select a varied batch instead of
  manifest insertion order. Keep private library feedback private; optional
  local preference ranking must not publish ratings or personal comments.
- Add canonical URL and exact-content hashes before perceptual matching;
  normalize EXIF orientation before hashing. Preserve alternate source/credit
  information when a perceptual duplicate is found. Use a reviewable cluster
  for close matches rather than silently discarding distinct burst photos.
- Preserve originals alongside display derivatives if local storage is needed.
  The current downloader always saves flattened JPEGs, which loses transparency
  and original encoding. Swartzit currently displays remote source images, so
  local-file repair and remote-display availability are separate concerns.

## Suggested delivery order

First ship the doctor report, path/metadata repair, locking, and structured
failure reporting. Then add incremental discovery plus durable publication
state. Finally expose the queue in Admin and improve photo descriptions and
selection diversity. Verify each stage with temporary fixture libraries and
mocked source failures before touching the live library.

## X discovery proposal (September 18)

Add a dedicated Daddario candidate queue rather than relying on incidental
matches in Following/For You. Use three inputs: a verified first-party account,
a small reviewed list of public photographers/publications/fan accounts, and
name-plus-media search. With the X API, a starting discovery query is
`"Alexandra Daddario" has:media -is:retweet`; refine to approved `from:` accounts
after reviewing results. These are API operators, not a promise that the web
search UI supports identical syntax. Reference:
https://docs.x.com/x-api/posts/search/integrate/build-a-query

Keep a per-source cursor and a small overlap window, deduplicate status IDs,
and use the existing X attachment resolver for images/videos. Group repeated
images by perceptual hash without discarding their source credits. Review
identity, context, and source quality before routing accepted posts to
`alexandra_daddario`. Retain original captions, author, source URL and capture
time, and keep X metric snapshots separate from local engagement. Do not imply
that a public post supplies a reusable license for a permanent media mirror.

The current Commons publisher and generic X import path already exist; this
specialized discovery queue, account verification and source list do not.
