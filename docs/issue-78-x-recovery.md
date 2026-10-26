# X runner and bookmark recovery

Issue: https://github.com/techmore/swartzit/issues/78

The favorites source for this work is **X Bookmarks**, not Likes.

## Confirmed findings on 2026-10-26

The live application is in the Ser8 `swartzit` Incus container. Its worker
timer is active and enabled. The disabled host-level worker is not evidence
that the application worker is stopped.

All X content runners inspected were paused. Several enabled X crawler jobs
recorded an `EISDIR` error when writing a collected batch: the worker's path
wrapper accepted only one argument, discarding the generated filename under
`worker-batches`. A worker integration test now exercises collection through
publication and checks the actual batch file.

The destination bookmark inventory did not establish source completeness. No
complete bookmark capture or transfer receipt was identified initially.
The container had lost its IPv4 DHCP lease after its interface entered a failed
state. Reconfiguring that interface and renewing the existing lease restored
HTTPS access. The dedicated X profile was then verified to be signed in.
The old Bookmarks URL now redirects to History with Bookmarks selected; the
response operation remains `Bookmarks`. Do not collect the adjacent Likes view.

## Recovery still required

1. Deploy the tested changes through the documented tagged-release and backup
   workflow. Do not patch the live checkout or overwrite the production database.
2. Repeat a no-publish collector test after release. Do not enable a previously paused content
   runner until its destination and schedule have been checked.
3. Capture Bookmarks using the signed-in source, including pagination through a
   verified end-of-list response, or obtain an owner-supplied archive. Preserve folder
   mappings when available. Keep source data and sessions outside Git.
4. Use the existing resumable transfer procedure in
   [bookmark-transfer-workflow.md](bookmark-transfer-workflow.md), confirming
   the destination account and Ser8 origin before applying. Reconcile source
   IDs, successful saves, unavailable items, and failures; existing
   destination bookmarks must not be reported as a completed transfer.
5. Verify an actual scheduled run after release and establish ongoing bookmark
   collection. The archive/capture importer is a transfer tool, not an ongoing
   bookmark collector or scheduler.

## Capturing the current Bookmarks view

`scripts/capture-x-bookmarks.mjs` uses the existing dedicated Playwright profile
and records only response bodies actually delivered by the Bookmarks page.
It stores captures in a new private directory, scrolls within a configured bound,
and exits nonzero unless an explicit termination marker or an empty repeated-cursor final page was observed.
It refuses an existing directory so a stale marker cannot establish completeness.

```sh
node scripts/capture-x-bookmarks.mjs --output /private/new-bookmark-capture
node scripts/prepare-bookmark-transfer.mjs \
  --capture-dir /private/new-bookmark-capture --output /private/transfer.json
```

Capture and transfer receipts belong outside Git. Repeated transfers reuse
existing source copies and bookmarks; collection is read-only on X.

## Photo review proposal

First retain source sensitivity through imports and protect moderator ratings.
That fixes known classification losses without a model. A visual review model
should initially suggest ratings in a shadow evaluation against a human-labeled
sample, including quotes, multiple attachments, and borderline cases. Measure
missed rated content separately from unnecessary restrictions; do not choose a
model based only on aggregate accuracy.

Any later rollout needs versioned rating provenance, confidence/uncertainty,
manual override protection, resumable asset checkpoints, and per-run cost and
failure accounting. A failed or uncertain review must remain unresolved rather
than being recorded as General. No model provider has been selected or deployed
as part of this repair.
